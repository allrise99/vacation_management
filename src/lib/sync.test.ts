import { describe, expect, it } from 'vitest';
import { type AppData, type LeaveEntry, emptyData } from './leave';
import { createBackup, normalizeData, parseBackup } from './storage';
import {
  EPOCH,
  type SyncRecord,
  clearAllRecords,
  deleteEntryRecord,
  mergeRemote,
  restoreData,
  setYearGranted,
  toRecords,
} from './sync';

const T1 = '2026-03-01T09:00:00.000Z';
const T2 = '2026-03-02T09:00:00.000Z';
const T3 = '2026-03-03T09:00:00.000Z';

function entry(id: string, patch: Partial<LeaveEntry> = {}): LeaveEntry {
  return {
    id,
    type: 'annual',
    unit: 'full',
    startDate: '2026-04-06',
    endDate: '2026-04-06',
    days: 1,
    createdAt: T1,
    updatedAt: T1,
    ...patch,
  };
}

function data(entries: LeaveEntry[], years: AppData['years'] = {}): AppData {
  return { version: 1, years, entries };
}

const remoteEntry = (e: LeaveEntry): SyncRecord => ({ kind: 'entry', id: e.id, data: e, deleted: false, updatedAt: e.updatedAt });

/** 서버 흉내: 기록 단위 저장, 더 오래된 수정은 거부 (실제 DB 트리거와 같은 규칙) */
class FakeServer {
  rows = new Map<string, SyncRecord>();
  async pull() {
    return [...this.rows.values()].map((r) => structuredClone(r));
  }
  async push(records: SyncRecord[]) {
    for (const r of records) {
      const key = `${r.kind}:${r.id}`;
      const old = this.rows.get(key);
      if (!old || Date.parse(r.updatedAt) >= Date.parse(old.updatedAt)) this.rows.set(key, structuredClone(r));
    }
  }
}

/** useSync와 같은 순서: 받기 → 합치기 → 올리기 */
async function syncDevice(local: AppData, server: FakeServer): Promise<AppData> {
  const records = await server.pull();
  const { data: merged, toPush } = mergeRemote(local, records);
  await server.push(toPush);
  return merged;
}

describe('toRecords', () => {
  it('휴가 기록, 연도 설정, 삭제 기록을 모두 동기화 기록으로 만든다', () => {
    const d: AppData = {
      ...data([entry('a')], { '2026': { annualGranted: 15 } }),
      deleted: { entries: { gone: T2 }, years: { '2025': T2 } },
    };
    const records = toRecords(d);
    expect(records).toHaveLength(4);
    expect(records.find((r) => r.kind === 'year' && r.id === '2026')).toMatchObject({ updatedAt: EPOCH, deleted: false });
    expect(records.filter((r) => r.deleted).map((r) => r.id).sort()).toEqual(['2025', 'gone']);
  });
});

describe('mergeRemote', () => {
  it('처음 로그인: 이 기기 기록과 서버 기록을 합치고, 이 기기에만 있는 기록은 올린다', () => {
    const local = data([entry('pc')], { '2026': { annualGranted: 15, updatedAt: T1 } });
    const result = mergeRemote(local, [remoteEntry(entry('phone', { startDate: '2026-05-04', endDate: '2026-05-04' }))]);
    expect(result.changed).toBe(true);
    expect(result.data.entries.map((e) => e.id).sort()).toEqual(['pc', 'phone']);
    expect(result.data.years['2026'].annualGranted).toBe(15);
    expect(result.toPush.map((r) => r.id).sort()).toEqual(['2026', 'pc']);
  });

  it('같은 기록은 나중에 수정한 쪽이 이긴다', () => {
    const local = data([entry('a', { memo: '이 기기', updatedAt: T2 })]);
    const remoteNewer = mergeRemote(local, [remoteEntry(entry('a', { memo: '서버', updatedAt: T3 }))]);
    expect(remoteNewer.data.entries[0].memo).toBe('서버');
    expect(remoteNewer.toPush).toHaveLength(0);

    const remoteOlder = mergeRemote(local, [remoteEntry(entry('a', { memo: '서버', updatedAt: T1 }))]);
    expect(remoteOlder.changed).toBe(false);
    expect(remoteOlder.data).toBe(local);
    expect(remoteOlder.toPush).toHaveLength(1);
    expect((remoteOlder.toPush[0].data as LeaveEntry).memo).toBe('이 기기');
  });

  it('달라진 것이 없으면 같은 객체를 돌려주고 올릴 것도 없다', () => {
    const local = data([entry('a')], { '2026': { annualGranted: 15, updatedAt: T1 } });
    const result = mergeRemote(local, toRecords(local));
    expect(result.changed).toBe(false);
    expect(result.data).toBe(local);
    expect(result.toPush).toHaveLength(0);
  });

  it('서버 시각 형식(+00:00, 마이크로초)이 달라도 같은 시각으로 비교한다', () => {
    const local = data([entry('a', { updatedAt: '2026-03-01T09:00:00.123Z' })]);
    const result = mergeRemote(local, [
      { ...remoteEntry(entry('a')), updatedAt: '2026-03-01T09:00:00.123+00:00' },
    ]);
    expect(result.toPush).toHaveLength(0);
    expect(result.changed).toBe(false);
  });

  it('이 기기에서 삭제한 기록은 서버에 삭제로 올라간다', () => {
    const local = deleteEntryRecord(data([entry('a')]), 'a', T2);
    expect(local.entries).toHaveLength(0);
    const result = mergeRemote(local, [remoteEntry(entry('a'))]);
    expect(result.data.entries).toHaveLength(0);
    expect(result.toPush).toEqual([{ kind: 'entry', id: 'a', data: null, deleted: true, updatedAt: T2 }]);
  });

  it('다른 기기에서 삭제한 기록은 이 기기에서도 지워지고, 다시 살아나지 않는다', () => {
    const local = data([entry('a')]);
    const deletedOnServer: SyncRecord = { kind: 'entry', id: 'a', data: null, deleted: true, updatedAt: T2 };
    const result = mergeRemote(local, [deletedOnServer]);
    expect(result.data.entries).toHaveLength(0);
    expect(result.data.deleted?.entries.a).toBe(T2);
    expect(result.toPush).toHaveLength(0);
    // 삭제보다 오래된 수정본이 다시 와도 살아나지 않는다
    const again = mergeRemote(result.data, [remoteEntry(entry('a', { updatedAt: T1 }))]);
    expect(again.data.entries).toHaveLength(0);
  });

  it('삭제 후에 다른 기기에서 더 늦게 수정했다면 수정본이 남는다', () => {
    const local = deleteEntryRecord(data([entry('a')]), 'a', T2);
    const result = mergeRemote(local, [remoteEntry(entry('a', { memo: '수정', updatedAt: T3 }))]);
    expect(result.data.entries.map((e) => e.memo)).toEqual(['수정']);
    expect(result.data.deleted).toBeUndefined();
  });

  it('수정 시각이 없는 예전 연도 설정은 서버 값에 진다', () => {
    const local = data([], { '2026': { annualGranted: 10 } });
    const result = mergeRemote(local, [{ kind: 'year', id: '2026', data: { annualGranted: 15 }, deleted: false, updatedAt: T1 }]);
    expect(result.data.years['2026']).toEqual({ annualGranted: 15, updatedAt: T1 });
  });

  it('서버의 잘못된 기록은 무시한다', () => {
    const local = data([entry('a')]);
    const bad: SyncRecord[] = [
      { kind: 'entry', id: 'x', data: { id: 'x', type: 'annual' }, deleted: false, updatedAt: T3 },
      { kind: 'entry', id: 'y', data: entry('other-id'), deleted: false, updatedAt: T3 },
      { kind: 'year', id: '2026', data: { annualGranted: -3 }, deleted: false, updatedAt: T3 },
      { kind: 'year', id: 'abcd', data: { annualGranted: 15 }, deleted: false, updatedAt: T3 },
      { kind: 'entry', id: 'a', data: entry('a', { memo: '시각 오류' }), deleted: false, updatedAt: 'not-a-date' },
    ];
    const result = mergeRemote(local, bad);
    expect(result.data).toBe(local);
    expect(result.changed).toBe(false);
    expect(result.toPush.map((r) => r.id)).toEqual(['a']);
  });
});

describe('동기화 정보를 유지하는 데이터 조작', () => {
  it('부여일수를 설정하면 수정 시각이 기록된다', () => {
    const d = setYearGranted(emptyData(), 2026, 15, T2);
    expect(d.years['2026']).toEqual({ annualGranted: 15, updatedAt: T2 });
  });

  it('백업 복원: 결과는 백업과 같고, 없던 기록은 삭제로 표시하고, 복원한 기록은 최신으로 표시한다', () => {
    const current = data([entry('keep'), entry('drop', { startDate: '2026-05-04', endDate: '2026-05-04' })], {
      '2025': { annualGranted: 12, updatedAt: T1 },
    });
    const backup = data([entry('keep', { memo: '백업본' }), entry('new', { startDate: '2026-06-01', endDate: '2026-06-01' })], {
      '2026': { annualGranted: 15 },
    });
    const restored = restoreData(current, backup, T3);
    expect(restored.entries.map((e) => e.id)).toEqual(['keep', 'new']);
    expect(restored.entries.every((e) => e.updatedAt === T3)).toBe(true);
    expect(restored.entries[0].memo).toBe('백업본');
    expect(restored.years).toEqual({ '2026': { annualGranted: 15, updatedAt: T3 } });
    expect(restored.deleted).toEqual({ entries: { drop: T3 }, years: { '2025': T3 } });
  });

  it('전체 삭제: 동기화 중이면 삭제 기록을 남기고, 아니면 완전히 비운다', () => {
    const current = data([entry('a')], { '2026': { annualGranted: 15 } });
    expect(clearAllRecords(current, T2, false)).toEqual(emptyData());
    const synced = clearAllRecords(current, T2, true);
    expect(synced.entries).toHaveLength(0);
    expect(synced.deleted).toEqual({ entries: { a: T2 }, years: { '2026': T2 } });
  });
});

describe('저장 형식', () => {
  it('삭제 기록은 이 기기 저장소에는 남지만 백업 파일에는 들어가지 않는다', () => {
    const d = deleteEntryRecord(data([entry('a'), entry('b', { startDate: '2026-05-04', endDate: '2026-05-04' })]), 'a', T2);
    expect(normalizeData(JSON.parse(JSON.stringify(d))).deleted).toEqual({ entries: { a: T2 }, years: {} });
    const backup = JSON.parse(createBackup(d));
    expect(backup.data.deleted).toBeUndefined();
    expect(parseBackup(createBackup(d)).entries.map((e) => e.id)).toEqual(['b']);
  });

  it('연도 설정의 수정 시각을 저장·복원한다', () => {
    const d = setYearGranted(emptyData(), 2026, 15, T2);
    expect(normalizeData(JSON.parse(JSON.stringify(d))).years['2026']).toEqual({ annualGranted: 15, updatedAt: T2 });
  });
});

describe('두 기기 동기화 시나리오', () => {
  it('PC와 휴대폰이 따로 입력·수정·삭제해도 같은 결과로 맞춰진다', async () => {
    const server = new FakeServer();
    let pc = data([entry('p1', { memo: 'PC 입력' })], { '2026': { annualGranted: 15, updatedAt: T1 } });
    let phone = data([entry('m1', { startDate: '2026-07-01', endDate: '2026-07-01', memo: '폰 입력' })]);

    pc = await syncDevice(pc, server);
    phone = await syncDevice(phone, server);
    pc = await syncDevice(pc, server);
    expect(pc.entries.map((e) => e.id).sort()).toEqual(['m1', 'p1']);
    expect(phone.entries.map((e) => e.id).sort()).toEqual(['m1', 'p1']);
    expect(phone.years['2026'].annualGranted).toBe(15);

    // 휴대폰: p1 메모 수정 (T2), PC: m1 삭제 (T3) + 부여일수 변경 (T3)
    phone = { ...phone, entries: phone.entries.map((e) => (e.id === 'p1' ? { ...e, memo: '폰에서 수정', updatedAt: T2 } : e)) };
    pc = setYearGranted(deleteEntryRecord(pc, 'm1', T3), 2026, 16, T3);

    phone = await syncDevice(phone, server);
    pc = await syncDevice(pc, server);
    phone = await syncDevice(phone, server);

    for (const device of [pc, phone]) {
      expect(device.entries.map((e) => [e.id, e.memo])).toEqual([['p1', '폰에서 수정']]);
      expect(device.years['2026'].annualGranted).toBe(16);
    }
    expect(server.rows.get('entry:m1')?.deleted).toBe(true);
  });

  it('오래된 기기가 늦게 올려도 더 새로운 서버 기록을 덮어쓰지 않는다', async () => {
    const server = new FakeServer();
    await server.push([remoteEntry(entry('a', { memo: '최신', updatedAt: T3 }))]);
    // 서버를 받기 전에 오래된 값을 올리려는 경우 (트리거가 거부)
    await server.push([remoteEntry(entry('a', { memo: '예전', updatedAt: T1 }))]);
    expect((server.rows.get('entry:a')?.data as LeaveEntry).memo).toBe('최신');
  });
});

describe('Supabase 키 확인', async () => {
  const { isSecretKey } = await import('./supabase');
  const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`;
  it('공개 키는 허용하고 서버 전용 비밀 키는 거부한다', () => {
    expect(isSecretKey(jwt('anon'))).toBe(false);
    expect(isSecretKey('sb_publishable_abc')).toBe(false);
    expect(isSecretKey(jwt('service_role'))).toBe(true);
    expect(isSecretKey('sb_secret_abc')).toBe(true);
  });
});
