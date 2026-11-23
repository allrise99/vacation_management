import { describe, expect, it } from 'vitest';
import { countWeekdays, isValidIsoDate } from './date';
import {
  type AppData,
  type LeaveDraft,
  type LeaveEntry,
  compensableAnnualDays,
  computeBalance,
  defaultDays,
  entryStatus,
  splitUsedPlanned,
  summarizeYear,
  validateAnnualGranted,
  validateDraft,
} from './leave';

const TODAY = '2026-06-15'; // 월요일

let seq = 0;
function entry(partial: Partial<LeaveEntry> & Pick<LeaveEntry, 'startDate'>): LeaveEntry {
  seq += 1;
  const unit = partial.unit ?? 'full';
  const endDate = partial.endDate ?? partial.startDate;
  return {
    id: `t${seq}`,
    type: 'annual',
    unit,
    endDate,
    days: unit === 'full' ? countWeekdays(partial.startDate, endDate) : 0.5,
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

function data(entries: LeaveEntry[], annualGranted?: number): AppData {
  return {
    version: 1,
    years: annualGranted === undefined ? {} : { '2026': { annualGranted } },
    entries,
  };
}

function draft(partial: Partial<LeaveDraft>): LeaveDraft {
  const unit = partial.unit ?? 'full';
  const startDate = partial.startDate ?? '2026-07-01';
  const endDate = partial.endDate ?? startDate;
  return {
    type: 'annual',
    unit,
    startDate,
    endDate,
    days: defaultDays(unit, startDate, endDate),
    ...partial,
  };
}

describe('날짜 유틸', () => {
  it('유효한 날짜만 허용한다', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-3')).toBe(false);
    expect(isValidIsoDate(20260101)).toBe(false);
  });

  it('주말을 제외한 평일 수를 센다', () => {
    // 2026-06-12(금) ~ 2026-06-16(화): 금, 월, 화
    expect(countWeekdays('2026-06-12', '2026-06-16')).toBe(3);
    expect(countWeekdays('2026-06-13', '2026-06-14')).toBe(0);
  });
});

describe('차감일수 계산', () => {
  it('반차는 0.5일 차감된다', () => {
    expect(defaultDays('am', '2026-07-01', '2026-07-01')).toBe(0.5);
    expect(defaultDays('pm', '2026-07-01', '2026-07-01')).toBe(0.5);
  });

  it('종일 연차는 기간 내 평일 수만큼 차감된다', () => {
    expect(defaultDays('full', '2026-07-01', '2026-07-07')).toBe(5);
  });

  it('잘못된 기간이면 0일', () => {
    expect(defaultDays('full', '2026-07-07', '2026-07-01')).toBe(0);
  });
});

describe('사용 완료 / 사용 예정 구분', () => {
  it('오늘 이전과 오늘은 사용 완료, 이후는 사용 예정', () => {
    expect(entryStatus({ startDate: '2026-06-10', endDate: '2026-06-10' }, TODAY)).toBe('used');
    expect(entryStatus({ startDate: TODAY, endDate: TODAY }, TODAY)).toBe('used');
    expect(entryStatus({ startDate: '2026-06-16', endDate: '2026-06-16' }, TODAY)).toBe('planned');
  });

  it('오늘에 걸친 기간은 오늘까지의 평일만 사용 완료로 계산한다', () => {
    // 6/12(금) ~ 6/17(수) = 평일 4일, 오늘(6/15 월)까지 금·월 2일 사용
    const e = { startDate: '2026-06-12', endDate: '2026-06-17', days: 4 };
    expect(entryStatus(e, TODAY)).toBe('ongoing');
    expect(splitUsedPlanned(e, TODAY)).toEqual({ used: 2, planned: 2 });
  });

  it('공휴일로 차감일수를 줄인 경우 사용일이 차감일수를 넘지 않는다', () => {
    const e = { startDate: '2026-06-12', endDate: '2026-06-17', days: 1 };
    expect(splitUsedPlanned(e, TODAY)).toEqual({ used: 1, planned: 0 });
  });
});

describe('잔여일수 계산', () => {
  const entries = [
    entry({ startDate: '2026-03-02', endDate: '2026-03-03' }), // 2일 사용
    entry({ startDate: '2026-05-04', unit: 'am' }), // 0.5 사용
    entry({ startDate: '2026-05-04', unit: 'pm' }), // 0.5 사용
    entry({ startDate: '2026-06-10', unit: 'pm' }), // 0.5 사용
    entry({ startDate: '2026-08-03', endDate: '2026-08-05' }), // 3일 예정
    entry({ startDate: '2026-09-01', unit: 'am' }), // 0.5 예정
    entry({ startDate: '2025-12-29' }), // 다른 연도
    entry({ type: 'special', startDate: '2026-04-06', endDate: '2026-04-08' }), // 특별휴가 3일 사용
  ];

  it('총 부여 / 사용 / 예정 / 현재 잔여 / 예정 반영 후 잔여', () => {
    expect(computeBalance(entries, 2026, 'annual', 15, TODAY)).toEqual({
      granted: 15,
      used: 3.5,
      planned: 3.5,
      remaining: 11.5,
      remainingAfterPlanned: 8,
    });
  });

  it('연도별로 분리해서 계산한다', () => {
    expect(computeBalance(entries, 2025, 'annual', 15, TODAY).used).toBe(1);
  });

  it('연차와 특별휴가를 분리해서 집계한다', () => {
    const summary = summarizeYear(data(entries, 15), 2026, TODAY);
    expect(summary.special).toEqual({
      granted: 5,
      used: 3,
      planned: 0,
      remaining: 2,
      remainingAfterPlanned: 2,
    });
    expect(summary.total.granted).toBe(20);
    expect(summary.total.remainingAfterPlanned).toBe(10);
    expect(summary.specialSegmentsUsed).toBe(1);
  });

  it('부여일수 미설정이면 0일로 계산하고 미설정 상태를 알린다', () => {
    const summary = summarizeYear(data([]), 2026, TODAY);
    expect(summary.annualConfigured).toBe(false);
    expect(summary.annual.granted).toBe(0);
  });
});

describe('보상 규칙', () => {
  it('연차는 최대 5일까지만 보상된다', () => {
    expect(compensableAnnualDays(8)).toBe(5);
    expect(compensableAnnualDays(3.5)).toBe(3.5);
    expect(compensableAnnualDays(-1)).toBe(0);
  });

  it('보상 한도를 넘는 연차와 남은 특별휴가는 보상 없이 소멸된다', () => {
    const summary = summarizeYear(
      data([entry({ type: 'special', startDate: '2026-04-06', endDate: '2026-04-07' })], 12),
      2026,
      TODAY,
    );
    expect(summary.compensableAnnual).toBe(5);
    expect(summary.forfeitedAnnual).toBe(7);
    // 특별휴가는 3일 남아도 보상 0, 소멸 3
    expect(summary.forfeitedSpecial).toBe(3);
  });
});

describe('등록 검증', () => {
  it('정상적인 연차 등록은 통과한다', () => {
    expect(validateDraft(draft({}), data([], 15), TODAY)).toEqual({ errors: [], warnings: [] });
  });

  it('반차는 하루, 0.5일만 가능하다', () => {
    const r = validateDraft(draft({ unit: 'am', endDate: '2026-07-02', days: 0.5 }), data([], 15), TODAY);
    expect(r.errors).toContain('반차는 하루만 선택할 수 있습니다.');
  });

  it('종료일이 시작일보다 빠르면 오류', () => {
    const r = validateDraft(draft({ startDate: '2026-07-03', endDate: '2026-07-01', days: 1 }), data([], 15), TODAY);
    expect(r.errors).toContain('종료일은 시작일보다 빠를 수 없습니다.');
  });

  it('연도를 넘는 기간은 오류', () => {
    const r = validateDraft(draft({ startDate: '2026-12-31', endDate: '2027-01-02' }), data([], 15), TODAY);
    expect(r.errors[0]).toMatch('연도');
  });

  it('차감일수는 기간 일수를 넘을 수 없다', () => {
    const r = validateDraft(draft({ days: 2 }), data([], 15), TODAY);
    expect(r.errors[0]).toMatch('차감일수');
  });

  it('같은 날 오전·오후 반차는 허용하지만 종일과 겹치면 오류', () => {
    const existing = [entry({ startDate: '2026-07-01', unit: 'am' })];
    expect(validateDraft(draft({ unit: 'pm' }), data(existing, 15), TODAY).errors).toEqual([]);
    expect(validateDraft(draft({ unit: 'am' }), data(existing, 15), TODAY).errors).toContain(
      '이미 등록된 휴가와 날짜가 겹칩니다.',
    );
    expect(validateDraft(draft({ unit: 'full' }), data(existing, 15), TODAY).errors).toContain(
      '이미 등록된 휴가와 날짜가 겹칩니다.',
    );
  });

  it('수정할 때는 자기 자신과의 중복을 검사하지 않는다', () => {
    const existing = entry({ startDate: '2026-07-01' });
    const r = validateDraft(draft({ memo: '수정' }), data([existing], 15), TODAY, existing.id);
    expect(r.errors).toEqual([]);
  });

  it('연차 초과 사용은 경고로 알린다', () => {
    const existing = [entry({ startDate: '2026-03-02', endDate: '2026-03-03' })];
    const r = validateDraft(draft({}), data(existing, 2), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.warnings[0]).toMatch('초과');
  });

  it('부여일수 미설정 경고', () => {
    expect(validateDraft(draft({}), data([]), TODAY).warnings[0]).toMatch('설정되지 않았습니다');
  });
});

describe('특별휴가 규칙', () => {
  const special = (startDate: string, endDate: string) => entry({ type: 'special', startDate, endDate });

  it('5일을 한 번에 사용할 수 있다', () => {
    const r = validateDraft(
      draft({ type: 'special', startDate: '2026-07-06', endDate: '2026-07-10' }),
      data([], 15),
      TODAY,
    );
    expect(r.errors).toEqual([]);
  });

  it('한 번 나눠서(최대 2회) 사용할 수 있다', () => {
    const existing = [special('2026-04-06', '2026-04-08')]; // 3일
    const r = validateDraft(
      draft({ type: 'special', startDate: '2026-07-06', endDate: '2026-07-07' }),
      data(existing, 15),
      TODAY,
    );
    expect(r.errors).toEqual([]);
  });

  it('세 번째 분할 사용은 불가능하다', () => {
    const existing = [special('2026-04-06', '2026-04-06'), special('2026-05-06', '2026-05-06')];
    const r = validateDraft(draft({ type: 'special', startDate: '2026-07-06' }), data(existing, 15), TODAY);
    expect(r.errors.some((e) => e.includes('최대 2회'))).toBe(true);
  });

  it('5일을 초과할 수 없다', () => {
    const existing = [special('2026-04-06', '2026-04-09')]; // 4일
    const r = validateDraft(
      draft({ type: 'special', startDate: '2026-07-06', endDate: '2026-07-07' }),
      data(existing, 15),
      TODAY,
    );
    expect(r.errors.some((e) => e.includes('남은 특별휴가는 1일'))).toBe(true);
  });

  it('반차로 사용할 수 없다', () => {
    const r = validateDraft(draft({ type: 'special', unit: 'am' }), data([], 15), TODAY);
    expect(r.errors).toContain('특별휴가는 반차로 사용할 수 없습니다.');
  });

  it('분할 횟수는 연도별로 따로 센다', () => {
    const existing = [
      entry({ type: 'special', startDate: '2025-04-07' }),
      entry({ type: 'special', startDate: '2025-05-07' }),
    ];
    const r = validateDraft(draft({ type: 'special', startDate: '2026-07-06' }), data(existing, 15), TODAY);
    expect(r.errors).toEqual([]);
  });
});

describe('부여일수 검증', () => {
  it('0.5일 단위의 0~100 사이 값만 허용', () => {
    expect(validateAnnualGranted(15)).toBeNull();
    expect(validateAnnualGranted(15.5)).toBeNull();
    expect(validateAnnualGranted(15.3)).not.toBeNull();
    expect(validateAnnualGranted(-1)).not.toBeNull();
    expect(validateAnnualGranted(101)).not.toBeNull();
    expect(validateAnnualGranted(NaN)).not.toBeNull();
  });
});
