import { type AppData, type DeletedMarks, type LeaveEntry, emptyData, validateAnnualGranted } from './leave';
import { toEntry } from './storage';

/**
 * 동기화 단위 기록.
 * - entry: 휴가 기록 하나 (id = 기록 id)
 * - year: 연도별 설정 하나 (id = 'YYYY')
 * 삭제된 기록은 deleted=true, data=null 로 남겨서 다른 기기에도 삭제가 전파되게 한다.
 */
export type RecordKind = 'entry' | 'year';

export interface SyncRecord {
  kind: RecordKind;
  id: string;
  data: unknown | null;
  deleted: boolean;
  updatedAt: string;
}

/** 서버(또는 테스트용 가짜 서버)와 주고받는 통로 */
export interface SyncRemote {
  pull(): Promise<SyncRecord[]>;
  push(records: SyncRecord[]): Promise<void>;
}

/** 수정 시각이 없는 예전 연도 설정은 가장 오래된 것으로 취급한다 */
export const EPOCH = '1970-01-01T00:00:00.000Z';

const keyOf = (kind: RecordKind, id: string) => `${kind}:${id}`;

function time(ts: string): number {
  const t = Date.parse(ts);
  return Number.isNaN(t) ? 0 : t;
}

function deletedMarks(data: AppData): DeletedMarks {
  return { entries: { ...data.deleted?.entries }, years: { ...data.deleted?.years } };
}

/** 로컬 데이터를 동기화 기록 목록으로 바꾼다 (삭제 기록 포함). */
export function toRecords(data: AppData): SyncRecord[] {
  const records: SyncRecord[] = [];
  for (const entry of data.entries) {
    records.push({ kind: 'entry', id: entry.id, data: entry, deleted: false, updatedAt: entry.updatedAt });
  }
  for (const [year, setting] of Object.entries(data.years)) {
    records.push({
      kind: 'year',
      id: year,
      data: { annualGranted: setting.annualGranted },
      deleted: false,
      updatedAt: setting.updatedAt ?? EPOCH,
    });
  }
  const marks = deletedMarks(data);
  for (const [id, ts] of Object.entries(marks.entries)) {
    if (!data.entries.some((e) => e.id === id)) records.push({ kind: 'entry', id, data: null, deleted: true, updatedAt: ts });
  }
  for (const [year, ts] of Object.entries(marks.years)) {
    if (!(year in data.years)) records.push({ kind: 'year', id: year, data: null, deleted: true, updatedAt: ts });
  }
  return records;
}

/** 서버에서 받은 기록을 검증한다. 잘못된 기록은 null (없는 것으로 취급). */
function validateRemote(record: SyncRecord): SyncRecord | null {
  if (record.kind !== 'entry' && record.kind !== 'year') return null;
  if (typeof record.id !== 'string' || !record.id || Number.isNaN(Date.parse(record.updatedAt))) return null;
  const updatedAt = new Date(Date.parse(record.updatedAt)).toISOString();
  if (record.deleted) return { ...record, data: null, updatedAt };
  if (record.kind === 'entry') {
    const entry = toEntry(record.data);
    if (!entry || entry.id !== record.id) return null;
    return { ...record, data: { ...entry, updatedAt }, updatedAt };
  }
  const granted = typeof record.data === 'object' && record.data ? Number((record.data as Record<string, unknown>).annualGranted) : NaN;
  if (!/^\d{4}$/.test(record.id) || validateAnnualGranted(granted) !== null) return null;
  return { ...record, data: { annualGranted: granted }, updatedAt };
}

function sameContent(a: SyncRecord, b: SyncRecord): boolean {
  if (a.deleted !== b.deleted) return false;
  if (a.deleted) return true;
  return JSON.stringify(stripTimestamps(a.data)) === JSON.stringify(stripTimestamps(b.data));
}

function stripTimestamps(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const { updatedAt: _u, ...rest } = data as Record<string, unknown>;
  return Object.fromEntries(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y)));
}

export interface MergeResult {
  /** 병합 결과 데이터 */
  data: AppData;
  /** 서버보다 이 기기 쪽이 새로워서 서버로 올려야 하는 기록 */
  toPush: SyncRecord[];
  /** 서버 기록 때문에 로컬 데이터가 바뀌었는지 */
  changed: boolean;
}

/**
 * 로컬 데이터와 서버 기록을 기록 단위로 합친다.
 * 같은 기록은 수정 시각이 늦은 쪽이 이긴다(시각이 같으면 서버 쪽). 삭제도 하나의 수정으로 취급한다.
 */
export function mergeRemote(local: AppData, remoteRecords: SyncRecord[]): MergeResult {
  const localMap = new Map(toRecords(local).map((r) => [keyOf(r.kind, r.id), r]));
  const remoteMap = new Map<string, SyncRecord>();
  for (const raw of remoteRecords) {
    const r = validateRemote(raw);
    if (r) remoteMap.set(keyOf(r.kind, r.id), r);
  }

  const winners = new Map<string, SyncRecord>();
  const toPush: SyncRecord[] = [];
  let changed = false;

  for (const [key, l] of localMap) {
    const r = remoteMap.get(key);
    if (!r || time(l.updatedAt) > time(r.updatedAt)) {
      winners.set(key, l);
      toPush.push(l);
    } else {
      winners.set(key, r);
      if (!sameContent(l, r)) changed = true;
    }
  }
  for (const [key, r] of remoteMap) {
    if (localMap.has(key)) continue;
    winners.set(key, r);
    changed = true; // 새 기록이거나, 보관해 둘 삭제 기록 (다시 살아나지 않도록)
  }

  if (!changed) return { data: local, toPush, changed: false };
  return { data: fromRecords([...winners.values()], local), toPush, changed: true };
}

/** 기록 목록을 AppData로 되돌린다. 로컬에 있던 기록 순서를 최대한 유지한다. */
function fromRecords(records: SyncRecord[], local: AppData): AppData {
  const order = new Map(local.entries.map((e, i) => [e.id, i]));
  const entries: LeaveEntry[] = [];
  const years: AppData['years'] = {};
  const deleted: DeletedMarks = { entries: {}, years: {} };
  for (const r of records) {
    if (r.deleted) {
      deleted[r.kind === 'entry' ? 'entries' : 'years'][r.id] = r.updatedAt;
    } else if (r.kind === 'entry') {
      entries.push(r.data as LeaveEntry);
    } else {
      const { annualGranted } = r.data as { annualGranted: number };
      years[r.id] = r.updatedAt === EPOCH ? { annualGranted } : { annualGranted, updatedAt: r.updatedAt };
    }
  }
  entries.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return withDeleted({ version: 1, years, entries }, deleted);
}

function withDeleted(data: AppData, deleted: DeletedMarks): AppData {
  const hasAny = Object.keys(deleted.entries).length > 0 || Object.keys(deleted.years).length > 0;
  const { deleted: _old, ...rest } = data;
  return hasAny ? { ...rest, deleted } : rest;
}

/* ---------- 동기화 정보를 유지하는 데이터 조작 ---------- */

/** 휴가 기록을 삭제하고 삭제 기록을 남긴다. */
export function deleteEntryRecord(data: AppData, id: string, now: string): AppData {
  const marks = deletedMarks(data);
  marks.entries[id] = now;
  return withDeleted({ ...data, entries: data.entries.filter((e) => e.id !== id) }, marks);
}

/** 연도 부여일수를 설정한다. */
export function setYearGranted(data: AppData, year: number, annualGranted: number, now: string): AppData {
  const marks = deletedMarks(data);
  delete marks.years[String(year)];
  return withDeleted({ ...data, years: { ...data.years, [String(year)]: { annualGranted, updatedAt: now } } }, marks);
}

/**
 * 백업 복원: 결과는 백업 내용과 같아진다.
 * 동기화 중이면 다른 기기에도 그대로 반영되도록, 복원한 기록은 지금 수정한 것으로 표시하고
 * 백업에 없는 기존 기록은 삭제 기록을 남긴다.
 */
export function restoreData(current: AppData, restored: AppData, now: string): AppData {
  const marks = deletedMarks(current);
  const entryIds = new Set(restored.entries.map((e) => e.id));
  for (const e of current.entries) if (!entryIds.has(e.id)) marks.entries[e.id] = now;
  for (const id of entryIds) delete marks.entries[id];
  for (const y of Object.keys(current.years)) if (!(y in restored.years)) marks.years[y] = now;
  for (const y of Object.keys(restored.years)) delete marks.years[y];
  const years: AppData['years'] = {};
  for (const [y, s] of Object.entries(restored.years)) years[y] = { annualGranted: s.annualGranted, updatedAt: now };
  return withDeleted(
    { version: 1, years, entries: restored.entries.map((e) => ({ ...e, updatedAt: now })) },
    marks,
  );
}

/** 모든 기록 삭제. 동기화 중이면 다른 기기에서도 지워지도록 삭제 기록을 남긴다. */
export function clearAllRecords(current: AppData, now: string, keepDeletedMarks: boolean): AppData {
  if (!keepDeletedMarks) return emptyData();
  return restoreData(current, emptyData(), now);
}
