import { addDays, countWeekdays, isWeekend } from './date';
import type { AppData, LeaveEntry, LeaveType, LeaveUnit } from './leave';

/**
 * 화면 체험용 가상 예시 데이터.
 * - 실제 기록과 섞이지 않도록 localStorage에 저장하지 않고 메모리에서만 사용한다.
 * - 모든 메모에 [예시] 접두어를 붙이고, id는 'demo-'로 시작한다.
 */
export const DEMO_ID_PREFIX = 'demo-';

export function isDemoEntry(entry: Pick<LeaveEntry, 'id'>): boolean {
  return entry.id.startsWith(DEMO_ID_PREFIX);
}

/** 오늘을 기준으로 지난 기록과 예정 기록이 함께 보이도록 예시를 만든다. */
export function createDemoData(today: string): AppData {
  const year = Number(today.slice(0, 4));
  const stamp = `${year}-01-01T00:00:00.000Z`;
  let seq = 0;

  const make = (type: LeaveType, unit: LeaveUnit, offset: number, length = 1, memo: string): LeaveEntry | null => {
    const start = nextWeekday(addDays(today, offset));
    const end = unit === 'full' ? lastWeekdayAfter(start, length) : start;
    if (Number(start.slice(0, 4)) !== year || Number(end.slice(0, 4)) !== year) return null;
    seq += 1;
    return {
      id: `${DEMO_ID_PREFIX}${seq}`,
      type,
      unit,
      startDate: start,
      endDate: end,
      days: unit === 'full' ? countWeekdays(start, end) : 0.5,
      memo: `[예시] ${memo}`,
      createdAt: stamp,
      updatedAt: stamp,
    };
  };

  const candidates = [
    make('annual', 'full', -60, 2, '가족 여행'),
    make('annual', 'am', -40, 1, '병원'),
    make('special', 'full', -25, 3, '특별휴가 1차'),
    make('annual', 'pm', -10, 1, '개인 용무'),
    make('annual', 'full', 12, 1, '휴식'),
    make('special', 'full', 20, 2, '특별휴가 2차'),
    make('annual', 'am', 30, 1, '은행 업무'),
  ];

  return {
    version: 1,
    years: { [String(year)]: { annualGranted: 15 } },
    entries: candidates.filter((e): e is LeaveEntry => e !== null),
  };
}

function nextWeekday(iso: string): string {
  let d = iso;
  while (isWeekend(d)) d = addDays(d, 1);
  return d;
}

/** start부터 평일 length개가 끝나는 날짜 */
function lastWeekdayAfter(start: string, length: number): string {
  let d = start;
  let count = 1;
  while (count < length) {
    d = addDays(d, 1);
    if (!isWeekend(d)) count += 1;
  }
  return d;
}
