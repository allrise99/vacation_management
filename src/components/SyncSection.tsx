import { type FormEvent, useState } from 'react';
import type { SyncControls } from '../lib/useSync';
import { isStandalone } from '../lib/pwa';
import { formatSyncTime } from './SyncBanner';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 설정 시트의 "기기 간 동기화" 영역: 이메일 로그인, 상태, 수동 동기화, 로그아웃 */
export function SyncSection({ sync }: { sync: SyncControls }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [standalone] = useState(isStandalone);

  if (sync.phase === 'unavailable') {
    return (
      <section>
        <h3>데이터 저장 안내</h3>
        <p className="banner info">
          모든 데이터는 <b>이 기기의 이 브라우저(localStorage)</b>에만 저장됩니다. PC와 스마트폰 사이에{' '}
          <b>자동 동기화되지 않으며</b>, 서버로 전송되지 않습니다. 브라우저 데이터를 지우면 기록도 사라지니
          주기적으로 백업하세요.
        </p>
        <p className="hint">
          다른 기기로 옮기려면: 이 기기에서 백업 파일 내려받기 → 다른 기기에서 백업 복원. 백업 파일에는 개인
          기록이 들어 있으니 공개 저장소나 공유 폴더에 올리지 마세요.
        </p>
      </section>
    );
  }

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      if (ok) setMessage({ kind: 'ok', text: ok });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : '요청에 실패했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const requestEmail = (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setMessage({ kind: 'error', text: '이메일 주소를 확인하세요.' });
      return;
    }
    void run(async () => {
      await sync.sendLoginEmail(value);
      setSentTo(value);
      setCode('');
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    const value = code.replace(/\s/g, '');
    if (!sentTo) return;
    if (!/^\d{6,10}$/.test(value)) {
      setMessage({ kind: 'error', text: '메일에 있는 숫자 코드를 입력하세요.' });
      return;
    }
    void run(() => sync.verifyCode(sentTo, value));
  };

  if (sync.signedIn) {
    const status =
      sync.phase === 'syncing'
        ? '동기화 중…'
        : sync.phase === 'offline'
          ? '오프라인 · 연결되면 자동으로 동기화합니다'
          : sync.phase === 'error'
            ? sync.error ?? '동기화하지 못했습니다.'
            : `동기화됨${sync.lastSyncedAt ? ` · ${formatSyncTime(sync.lastSyncedAt)}` : ''}`;
    return (
      <section>
        <h3>기기 간 동기화</h3>
        {message && <p className={`banner ${message.kind === 'ok' ? 'success' : 'error'}`}>{message.text}</p>}
        <div className="sync-account">
          <p>
            <b className="account-email">{sync.email ?? '로그인됨'}</b> 계정으로 동기화 중
          </p>
          <p className={`sync-line ${sync.phase}`}>{status}</p>
        </div>
        <div className="button-row">
          <button type="button" className="button" onClick={sync.syncNow} disabled={sync.phase === 'syncing'}>
            지금 동기화
          </button>
          <button
            type="button"
            className="button ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm('이 기기에서 로그아웃할까요? 이 기기의 기록은 남아 있고, 다시 로그인하면 이어서 동기화됩니다.'))
                void run(sync.signOut);
            }}
          >
            로그아웃
          </button>
        </div>
        <p className="hint">
          수정하면 몇 초 안에 서버에 올라가고, 다른 기기는 앱을 열거나 다시 볼 때 받아옵니다. 같은 기록을 두 기기에서
          따로 고치면 <b>나중에 고친 쪽</b>이 남습니다. 인터넷이 끊겨도 이 기기에 저장되고, 연결되면 올라갑니다.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h3>기기 간 동기화</h3>
      {sync.error && !message && <p className="banner error">{sync.error}</p>}
      {message && <p className={`banner ${message.kind === 'ok' ? 'success' : 'error'}`}>{message.text}</p>}
      <p className="hint">
        이메일로 로그인하면 PC와 휴대폰의 기록이 자동으로 합쳐집니다. 비밀번호는 없고, 메일로 받은 링크나 코드로
        로그인합니다. 이 기기에 이미 있는 기록도 계정에 함께 올라갑니다.
      </p>
      {sync.phase === 'loading' ? (
        <p className="hint">동기화 기능을 불러오는 중…</p>
      ) : !sentTo ? (
        <form className="inline-form" onSubmit={requestEmail} noValidate>
          <label className="field grow">
            <span className="sr-only">이메일</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="이메일 주소"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? '보내는 중…' : '로그인 메일 받기'}
          </button>
        </form>
      ) : (
        <>
          <p className="banner success">
            <b className="account-email">{sentTo}</b>로 로그인 메일을 보냈습니다.{' '}
            {standalone ? (
              <>
                홈 화면 앱에서는 메일의 <b>숫자 코드</b>를 아래에 입력하세요. (링크를 누르면 브라우저에서 열려 이 앱에는
                로그인되지 않습니다.)
              </>
            ) : (
              <>
                <b>이 기기에서</b> 메일의 링크를 누르거나, 메일에 적힌 숫자 코드를 아래에 입력하세요.
              </>
            )}
          </p>
          <form className="inline-form" onSubmit={submitCode} noValidate>
            <label className="field grow">
              <span className="sr-only">메일로 받은 코드</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="숫자 코드"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? '확인 중…' : '확인'}
            </button>
          </form>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setSentTo(null);
              setMessage(null);
            }}
          >
            다른 이메일로 / 메일 다시 받기
          </button>
        </>
      )}
    </section>
  );
}
