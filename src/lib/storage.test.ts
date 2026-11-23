import { describe, expect, it } from 'vitest';
import { createDemoData, isDemoEntry } from './demo';
import type { AppData } from './leave';
import { STORAGE_KEY, createBackup, loadData, normalizeData, parseBackup, saveData } from './storage';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const sample: AppData = {
  version: 1,
  years: { '2026': { annualGranted: 15 } },
  entries: [
    {
      id: 'a',
      type: 'annual',
      unit: 'am',
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      days: 0.5,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('localStorage 저장', () => {
  it('저장 후 다시 불러온다', () => {
    const storage = memoryStorage();
    expect(saveData(sample, storage)).toBe(true);
    expect(storage.map.has(STORAGE_KEY)).toBe(true);
    expect(loadData(storage)).toEqual(sample);
  });

  it('손상된 데이터는 빈 데이터로 시작한다', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    expect(loadData(storage).entries).toEqual([]);
  });
});

describe('JSON 백업·복원', () => {
  it('백업 파일을 그대로 복원한다', () => {
    expect(parseBackup(createBackup(sample))).toEqual(sample);
  });

  it('JSON이 아니면 오류', () => {
    expect(() => parseBackup('hello')).toThrow('JSON');
  });

  it('잘못된 기록이 있으면 복원을 거부한다', () => {
    const bad = { ...sample, entries: [{ ...sample.entries[0], days: 1 }] }; // 반차인데 1일
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('1번째');
  });

  it('잘못된 부여일수는 복원을 거부한다', () => {
    const bad = { ...sample, years: { '2026': { annualGranted: -3 } } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('부여일수');
  });

  it('비엄격 모드에서는 잘못된 항목만 버린다', () => {
    const mixed = { ...sample, entries: [...sample.entries, { id: 'x' }] };
    expect(normalizeData(mixed).entries).toHaveLength(1);
  });
});

describe('예시 데이터', () => {
  it('예시 데이터는 실제 기록과 구분되는 표시를 가진다', () => {
    const demo = createDemoData('2026-06-15');
    expect(demo.entries.length).toBeGreaterThan(0);
    for (const e of demo.entries) {
      expect(isDemoEntry(e)).toBe(true);
      expect(e.memo?.startsWith('[예시]')).toBe(true);
    }
  });

  it('예시 데이터는 모두 유효한 기록이다', () => {
    const demo = createDemoData('2026-06-15');
    expect(() => normalizeData(demo, true)).not.toThrow();
  });
});
