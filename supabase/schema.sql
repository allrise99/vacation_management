-- 연차 관리 앱 동기화용 테이블
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여 넣고 Run 하세요. 여러 번 실행해도 안전합니다.

create table if not exists public.leave_records (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('entry', 'year')),
  record_id  text        not null check (char_length(record_id) between 1 and 100),
  data       jsonb       check (data is null or pg_column_size(data) <= 4096),
  deleted    boolean     not null default false,
  updated_at timestamptz not null,
  primary key (user_id, kind, record_id)
);

-- 행 수준 보안: 로그인한 사용자는 자기 기록만 읽고 쓸 수 있다
alter table public.leave_records enable row level security;

drop policy if exists "leave_records_select_own" on public.leave_records;
create policy "leave_records_select_own" on public.leave_records
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "leave_records_insert_own" on public.leave_records;
create policy "leave_records_insert_own" on public.leave_records
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "leave_records_update_own" on public.leave_records;
create policy "leave_records_update_own" on public.leave_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "leave_records_delete_own" on public.leave_records;
create policy "leave_records_delete_own" on public.leave_records
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 로그인 사용자만 접근 (비로그인 anon 역할은 접근 불가)
revoke all on public.leave_records from anon;
grant select, insert, update, delete on public.leave_records to authenticated;

-- 더 오래된 수정이 늦게 도착해도 최신 기록을 덮어쓰지 않도록 서버에서 한 번 더 막는다
create or replace function public.leave_records_keep_newer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    return null; -- 이 행의 변경을 건너뜀
  end if;
  return new;
end;
$$;

drop trigger if exists leave_records_keep_newer on public.leave_records;
create trigger leave_records_keep_newer
  before update on public.leave_records
  for each row execute function public.leave_records_keep_newer();
