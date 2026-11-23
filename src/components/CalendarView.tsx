import { useEffect, useRef } from 'react';
import { WEEKDAY_KO, formatKoreanDate, isWeekend, toIsoDate } from '../lib/date';
import {
  type LeaveEntry,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  LEAVE_UNIT_LABEL,
  entriesOnDate,
  entryStatus,
  formatDays,
} from '../lib/leave';

interface Props {
  year: number;
  month: number; // 0~11
  entries: LeaveEntry[];
  today: string;
  selectedDate: string | null;
  onMonthChange: (month: number) => void;
  onSelectDate: (date: string) => void;
  onAdd: (date: string) => void;
  onEdit: (entry: LeaveEntry) => void;
}

export function CalendarView({
  year,
  month,
  entries,
  today,
  selectedDate,
  onMonthChange,
  onSelectDate,
  onAdd,
  onEdit,
}: Props) {
  const cells = buildMonthCells(year, month);
  const chipsRef = useRef<HTMLDivElement>(null);

  // 선택한 월 칩이 보이도록 가로 스크롤
  useEffect(() => {
    const active = chipsRef.current?.querySelector<HTMLElement>('.chip.active');
    if (active && chipsRef.current) {
      const box = chipsRef.current;
      box.scrollTo({ left: active.offsetLeft - box.clientWidth / 2 + active.clientWidth / 2, behavior: 'smooth' });
    }
  }, [month]);
  const selectedEntries = selectedDate ? entriesOnDate(entries, selectedDate) : [];

  return (
    <section className="card calendar" aria-label="월별 달력">
      <div className="calendar-head">
        <button
          type="button"
          className="icon-button"
          onClick={() => onMonthChange(month - 1)}
          disabled={month === 0}
          aria-label="이전 달"
        >
          ‹
        </button>
        <h3>
          {year}년 {month + 1}월
        </h3>
        <button
          type="button"
          className="icon-button"
          onClick={() => onMonthChange(month + 1)}
          disabled={month === 11}
          aria-label="다음 달"
        >
          ›
        </button>
      </div>

      <div className="month-chips" ref={chipsRef} role="tablist" aria-label="월 선택">
        {Array.from({ length: 12 }, (_, m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === month}
            className={`chip${m === month ? ' active' : ''}${hasEntriesInMonth(entries, year, m) ? ' has' : ''}`}
            onClick={() => onMonthChange(m)}
          >
            {m + 1}월
          </button>
        ))}
      </div>

      <div className="grid weekdays" aria-hidden="true">
        {WEEKDAY_KO.map((w, i) => (
          <span key={w} className={i === 0 ? 'sun' : i === 6 ? 'sat' : undefined}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid days">
        {cells.map((date, i) => {
          if (!date) return <span key={`blank-${i}`} className="day blank" />;
          const dayEntries = entriesOnDate(entries, date);
          const dow = i % 7;
          const classes = [
            'day',
            date === today && 'today',
            date === selectedDate && 'selected',
            dow === 0 && 'sun',
            dow === 6 && 'sat',
          ]
            .filter(Boolean)
            .join(' ');
          const label = `${formatKoreanDate(date)}${dayEntries.length ? `, 휴가 ${dayEntries.length}건` : ''}`;
          return (
            <button key={date} type="button" className={classes} onClick={() => onSelectDate(date)} aria-label={label}>
              <span className="num">{Number(date.slice(8))}</span>
              <span className="marks">
                {dayEntries.map((e) => (
                  <span
                    key={e.id}
                    className={`mark ${e.type} ${e.unit} ${entryStatus(e, today)}${isWeekend(date) && e.unit === 'full' ? ' weekend' : ''}`}
                    title={`${LEAVE_TYPE_LABEL[e.type]} ${LEAVE_UNIT_LABEL[e.unit]}`}
                  >
                    {shortLabel(e)}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="legend">
        <span>
          <i className="sw annual" /> 연차
        </span>
        <span>
          <i className="sw special" /> 특별휴가
        </span>
        <span>
          <i className="sw planned-outline" /> 사용 예정
        </span>
      </div>

      {selectedDate && (
        <div className="day-detail">
          <div className="day-detail-head">
            <h4>{formatKoreanDate(selectedDate)}</h4>
            <button type="button" className="button small" onClick={() => onAdd(selectedDate)}>
              + 이 날짜에 추가
            </button>
          </div>
          {selectedEntries.length === 0 ? (
            <p className="dim">등록된 휴가가 없습니다.</p>
          ) : (
            <ul className="mini-list">
              {selectedEntries.map((e) => (
                <li key={e.id}>
                  <button type="button" className="mini-item" onClick={() => onEdit(e)}>
                    <span className={`badge ${e.type}`}>{LEAVE_TYPE_LABEL[e.type]}</span>
                    <span>{LEAVE_UNIT_LABEL[e.unit]}</span>
                    <span className="dim">{formatDays(e.days)}</span>
                    <span className={`status ${entryStatus(e, today)}`}>{LEAVE_STATUS_LABEL[entryStatus(e, today)]}</span>
                    {e.memo && <span className="memo">{e.memo}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function shortLabel(e: LeaveEntry): string {
  if (e.unit === 'am') return '오전';
  if (e.unit === 'pm') return '오후';
  return e.type === 'special' ? '특휴' : '연차';
}

function buildMonthCells(year: number, month: number): (string | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array(first.getDay()).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toIsoDate(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function hasEntriesInMonth(entries: LeaveEntry[], year: number, month: number): boolean {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  return entries.some((e) => e.startDate.slice(0, 7) <= prefix && prefix <= e.endDate.slice(0, 7));
}
