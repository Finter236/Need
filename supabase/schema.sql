-- Выполните целиком в Supabase: SQL Editor -> New query -> Run

-- 1. Профили и роли ----------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user', 'admin')),
  must_change_password boolean not null default true,   -- true до первой смены временного пароля
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Профиль создаётся автоматически с ролью 'user'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Проверка роли (security definer, чтобы политики не зацикливались)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Пользователь видит только свой профиль.
-- Политик на insert/update/delete нет, поэтому роль нельзя изменить из браузера.
create policy "profiles: read own" on public.profiles
  for select to authenticated using (id = auth.uid());

-- Снимает отметку «нужно сменить пароль» только у вызвавшего пользователя
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;

-- 2. Метаданные файлов -------------------------------------------------------
create table public.files (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  category text not null default 'Прочее' check (char_length(category) <= 60),
  file_path text not null unique,
  file_name text not null,
  size bigint not null check (size > 0 and size <= 52428800),
  mime_type text,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id)
);
alter table public.files enable row level security;

create policy "files: read for signed-in" on public.files
  for select to authenticated using (true);
create policy "files: insert admin" on public.files
  for insert to authenticated with check (public.is_admin());
create policy "files: update admin" on public.files
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "files: delete admin" on public.files
  for delete to authenticated using (public.is_admin());

-- 3. Приватный бакет ---------------------------------------------------------
-- 52428800 байт = 50 МБ (лимит бесплатного плана). Типы файлов проверяются и на сервере.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 52428800, array[
  'application/pdf', 'application/zip', 'application/x-zip-compressed',
  'text/plain', 'text/csv', 'application/vnd.ms-excel',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg', 'video/mp4'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "storage: read for signed-in" on storage.objects
  for select to authenticated using (bucket_id = 'files');
create policy "storage: insert admin" on storage.objects
  for insert to authenticated with check (bucket_id = 'files' and public.is_admin());
create policy "storage: update admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'files' and public.is_admin())
  with check (bucket_id = 'files' and public.is_admin());
create policy "storage: delete admin" on storage.objects
  for delete to authenticated using (bucket_id = 'files' and public.is_admin());

-- 4. Назначить администратора (после создания пользователя в Authentication) --
-- update public.profiles set role = 'admin' where email = 'admin@vault.local';
