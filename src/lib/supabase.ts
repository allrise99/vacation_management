import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordKind, SyncRecord, SyncRemote } from './sync';

/**
 * Supabase 연결 정보는 소스코드에 넣지 않고 빌드할 때 환경변수로 받는다.
 * - 로컬: .env.local 파일 (git에 올라가지 않음)
 * - GitHub Pages: 저장소 Settings → Secrets and variables → Actions → Variables
 * 두 값은 브라우저에 공개되도록 설계된 값이다. 데이터 보호는 데이터베이스의 행 수준 보안(RLS)이 맡는다.
 */
export interface SupabaseConfig {
  url: string;
  key: string;
}

export const TABLE = 'leave_records';
const PAGE_SIZE = 1000;
const PUSH_CHUNK = 500;

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!/^https:\/\/\S+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)) return null;
  if (!key || isSecretKey(key)) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

/** 실수로 서버 전용 비밀 키(service_role / sb_secret_)를 넣은 경우 사용하지 않는다. */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { role?: unknown };
    return json.role === 'service_role';
  } catch {
    return false;
  }
}

let clientPromise: Promise<SupabaseClient> | null = null;

/** 동기화를 쓸 때만 Supabase 라이브러리를 불러온다 (설정이 없으면 다운로드하지 않음). */
export function getClient(config: SupabaseConfig): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // 메일 링크를 요청한 브라우저와 다른 브라우저에서 열어도 로그인되도록 implicit 방식 사용
        flowType: 'implicit',
        storageKey: 'vacation-management:auth',
      },
    }),
  );
  return clientPromise;
}

interface Row {
  kind: RecordKind;
  record_id: string;
  data: unknown | null;
  deleted: boolean;
  updated_at: string;
}

/** 로그인한 사용자 본인의 기록만 읽고 쓴다 (RLS가 서버에서도 강제). */
export function createSupabaseRemote(client: SupabaseClient, userId: string): SyncRemote {
  return {
    async pull() {
      const records: SyncRecord[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await client
          .from(TABLE)
          .select('kind,record_id,data,deleted,updated_at')
          .eq('user_id', userId)
          .order('kind')
          .order('record_id')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Row[];
        for (const row of rows) {
          records.push({ kind: row.kind, id: row.record_id, data: row.data, deleted: row.deleted, updatedAt: row.updated_at });
        }
        if (rows.length < PAGE_SIZE) return records;
      }
    },
    async push(records) {
      for (let i = 0; i < records.length; i += PUSH_CHUNK) {
        const rows = records.slice(i, i + PUSH_CHUNK).map((r) => ({
          user_id: userId,
          kind: r.kind,
          record_id: r.id,
          data: r.deleted ? null : r.data,
          deleted: r.deleted,
          updated_at: r.updatedAt,
        }));
        const { error } = await client.from(TABLE).upsert(rows, { onConflict: 'user_id,kind,record_id' });
        if (error) throw new Error(error.message);
      }
    },
  };
}
