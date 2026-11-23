/**
 * 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다.
 * Date 객체의 UTC 변환으로 하루가 밀리는 문제를 피하기 위해 문자열 비교를 기본으로 한다.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

export function addDays(iso: string, amount: number): string {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + amount);
  return toIsoDate(date);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function isWeekend(iso: string): boolean {
  const day = parseIsoDate(iso).getDay();
  return day === 0 || day === 6;
}

/** start~end(포함) 사이의 모든 날짜. start > end면 빈 배열. */
export function eachDate(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = start;
  // 안전장치: 비정상 입력으로 무한 루프가 돌지 않도록 2년치로 제한
  for (let i = 0; cursor <= end && i < 731; i++) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

/** start~end(포함) 사이 평일(월~금) 수 */
export function countWeekdays(start: string, end: string): number {
  return eachDate(start, end).filter((d) => !isWeekend(d)).length;
}

export function calendarDayCount(start: string, end: string): number {
  return eachDate(start, end).length;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

export function formatKoreanDate(iso: string, withWeekday = true): string {
  const date = parseIsoDate(iso);
  const base = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return withWeekday ? `${base} (${WEEKDAY_KO[date.getDay()]})` : base;
}

export function formatRange(start: string, end: string): string {
  if (start === end) return formatKoreanDate(start);
  return `${formatKoreanDate(start)} ~ ${formatKoreanDate(end)}`;
}

export { WEEKDAY_KO };
