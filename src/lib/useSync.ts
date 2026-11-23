import type { SupabaseClient } from '@supabase/supabase-js';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from './leave';
import { createSupabaseRemote, getClient, getSupabaseConfig } from './supabase';
import { mergeRemote } from './sync';

export type SyncPhase =
  | 'unavailable' // 이 배포에 Supabase 설정이 없음 → 기기 저장만
  | 'loading' // 로그인 상태 확인 중
  | 'signed-out'
  | 'syncing'
  | 'synced'
  | 'offline'
  | 'error';

export interface SyncState {
  phase: SyncPhase;
  email?: string;
  lastSyncedAt?: string;
  error?: string;
}

export interface SyncControls extends SyncState {
  signedIn: boolean;
  sendLoginEmail: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => void;
}

const META_KEY = 'vacation-management:sync:v1';
const DEBOUNCE_MS = 1200;
const INTERVAL_MS = 60_000;
const FOCUS_THROTTLE_MS = 10_000;

function loadLastSynced(): string | undefined {
  try {
    const raw = localStorage.getItem(META_KEY);
    const value = raw ? (JSON.parse(raw) as { lastSyncedAt?: unknown }).lastSyncedAt : undefined;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveLastSynced(value: string | undefined): void {
  try {
    if (value) localStorage.setItem(META_KEY, JSON.stringify({ lastSyncedAt: value }));
    else localStorage.removeItem(META_KEY);
  } catch {
    /* ignore */
  }
}

/** Supabase 오류 메시지를 사용자용 한국어로 바꾼다. */
export function describeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('only request this after') || msg.includes('security purposes'))
    return '메일을 너무 자주 요청했습니다. 잠시 후 다시 시도하세요.';
  if (msg.includes('signups not allowed') || msg.includes('signup is disabled'))
    return '가입이 허용되지 않은 이메일입니다. 처음 로그인했던 이메일을 입력하세요.';
  if (msg.includes('expired') || (msg.includes('invalid') && msg.includes('token')))
    return '코드가 틀렸거나 만료되었습니다. 메일을 다시 요청하세요.';
  if (msg.includes('relation') && msg.includes('does not exist'))
    return '서버에 기록 테이블이 없습니다. README의 Supabase 설정(SQL 실행)을 확인하세요.';
  if (msg.includes('could not find the table') || msg.includes('schema cache'))
    return '서버에 기록 테이블이 없습니다. README의 Supabase 설정(SQL 실행)을 확인하세요.';
  if (msg.includes('permission denied') || msg.includes('row-level security'))
    return '서버 권한 설정(RLS 정책)에 막혔습니다. README의 Supabase 설정을 확인하세요.';
  if (msg.includes('jwt') || msg.includes('not authenticated'))
    return '로그인이 만료되었습니다. 다시 로그인하세요.';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed'))
    return '서버에 연결하지 못했습니다. 인터넷 연결을 확인하세요.';
  return raw ? `동기화 오류: ${raw}` : '동기화 중 알 수 없는 오류가 발생했습니다.';
}

/** 메일 링크가 만료되는 등 로그인 실패 정보가 주소(#error=...)로 돌아온 경우 읽고 주소를 정리한다. */
function takeAuthErrorFromUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location.hash.includes('error')) return undefined;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const code = params.get('error_code') ?? params.get('error');
  if (!code) return undefined;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return code === 'otp_expired'
    ? '로그인 링크가 만료되었거나 이미 사용되었습니다. 메일을 다시 요청하세요.'
    : `로그인하지 못했습니다 (${params.get('error_description') ?? code}).`;
}

/**
 * 로컬 우선 동기화.
 * - 데이터는 항상 이 기기(localStorage)에 먼저 저장되고, 로그인되어 있으면 서버와 기록 단위로 합친다.
 * - 동기화 시점: 로그인 직후, 수정 후 잠시 뒤, 앱으로 돌아올 때, 인터넷 재연결 시, 열려 있는 동안 1분마다.
 * @param localRevision 사용자가 데이터를 바꿀 때마다 증가하는 값 (서버에서 받아 온 변경은 해당 없음)
 */
export function useSync(
  data: AppData,
  setData: Dispatch<SetStateAction<AppData>>,
  localRevision: number,
): SyncControls {
  const config = useMemo(() => getSupabaseConfig(), []);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [state, setState] = useState<SyncState>(() =>
    config ? { phase: 'loading', lastSyncedAt: loadLastSynced() } : { phase: 'unavailable' },
  );

  const dataRef = useRef(data);
  dataRef.current = data;
  const running = useRef(false);
  const again = useRef(false);
  const debounce = useRef<number | undefined>(undefined);
  const lastRunAt = useRef(0);

  // 시작: 라이브러리 로드 + 로그인 상태 확인 (메일 링크로 돌아온 경우 여기서 로그인 처리됨)
  useEffect(() => {
    if (!config) return;
    const urlError = takeAuthErrorFromUrl();
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    getClient(config)
      .then(async (c) => {
        if (cancelled) return;
        const { data: sub } = c.auth.onAuthStateChange((_event, session) => {
          const u = session?.user;
          setUser((prev) => (u ? (prev?.id === u.id ? prev : { id: u.id, email: u.email }) : null));
        });
        unsubscribe = () => sub.subscription.unsubscribe();
        const { data: sessionData } = await c.auth.getSession();
        if (cancelled) return;
        const u = sessionData.session?.user;
        // 메일 링크 로그인 후 주소 끝에 남는 '#' 정리
        if (window.location.href.endsWith('#')) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
        setClient(c);
        setUser(u ? { id: u.id, email: u.email } : null);
        if (!u) setState((s) => ({ ...s, phase: 'signed-out', error: urlError }));
      })
      .catch((err) => {
        if (!cancelled) setState({ phase: 'error', error: `동기화 기능을 불러오지 못했습니다. ${describeSyncError(err)}` });
      });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [config]);

  const runSync = useCallback(async () => {
    if (!client || !user) return;
    if (running.current) {
      again.current = true;
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState((s) => ({ ...s, phase: 'offline', error: undefined }));
      return;
    }
    window.clearTimeout(debounce.current);
    debounce.current = undefined;
    running.current = true;
    lastRunAt.current = Date.now();
    setState((s) => ({ ...s, phase: 'syncing' }));
    try {
      const remote = createSupabaseRemote(client, user.id);
      const records = await remote.pull();
      // 서버 기록을 이 기기에 반영 (그 사이 바뀐 로컬 값과 다시 합친다)
      setData((prev) => {
        const merged = mergeRemote(prev, records);
        return merged.changed ? merged.data : prev;
      });
      // 이 기기 쪽이 새로운 기록만 서버로 올린다
      const { toPush } = mergeRemote(dataRef.current, records);
      if (toPush.length) await remote.push(toPush);
      const now = new Date().toISOString();
      saveLastSynced(now);
      setState((s) => ({ ...s, phase: 'synced', lastSyncedAt: now, error: undefined }));
    } catch (err) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setState((s) => ({ ...s, phase: offline ? 'offline' : 'error', error: offline ? undefined : describeSyncError(err) }));
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        void runSyncRef.current();
      }
    }
  }, [client, user, setData]);

  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;

  // 로그인되면 바로 동기화
  useEffect(() => {
    if (!client) return;
    if (user) {
      setState((s) => ({ ...s, email: user.email, error: undefined }));
      void runSyncRef.current();
    } else {
      setState((s) => (s.phase === 'loading' || s.phase === 'unavailable' ? s : { ...s, phase: 'signed-out', email: undefined }));
    }
  }, [client, user]);

  // 사용자가 데이터를 바꾸면 잠시 뒤 동기화 (연속 입력은 한 번에)
  useEffect(() => {
    if (!client || !user || localRevision === 0) return;
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void runSyncRef.current(), DEBOUNCE_MS);
  }, [client, user, localRevision]);

  // 앱으로 돌아올 때, 인터넷이 다시 연결될 때, 열려 있는 동안 주기적으로
  useEffect(() => {
    if (!client || !user) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        // 화면을 떠나기 전 대기 중인 변경을 바로 올린다
        if (debounce.current !== undefined) void runSyncRef.current();
      } else if (Date.now() - lastRunAt.current > FOCUS_THROTTLE_MS) {
        void runSyncRef.current();
      }
    };
    const onOnline = () => void runSyncRef.current();
    const onOffline = () => setState((s) => ({ ...s, phase: 'offline', error: undefined }));
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runSyncRef.current();
    }, INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [client, user]);

  const sendLoginEmail = useCallback(
    async (email: string) => {
      if (!client) throw new Error('동기화 기능을 불러오는 중입니다. 잠시 후 다시 시도하세요.');
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) throw new Error(describeSyncError(error));
    },
    [client],
  );

  const verifyCode = useCallback(
    async (email: string, code: string) => {
      if (!client) throw new Error('동기화 기능을 불러오는 중입니다. 잠시 후 다시 시도하세요.');
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error(describeSyncError(error));
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    // 이 기기에서만 로그아웃 (다른 기기 로그인은 유지). 이 기기의 기록은 그대로 남는다.
    await client.auth.signOut({ scope: 'local' });
    saveLastSynced(undefined);
    setUser(null);
    setState({ phase: 'signed-out' });
  }, [client]);

  const syncNow = useCallback(() => void runSyncRef.current(), []);

  return { ...state, signedIn: !!user && state.phase !== 'unavailable', sendLoginEmail, verifyCode, signOut, syncNow };
}
