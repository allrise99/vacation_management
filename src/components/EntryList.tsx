import { useState } from 'react';
import { formatRange } from '../lib/date';
import {
  type LeaveEntry,
  type LeaveStatus,
  type LeaveType,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
  LEAVE_UNIT_LABEL,
  entryStatus,
  formatDays,
  splitUsedPlanned,
} from '../lib/leave';

interface Props {
  entries: LeaveEntry[]; // 이미 연도로 필터·정렬된 목록
  today: string;
  onEdit: (entry: LeaveEntry) => void;
  onDelete: (entry: LeaveEntry) => void;
}

type StatusFilter = 'all' | 'used' | 'planned';
type TypeFilter = 'all' | LeaveType;

export function EntryList({ entries, today, onEdit, onDelete }: Props) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');

  const filtered = entries.filter((e) => {
    if (type !== 'all' && e.type !== type) return false;
    const s = entryStatus(e, today);
    if (status === 'used') return s !== 'planned';
    if (status === 'planned') return s !== 'used';
    return true;
  });

  // 예정은 가까운 순, 완료는 최근 순으로 보는 것이 자연스럽다
  const planned = filtered.filter((e) => entryStatus(e, today) !== 'used');
  const used = filtered.filter((e) => entryStatus(e, today) === 'used').reverse();

  return (
    <section className="card list" aria-label="사용 내역">
      <div className="filters">
        <div className="segmented" role="group" aria-label="상태">
          {(
            [
              ['all', '전체'],
              ['used', '사용 완료'],
              ['planned', '사용 예정'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="종류">
          {(
            [
              ['all', '모두'],
              ['annual', '연차'],
              ['special', '특별휴가'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="empty">표시할 휴가 기록이 없습니다.</p>
      ) : (
        <>
          {planned.length > 0 && <Group title="사용 예정" items={planned} {...{ today, onEdit, onDelete }} />}
          {used.length > 0 && <Group title="사용 완료" items={used} {...{ today, onEdit, onDelete }} />}
        </>
      )}
    </section>
  );
}

function Group({
  title,
  items,
  today,
  onEdit,
  onDelete,
}: {
  title: string;
  items: LeaveEntry[];
  today: string;
  onEdit: (e: LeaveEntry) => void;
  onDelete: (e: LeaveEntry) => void;
}) {
  const total = items.reduce((sum, e) => sum + e.days, 0);
  return (
    <div className="group">
      <h4>
        {title} <span className="dim">{items.length}건 · {formatDays(total)}</span>
      </h4>
      <ul className="entries">
        {items.map((e) => {
          const s: LeaveStatus = entryStatus(e, today);
          const split = s === 'ongoing' ? splitUsedPlanned(e, today) : null;
          return (
            <li key={e.id} className={`entry ${s}`}>
              <div className="entry-main">
                <div className="entry-title">
                  <span className={`badge ${e.type}`}>{LEAVE_TYPE_LABEL[e.type]}</span>
                  <span className="unit">{LEAVE_UNIT_LABEL[e.unit]}</span>
                  <span className={`status ${s}`}>{LEAVE_STATUS_LABEL[s]}</span>
                </div>
                <div className="entry-date">{formatRange(e.startDate, e.endDate)}</div>
                {split && (
                  <div className="dim small">
                    사용 {formatDays(split.used)} · 예정 {formatDays(split.planned)}
                  </div>
                )}
                {e.memo && <div className="memo">{e.memo}</div>}
              </div>
              <div className="entry-side">
                <span className="entry-days">{formatDays(e.days)}</span>
                <div className="entry-actions">
                  <button type="button" className="button small ghost" onClick={() => onEdit(e)}>
                    수정
                  </button>
                  <button type="button" className="button small ghost danger" onClick={() => onDelete(e)}>
                    삭제
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
