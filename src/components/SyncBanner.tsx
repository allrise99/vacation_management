import type { SyncControls } from '../lib/useSync';

interface Props {
  sync: SyncControls;
  onOpenSettings: () => void;
}

export function formatSyncTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

/** 화면 상단의 저장·동기화 상태 안내 */
export function SyncBanner({ sync, onOpenSettings }: Props) {
  switch (sync.phase) {
    case 'unavailable':
      return (
        <p className="banner info sync-notice">
          이 기기 브라우저에만 저장되며 <b>기기 간 자동 동기화되지 않습니다.</b>{' '}
          <button type="button" className="link-button" onClick={onOpenSettings}>
            백업·복원
          </button>
          으로 옮기세요.
        </p>
      );
    case 'loading':
      return null;
    case 'signed-out':
      return (
        <div className="banner info sync-notice sync-signin">
          <span>
            {sync.error ? <span className="error-inline">{sync.error} </span> : null}
            지금은 이 기기에만 저장됩니다. <b>로그인하면 PC와 휴대폰이 자동으로 동기화됩니다.</b>
          </span>
          <button type="button" className="button small primary" onClick={onOpenSettings}>
            로그인
          </button>
        </div>
      );
    case 'error':
      return (
        <div className="banner error sync-error" role="alert">
          <span>{sync.error ?? '동기화하지 못했습니다.'} 기록은 이 기기에 안전하게 저장되어 있습니다.</span>
          <button type="button" className="button small" onClick={sync.syncNow}>
            다시 시도
          </button>
        </div>
      );
    default: {
      const label =
        sync.phase === 'syncing'
          ? '동기화 중…'
          : sync.phase === 'offline'
            ? '오프라인 · 연결되면 자동으로 동기화합니다'
            : `동기화됨${sync.lastSyncedAt ? ` · ${formatSyncTime(sync.lastSyncedAt)}` : ''}`;
      return (
        <button type="button" className={`sync-status ${sync.phase}`} onClick={onOpenSettings} aria-live="polite">
          <i aria-hidden="true" />
          <span>{label}</span>
        </button>
      );
    }
  }
}
