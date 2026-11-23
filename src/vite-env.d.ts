/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase 프로젝트 주소 (예: https://abcd1234.supabase.co). 없으면 동기화 기능이 꺼진다. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase 공개 키 (anon 또는 publishable key). 브라우저에 공개되도록 설계된 값이다. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
