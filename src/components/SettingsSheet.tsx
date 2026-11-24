import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { type AppData, getAnnualGranted, validateAnnualGranted } from '../lib/leave';
import { backupFileName, createBackup, parseBackup } from '../lib/storage';
import type { SyncControls } from '../lib/useSync';
import { Sheet } from './Sheet';
import { InstallSection } from './InstallSection';
import { SyncSection } from './SyncSection';

interface Props {
  data: AppData;
  year: number;
  demoMode: boolean;
  sync: SyncControls;
  onSetGranted: (year: number, value: number) => void;
  onRestore: (data: AppData) => void;
  onResetAll: () => void;
  onToggleDemo: () => void;
  onClose: () => void;
}

export function SettingsSheet({
  data,
  year,
  demoMode,
  sync,
  onSetGranted,
  onRestore,
  onResetAll,
  onToggleDemo,
  onClose,
}: Props) {
  const current = getAnnualGranted(data, year);
  const [granted, setGranted] = useState(current === undefined ? '' : String(current));
  const [grantedError, setGrantedError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const saveGranted = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(granted);
    const error = granted.trim() === '' ? '숫자를 입력하세요.' : validateAnnualGranted(value);
    setGrantedError(error);
    if (error) return;
    onSetGranted(year, value);
    setMessage({ kind: 'ok', text: `${year}년 연차 부여일수를 ${value}일로 저장했습니다.` });
  };

  const exportBackup = () => {
    const blob = new Blob([createBackup(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = backupFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage({ kind: 'ok', text: '백업 파일을 내려받았습니다. 안전한 곳에 보관하세요.' });
  };

  const importBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const restored = parseBackup(await file.text());
      const ok = window.confirm(
        `백업에서 휴가 기록 ${restored.entries.length}건, 연도 설정 ${Object.keys(restored.years).length}개를 불러옵니다.\n` +
          (sync.signedIn
            ? '현재 데이터는 모두 백업 내용으로 바뀌고, 동기화된 다른 기기에도 똑같이 반영됩니다. 계속할까요?'
            : '현재 이 기기에 저장된 데이터는 모두 바뀝니다. 계속할까요?'),
      );
      if (!ok) return;
      onRestore(restored);
      setMessage({ kind: 'ok', text: '백업을 복원했습니다.' });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '복원에 실패했습니다.' });
    }
  };

  return (
    <Sheet title={sync.phase === 'unavailable' ? '설정 · 백업' : '설정 · 동기화 · 백업'} onClose={onClose}>
      <div className="settings">
        {message && (
          <p className={`banner ${message.kind === 'ok' ? 'success' : 'error'}`} role="status">
            {message.text}
          </p>
        )}

        <section>
          <h3>{year}년 연차 부여일수</h3>
          <form className="inline-form" onSubmit={saveGranted} noValidate>
            <label className="field grow">
              <span className="sr-only">{year}년 연차 부여일수</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step={0.5}
                placeholder="예: 15"
                value={granted}
                onChange={(e) => setGranted(e.target.value)}
              />
            </label>
            <button type="submit" className="button primary">
              저장
            </button>
          </form>
          {grantedError && <p className="error-text">{grantedError}</p>}
          <p className="hint">연도마다 따로 설정합니다. 상단에서 연도를 바꾸면 다른 연도를 설정할 수 있습니다.</p>
        </section>

        <SyncSection sync={sync} />

        <InstallSection />

        <section>
          <h3>JSON 백업 · 복원</h3>
          {demoMode && <p className="hint warn">예시 데이터 보기 중에는 백업·복원을 할 수 없습니다.</p>}
          <div className="button-row">
            <button type="button" className="button" onClick={exportBackup} disabled={demoMode}>
              백업 파일 내려받기
            </button>
            <button type="button" className="button" onClick={() => fileRef.current?.click()} disabled={demoMode}>
              백업 복원
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              onChange={importBackup}
            />
          </div>
        </section>

        <section>
          <h3>예시 데이터</h3>
          <p className="hint">
            가상의 예시 기록으로 화면을 체험합니다. 예시 데이터는 저장되지 않고 실제 기록과 섞이지 않습니다.
          </p>
          <button type="button" className="button" onClick={onToggleDemo}>
            {demoMode ? '예시 보기 끝내고 내 기록으로' : '예시 데이터 보기'}
          </button>
        </section>

        {!demoMode && (
          <section>
            <h3>초기화</h3>
            <button
              type="button"
              className="button ghost danger"
              onClick={() => {
                const question = sync.signedIn
                  ? '모든 연차 기록과 설정을 삭제할까요?\n동기화 중이라 서버와 다른 기기에서도 함께 삭제됩니다. 되돌릴 수 없습니다.'
                  : '이 기기에 저장된 모든 연차 기록과 설정을 삭제할까요? 되돌릴 수 없습니다.';
                if (window.confirm(question)) {
                  onResetAll();
                  setGranted('');
                  setMessage({ kind: 'ok', text: '모든 데이터를 삭제했습니다.' });
                }
              }}
            >
              {sync.signedIn ? '모든 기기의 데이터 삭제' : '이 기기의 모든 데이터 삭제'}
            </button>
          </section>
        )}
      </div>
    </Sheet>
  );
}
