import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarView } from './components/CalendarView';
import { EntryForm } from './components/EntryForm';
import { EntryList } from './components/EntryList';
import { SettingsSheet } from './components/SettingsSheet';
import { SummaryCards } from './components/SummaryCards';
import { formatRange, todayIso, yearOf } from './lib/date';
import { createDemoData } from './lib/demo';
import {
  type AppData,
  type LeaveDraft,
  type LeaveEntry,
  LEAVE_TYPE_LABEL,
  emptyData,
  entriesForYear,
  formatDays,
  summarizeYear,
} from './lib/leave';
import { clearData, loadData, newId, saveData } from './lib/storage';

type View = 'calendar' | 'list';
type FormState = { mode: 'add'; date: string } | { mode: 'edit'; entry: LeaveEntry } | null;

function useToday(): string {
  const [today, setToday] = useState(() => todayIso());
  useEffect(() => {
    const refresh = () => setToday(todayIso());
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}

export default function App() {
  const today = useToday();
  const [realData, setRealData] = useState<AppData>(() => loadData());
  const [demoData, setDemoData] = useState<AppData | null>(null);
  const demoMode = demoData !== null;
  const data = demoData ?? realData;

  const [year, setYear] = useState(() => yearOf(todayIso()));
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [view, setView] = useState<View>('calendar');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // 실제 데이터만 localStorage에 저장 (예시 데이터는 저장하지 않음)
  useEffect(() => {
    setSaveFailed(!saveData(realData));
  }, [realData]);

  const update = useCallback(
    (fn: (prev: AppData) => AppData) => {
      if (demoMode) setDemoData((prev) => (prev ? fn(prev) : prev));
      else setRealData(fn);
    },
    [demoMode],
  );

  const summary = useMemo(() => summarizeYear(data, year, today), [data, year, today]);
  const yearEntries = useMemo(() => entriesForYear(data.entries, year), [data.entries, year]);
  const nextPlanned = yearEntries.find((e) => e.startDate > today);

  const years = useMemo(() => {
    const set = new Set<number>([yearOf(today), year]);
    Object.keys(data.years).forEach((y) => set.add(Number(y)));
    data.entries.forEach((e) => set.add(yearOf(e.startDate)));
    return [...set].sort((a, b) => a - b);
  }, [data, today, year]);

  const changeYear = (next: number) => {
    setYear(next);
    setMonth(next === yearOf(today) ? new Date().getMonth() : 0);
    setSelectedDate(null);
  };

  const defaultAddDate = () => {
    if (selectedDate && yearOf(selectedDate) === year) return selectedDate;
    return year === yearOf(today) ? today : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  };

  const saveEntry = (draft: LeaveDraft, id?: string) => {
    const now = new Date().toISOString();
    update((prev) => ({
      ...prev,
      entries: id
        ? prev.entries.map((e) => (e.id === id ? { ...e, ...draft, updatedAt: now } : e))
        : [...prev.entries, { ...draft, id: demoMode ? `demo-${newId()}` : newId(), createdAt: now, updatedAt: now }],
    }));
    const y = yearOf(draft.startDate);
    if (y !== year) setYear(y);
    setMonth(Number(draft.startDate.slice(5, 7)) - 1);
    setSelectedDate(draft.startDate);
    setForm(null);
  };

  const deleteEntry = (entry: LeaveEntry) => {
    const label = `${formatRange(entry.startDate, entry.endDate)} ${LEAVE_TYPE_LABEL[entry.type]} (${formatDays(entry.days)})`;
    if (!window.confirm(`${label} 기록을 삭제할까요?`)) return;
    update((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== entry.id) }));
    setForm(null);
  };

  const setGranted = (y: number, value: number) =>
    update((prev) => ({ ...prev, years: { ...prev.years, [String(y)]: { annualGranted: value } } }));

  const toggleDemo = () => {
    setDemoData((prev) => (prev ? null : createDemoData(today)));
    setYear(yearOf(today));
    setMonth(new Date().getMonth());
    setSelectedDate(null);
    setSettingsOpen(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <h1>연차 관리</h1>
          <div className="year-picker" aria-label="연도 선택">
            <button type="button" className="icon-button" onClick={() => changeYear(year - 1)} aria-label="이전 연도">
              ‹
            </button>
            <select value={year} onChange={(e) => changeYear(Number(e.target.value))} aria-label="연도">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <button type="button" className="icon-button" onClick={() => changeYear(year + 1)} aria-label="다음 연도">
              ›
            </button>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="button primary desktop-only"
              onClick={() => setForm({ mode: 'add', date: defaultAddDate() })}
            >
              + 연차 추가
            </button>
            <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="설정 및 백업">
              ⚙
            </button>
          </div>
        </div>
      </header>

      <main className="content">
        {demoMode && (
          <div className="banner demo" role="status">
            <span>
              <b>예시 데이터 보기 중</b> · 가상의 기록이며 저장되지 않습니다. 실제 기록에는 영향이 없습니다.
            </span>
            <button type="button" className="button small" onClick={toggleDemo}>
              내 기록으로 돌아가기
            </button>
          </div>
        )}

        <p className="banner info sync-notice">
          이 기기 브라우저에만 저장되며 <b>기기 간 자동 동기화되지 않습니다.</b>{' '}
          <button type="button" className="link-button" onClick={() => setSettingsOpen(true)}>
            백업·복원
          </button>
          으로 옮기세요.
        </p>
        {saveFailed && !demoMode && (
          <p className="banner error" role="alert">
            브라우저에 저장하지 못했습니다. 사생활 보호 모드이거나 저장 공간이 부족할 수 있습니다. 백업 파일을
            내려받아 두세요.
          </p>
        )}

        <div className="layout">
          <div className="col-summary">
            <SummaryCards summary={summary} onSetGranted={() => setSettingsOpen(true)} />
            {nextPlanned && (
              <p className="card next-up">
                다음 휴가 <b>{formatRange(nextPlanned.startDate, nextPlanned.endDate)}</b>{' '}
                <span className="dim">
                  {LEAVE_TYPE_LABEL[nextPlanned.type]} · {formatDays(nextPlanned.days)}
                </span>
              </p>
            )}
          </div>

          <div className="col-main">
            <div className="segmented tabs" role="tablist" aria-label="보기 전환">
              <button type="button" role="tab" aria-selected={view === 'calendar'} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
                달력
              </button>
              <button type="button" role="tab" aria-selected={view === 'list'} aria-pressed={view === 'list'} onClick={() => setView('list')}>
                사용 내역 ({yearEntries.length})
              </button>
            </div>

            {view === 'calendar' ? (
              <CalendarView
                year={year}
                month={month}
                entries={yearEntries}
                today={today}
                selectedDate={selectedDate}
                onMonthChange={(m) => {
                  setMonth(Math.min(11, Math.max(0, m)));
                  setSelectedDate(null);
                }}
                onSelectDate={(d) => setSelectedDate(d === selectedDate ? null : d)}
                onAdd={(d) => setForm({ mode: 'add', date: d })}
                onEdit={(entry) => setForm({ mode: 'edit', entry })}
              />
            ) : (
              <EntryList
                entries={yearEntries}
                today={today}
                onEdit={(entry) => setForm({ mode: 'edit', entry })}
                onDelete={deleteEntry}
              />
            )}
          </div>
        </div>

        <footer className="page-footer">
          <p>개인 기록은 서버로 전송되지 않으며 이 브라우저에만 보관됩니다.</p>
        </footer>
      </main>

      <div className="fab-bar mobile-only">
        <button type="button" className="fab" onClick={() => setForm({ mode: 'add', date: defaultAddDate() })}>
          + 연차 추가
        </button>
      </div>

      {form && (
        <EntryForm
          data={data}
          today={today}
          initial={form.mode === 'edit' ? form.entry : undefined}
          initialDate={form.mode === 'add' ? form.date : form.entry.startDate}
          onSave={saveEntry}
          onDelete={deleteEntry}
          onClose={() => setForm(null)}
        />
      )}

      {settingsOpen && (
        <SettingsSheet
          data={data}
          year={year}
          demoMode={demoMode}
          onSetGranted={setGranted}
          onRestore={(restored) => setRealData(restored)}
          onResetAll={() => {
            clearData();
            setRealData(emptyData());
          }}
          onToggleDemo={toggleDemo}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
