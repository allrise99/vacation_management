import { calendarDayCount, countWeekdays, eachDate, isValidIsoDate, isWeekend, yearOf } from './date';

/** 휴가 종류: 연차 / 특별휴가 */
export type LeaveType = 'annual' | 'special';
/** 사용 단위: 종일 / 오전반차 / 오후반차 */
export type LeaveUnit = 'full' | 'am' | 'pm';
export type LeaveStatus = 'used' | 'ongoing' | 'planned';

export interface LeaveEntry {
  id: string;
  type: LeaveType;
  unit: LeaveUnit;
  startDate: string;
  endDate: string;
  /** 실제 차감일수. 반차는 항상 0.5, 종일은 기본적으로 기간 내 평일 수 (공휴일이 끼면 직접 수정) */
  days: number;
  memo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface YearSetting {
  /** 해당 연도 연차 총 부여일수 (사용자가 직접 설정) */
  annualGranted: number;
}

export interface AppData {
  version: 1;
  years: Record<string, YearSetting>;
  entries: LeaveEntry[];
}

/** 특별휴가 연간 부여일수 */
export const SPECIAL_LEAVE_DAYS = 5;
/** 특별휴가는 한 번 나눠 쓸 수 있다 = 최대 2회 */
export const MAX_SPECIAL_SEGMENTS = 2;
/** 연차 미사용분 보상 한도 */
export const MAX_COMPENSABLE_ANNUAL_DAYS = 5;
export const HALF_DAY = 0.5;
export const MAX_ANNUAL_GRANTED = 100;

export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  annual: '연차',
  special: '특별휴가',
};

export const LEAVE_UNIT_LABEL: Record<LeaveUnit, string> = {
  full: '종일',
  am: '오전반차',
  pm: '오후반차',
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  used: '사용 완료',
  ongoing: '사용 중',
  planned: '사용 예정',
};

export function emptyData(): AppData {
  return { version: 1, years: {}, entries: [] };
}

export function isHalfDay(unit: LeaveUnit): boolean {
  return unit === 'am' || unit === 'pm';
}

/** 입력값으로부터 기본 차감일수를 계산한다. */
export function defaultDays(unit: LeaveUnit, startDate: string, endDate: string): number {
  if (isHalfDay(unit)) return HALF_DAY;
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate) || startDate > endDate) return 0;
  return countWeekdays(startDate, endDate);
}

export function entryYear(entry: Pick<LeaveEntry, 'startDate'>): number {
  return yearOf(entry.startDate);
}

/**
 * 오늘 기준으로 사용 완료/예정 일수를 나눈다.
 * - 종료일이 오늘 이전이거나 오늘이면 전부 사용 완료
 * - 시작일이 오늘 이후면 전부 사용 예정
 * - 기간이 오늘에 걸쳐 있으면 오늘까지의 평일 수만큼 사용 완료, 나머지는 예정
 */
export function splitUsedPlanned(
  entry: Pick<LeaveEntry, 'startDate' | 'endDate' | 'days'>,
  today: string,
): { used: number; planned: number } {
  if (entry.endDate <= today) return { used: entry.days, planned: 0 };
  if (entry.startDate > today) return { used: 0, planned: entry.days };
  const elapsed = countWeekdays(entry.startDate, today);
  const used = Math.min(entry.days, elapsed);
  return { used, planned: round(entry.days - used) };
}

export function entryStatus(entry: Pick<LeaveEntry, 'startDate' | 'endDate'>, today: string): LeaveStatus {
  if (entry.endDate <= today) return 'used';
  if (entry.startDate > today) return 'planned';
  return 'ongoing';
}

export interface LeaveBalance {
  granted: number;
  used: number;
  planned: number;
  /** 현재 잔여 = 부여 - 사용 완료 */
  remaining: number;
  /** 예정 반영 후 잔여 = 부여 - 사용 완료 - 사용 예정 */
  remainingAfterPlanned: number;
}

export function computeBalance(
  entries: LeaveEntry[],
  year: number,
  type: LeaveType,
  granted: number,
  today: string,
): LeaveBalance {
  let used = 0;
  let planned = 0;
  for (const entry of entries) {
    if (entry.type !== type || entryYear(entry) !== year) continue;
    const split = splitUsedPlanned(entry, today);
    used += split.used;
    planned += split.planned;
  }
  used = round(used);
  planned = round(planned);
  return {
    granted,
    used,
    planned,
    remaining: round(granted - used),
    remainingAfterPlanned: round(granted - used - planned),
  };
}

/** 연차 미사용 보상 대상 일수: 예정 반영 후 잔여 연차 중 최대 5일 */
export function compensableAnnualDays(remainingAfterPlanned: number): number {
  return Math.min(Math.max(remainingAfterPlanned, 0), MAX_COMPENSABLE_ANNUAL_DAYS);
}

export interface YearSummary {
  year: number;
  annualConfigured: boolean;
  annual: LeaveBalance;
  special: LeaveBalance;
  /** 연차 + 특별휴가 합계 */
  total: LeaveBalance;
  /** 보상 받을 수 있는 연차 일수 (최대 5일) */
  compensableAnnual: number;
  /** 보상 한도를 넘어 소멸되는 연차 일수 */
  forfeitedAnnual: number;
  /** 사용하지 않으면 보상 없이 소멸되는 특별휴가 일수 */
  forfeitedSpecial: number;
  specialSegmentsUsed: number;
}

export function getAnnualGranted(data: AppData, year: number): number | undefined {
  return data.years[String(year)]?.annualGranted;
}

export function summarizeYear(data: AppData, year: number, today: string): YearSummary {
  const annualGranted = getAnnualGranted(data, year);
  const annual = computeBalance(data.entries, year, 'annual', annualGranted ?? 0, today);
  const special = computeBalance(data.entries, year, 'special', SPECIAL_LEAVE_DAYS, today);
  const total: LeaveBalance = {
    granted: round(annual.granted + special.granted),
    used: round(annual.used + special.used),
    planned: round(annual.planned + special.planned),
    remaining: round(annual.remaining + special.remaining),
    remainingAfterPlanned: round(annual.remainingAfterPlanned + special.remainingAfterPlanned),
  };
  const compensableAnnual = compensableAnnualDays(annual.remainingAfterPlanned);
  return {
    year,
    annualConfigured: annualGranted !== undefined,
    annual,
    special,
    total,
    compensableAnnual,
    forfeitedAnnual: round(Math.max(annual.remainingAfterPlanned, 0) - compensableAnnual),
    forfeitedSpecial: Math.max(special.remainingAfterPlanned, 0),
    specialSegmentsUsed: data.entries.filter((e) => e.type === 'special' && entryYear(e) === year).length,
  };
}

export interface LeaveDraft {
  type: LeaveType;
  unit: LeaveUnit;
  startDate: string;
  endDate: string;
  days: number;
  memo?: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function rangesOverlap(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * 등록/수정 전 검증.
 * @param editingId 수정 중인 항목 id (자기 자신과의 중복 검사 제외)
 */
export function validateDraft(
  draft: LeaveDraft,
  data: AppData,
  today: string,
  editingId?: string,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isValidIsoDate(draft.startDate)) errors.push('시작일을 올바르게 입력하세요.');
  if (!isValidIsoDate(draft.endDate)) errors.push('종료일을 올바르게 입력하세요.');
  if (errors.length) return { errors, warnings };

  if (draft.startDate > draft.endDate) errors.push('종료일은 시작일보다 빠를 수 없습니다.');
  if (yearOf(draft.startDate) !== yearOf(draft.endDate)) {
    errors.push('연도가 바뀌는 기간은 연도별로 나눠서 등록하세요.');
  }
  if (errors.length) return { errors, warnings };

  if (isHalfDay(draft.unit)) {
    if (draft.type === 'special') errors.push('특별휴가는 반차로 사용할 수 없습니다.');
    if (draft.startDate !== draft.endDate) errors.push('반차는 하루만 선택할 수 있습니다.');
    if (draft.days !== HALF_DAY) errors.push('반차는 0.5일로 차감됩니다.');
  } else {
    const calendarDays = calendarDayCount(draft.startDate, draft.endDate);
    if (!Number.isInteger(draft.days) || draft.days < 1) {
      errors.push('종일 휴가의 차감일수는 1일 이상의 정수여야 합니다.');
    } else if (draft.days > calendarDays) {
      errors.push(`차감일수는 기간(${calendarDays}일)보다 클 수 없습니다.`);
    }
  }

  const weekdays = eachDate(draft.startDate, draft.endDate).filter((d) => !isWeekend(d)).length;
  if (weekdays === 0) warnings.push('선택한 기간이 모두 주말입니다.');

  const year = yearOf(draft.startDate);
  const others = data.entries.filter((e) => e.id !== editingId);

  for (const other of others) {
    if (!rangesOverlap(draft, other)) continue;
    const bothHalf = isHalfDay(draft.unit) && isHalfDay(other.unit);
    if (bothHalf && draft.unit !== other.unit) continue; // 같은 날 오전+오후 반차는 허용
    errors.push('이미 등록된 휴가와 날짜가 겹칩니다.');
    break;
  }

  if (draft.type === 'special') {
    const sameYear = others.filter((e) => e.type === 'special' && entryYear(e) === year);
    if (sameYear.length >= MAX_SPECIAL_SEGMENTS) {
      errors.push(`특별휴가는 최대 ${MAX_SPECIAL_SEGMENTS}회(한 번 분할)까지만 나눠 쓸 수 있습니다.`);
    }
    const usedSpecial = sameYear.reduce((sum, e) => sum + e.days, 0);
    if (usedSpecial + draft.days > SPECIAL_LEAVE_DAYS) {
      errors.push(
        `특별휴가는 연 ${SPECIAL_LEAVE_DAYS}일입니다. 남은 특별휴가는 ${round(SPECIAL_LEAVE_DAYS - usedSpecial)}일입니다.`,
      );
    }
  } else {
    const granted = getAnnualGranted(data, year);
    if (granted === undefined) {
      warnings.push(`${year}년 연차 부여일수가 설정되지 않았습니다.`);
    } else {
      const balance = computeBalance(others, year, 'annual', granted, today);
      if (balance.remainingAfterPlanned - draft.days < 0) {
        warnings.push(`등록하면 ${year}년 연차가 ${round(draft.days - balance.remainingAfterPlanned)}일 초과됩니다.`);
      }
    }
  }

  return { errors, warnings };
}

export function validateAnnualGranted(value: number): string | null {
  if (!Number.isFinite(value)) return '숫자를 입력하세요.';
  if (value < 0) return '0일 이상이어야 합니다.';
  if (value > MAX_ANNUAL_GRANTED) return `${MAX_ANNUAL_GRANTED}일 이하로 입력하세요.`;
  if (Math.round(value * 2) !== value * 2) return '0.5일 단위로 입력하세요.';
  return null;
}

export function entriesForYear(entries: LeaveEntry[], year: number): LeaveEntry[] {
  return entries
    .filter((e) => entryYear(e) === year)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || unitOrder(a.unit) - unitOrder(b.unit));
}

function unitOrder(unit: LeaveUnit): number {
  return unit === 'am' ? 0 : unit === 'pm' ? 1 : 2;
}

/** 해당 날짜에 걸쳐 있는 휴가 */
export function entriesOnDate(entries: LeaveEntry[], date: string): LeaveEntry[] {
  return entries.filter((e) => e.startDate <= date && date <= e.endDate);
}

/** 부동소수점 오차 제거 (0.5 단위 계산) */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatDays(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}일`;
}
