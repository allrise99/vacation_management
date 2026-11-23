import { type FormEvent, useState } from 'react';
import { calendarDayCount, isValidIsoDate } from '../lib/date';
import {
  type AppData,
  type LeaveDraft,
  type LeaveEntry,
  type LeaveType,
  type LeaveUnit,
  LEAVE_TYPE_LABEL,
  LEAVE_UNIT_LABEL,
  MAX_SPECIAL_SEGMENTS,
  SPECIAL_LEAVE_DAYS,
  defaultDays,
  formatDays,
  isHalfDay,
  validateDraft,
} from '../lib/leave';
import { Sheet } from './Sheet';

interface Props {
  data: AppData;
  today: string;
  initial?: LeaveEntry;
  initialDate: string;
  onSave: (draft: LeaveDraft, id?: string) => void;
  onDelete?: (entry: LeaveEntry) => void;
  onClose: () => void;
}

export function EntryForm({ data, today, initial, initialDate, onSave, onDelete, onClose }: Props) {
  const [type, setType] = useState<LeaveType>(initial?.type ?? 'annual');
  const [unit, setUnit] = useState<LeaveUnit>(initial?.unit ?? 'full');
  const [startDate, setStartDate] = useState(initial?.startDate ?? initialDate);
  const [endDate, setEndDate] = useState(initial?.endDate ?? initialDate);
  const [memo, setMemo] = useState(initial?.memo ?? '');
  const autoDays = defaultDays(unit, startDate, isHalfDay(unit) ? startDate : endDate);
  const [manualDays, setManualDays] = useState<number | null>(
    initial && initial.unit === 'full' && initial.days !== defaultDays('full', initial.startDate, initial.endDate)
      ? initial.days
      : null,
  );
  const [submitted, setSubmitted] = useState(false);

  const draft: LeaveDraft = {
    type,
    unit,
    startDate,
    endDate: isHalfDay(unit) ? startDate : endDate,
    days: isHalfDay(unit) ? 0.5 : (manualDays ?? autoDays),
    memo: memo.trim() || undefined,
  };

  const validation = validateDraft(draft, data, today, initial?.id);

  const changeType = (next: LeaveType) => {
    setType(next);
    if (next === 'special') setUnit('full');
  };

  const changeStart = (value: string) => {
    // 하루짜리였거나 종료일이 시작일보다 앞서게 되면 종료일도 함께 옮긴다
    if (!endDate || endDate === startDate || endDate < value || isHalfDay(unit)) setEndDate(value);
    setStartDate(value);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (validation.errors.length) return;
    onSave(draft, initial?.id);
  };

  const rangeDays =
    isValidIsoDate(startDate) && isValidIsoDate(draft.endDate) && startDate <= draft.endDate
      ? calendarDayCount(startDate, draft.endDate)
      : 0;

  return (
    <Sheet
      title={initial ? '휴가 수정' : '휴가 추가'}
      onClose={onClose}
      footer={
        <>
          {initial && onDelete && (
            <button type="button" className="button ghost danger" onClick={() => onDelete(initial)}>
              삭제
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button ghost" onClick={onClose}>
            취소
          </button>
          <button type="submit" form="entry-form" className="button primary">
            {initial ? '저장' : '추가'}
          </button>
        </>
      }
    >
      <form id="entry-form" className="form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>휴가 종류</legend>
          <div className="segmented wide">
            {(['annual', 'special'] as const).map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => changeType(t)}>
                {LEAVE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          {type === 'special' && (
            <p className="hint">
              특별휴가는 연 {SPECIAL_LEAVE_DAYS}일, 종일 단위로 최대 {MAX_SPECIAL_SEGMENTS}회(한 번 분할)까지 쓸 수
              있으며 남아도 보상되지 않습니다.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>사용 단위</legend>
          <div className="segmented wide">
            {(['full', 'am', 'pm'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                disabled={type === 'special' && u !== 'full'}
                onClick={() => {
                  setUnit(u);
                  if (isHalfDay(u)) setEndDate(startDate);
                }}
              >
                {LEAVE_UNIT_LABEL[u]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="field-row">
          <label className="field">
            <span>{isHalfDay(unit) ? '날짜' : '시작일'}</span>
            <input type="date" value={startDate} required onChange={(e) => changeStart(e.target.value)} />
          </label>
          {!isHalfDay(unit) && (
            <label className="field">
              <span>종료일</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                required
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          )}
        </div>

        {isHalfDay(unit) ? (
          <p className="days-preview">
            차감 <b>0.5일</b>
          </p>
        ) : (
          <div className="field-row align-end">
            <label className="field">
              <span>차감일수</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={rangeDays || undefined}
                step={1}
                value={manualDays ?? autoDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setManualDays(v === autoDays ? null : v);
                }}
              />
            </label>
            <p className="hint grow">
              주말 제외 자동 계산: {formatDays(autoDays)}. 공휴일이 끼어 있으면 직접 줄여 주세요.
              {manualDays !== null && (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={() => setManualDays(null)}>
                    자동값으로
                  </button>
                </>
              )}
            </p>
          </div>
        )}

        <label className="field">
          <span>메모 (선택)</span>
          <input
            type="text"
            value={memo}
            maxLength={200}
            placeholder="예: 여행, 병원"
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>

        {(submitted || validation.warnings.length > 0) && (
          <ul className="messages" aria-live="polite">
            {submitted &&
              validation.errors.map((m) => (
                <li key={m} className="error">
                  {m}
                </li>
              ))}
            {validation.warnings.map((m) => (
              <li key={m} className="warning">
                {m}
              </li>
            ))}
          </ul>
        )}
      </form>
    </Sheet>
  );
}
