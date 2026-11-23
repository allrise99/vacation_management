import { isValidIsoDate } from './date';
import {
  type AppData,
  type LeaveEntry,
  type LeaveType,
  type LeaveUnit,
  emptyData,
  isHalfDay,
  validateAnnualGranted,
} from './leave';

/** 브라우저 localStorage 키. 이 기기·이 브라우저에만 저장된다. */
export const STORAGE_KEY = 'vacation-management:data:v1';
export const BACKUP_FORMAT = 'vacation-management-backup';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadData(storage: KeyValueStorage | undefined = safeLocalStorage()): AppData {
  if (!storage) return emptyData();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return normalizeData(JSON.parse(raw));
  } catch {
    return emptyData();
  }
}

export function saveData(data: AppData, storage: KeyValueStorage | undefined = safeLocalStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearData(storage: KeyValueStorage | undefined = safeLocalStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function safeLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function createBackup(data: AppData, now: Date = new Date()): string {
  return JSON.stringify(
    {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: now.toISOString(),
      data,
    },
    null,
    2,
  );
}

export function backupFileName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `vacation-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.json`;
}

/** 백업 JSON 문자열을 검증해서 AppData로 변환한다. 형식이 틀리면 Error를 던진다. */
export function parseBackup(text: string): AppData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('JSON 파일을 읽을 수 없습니다.');
  }
  if (!isObject(parsed)) throw new Error('백업 파일 형식이 아닙니다.');
  // 백업 래퍼({format, data}) 또는 AppData 자체 모두 허용
  const payload = parsed.format === BACKUP_FORMAT ? parsed.data : parsed;
  return normalizeData(payload, true);
}

const TYPES: LeaveType[] = ['annual', 'special'];
const UNITS: LeaveUnit[] = ['full', 'am', 'pm'];

/**
 * 저장된/복원할 데이터를 검증·정리한다.
 * strict=true면 잘못된 항목이 있을 때 오류를 던지고, false면 잘못된 항목만 버린다.
 */
export function normalizeData(input: unknown, strict = false): AppData {
  if (!isObject(input) || !isObject(input.years) || !Array.isArray(input.entries)) {
    if (strict) throw new Error('백업 파일에 연차 데이터가 없습니다.');
    return emptyData();
  }

  const years: AppData['years'] = {};
  for (const [key, value] of Object.entries(input.years)) {
    const granted = isObject(value) ? Number(value.annualGranted) : NaN;
    if (!/^\d{4}$/.test(key) || validateAnnualGranted(granted) !== null) {
      if (strict) throw new Error(`${key}년 부여일수 값이 올바르지 않습니다.`);
      continue;
    }
    years[key] = { annualGranted: granted };
  }

  const entries: LeaveEntry[] = [];
  const seen = new Set<string>();
  input.entries.forEach((raw, index) => {
    const entry = toEntry(raw);
    if (!entry || seen.has(entry.id)) {
      if (strict) throw new Error(`${index + 1}번째 휴가 기록이 올바르지 않습니다.`);
      return;
    }
    seen.add(entry.id);
    entries.push(entry);
  });

  return { version: 1, years, entries };
}

function toEntry(raw: unknown): LeaveEntry | null {
  if (!isObject(raw)) return null;
  const { id, type, unit, startDate, endDate, days, memo, createdAt, updatedAt } = raw;
  if (typeof id !== 'string' || !id) return null;
  if (!TYPES.includes(type as LeaveType) || !UNITS.includes(unit as LeaveUnit)) return null;
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) return null;
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) return null;
  if (isHalfDay(unit as LeaveUnit) && (days !== 0.5 || startDate !== endDate)) return null;
  const now = new Date().toISOString();
  return {
    id,
    type: type as LeaveType,
    unit: unit as LeaveUnit,
    startDate,
    endDate,
    days,
    memo: typeof memo === 'string' && memo.trim() ? memo.slice(0, 200) : undefined,
    createdAt: typeof createdAt === 'string' ? createdAt : now,
    updatedAt: typeof updatedAt === 'string' ? updatedAt : now,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
