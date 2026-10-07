-- Для тех, кто уже выполнил прежний schema.sql.
-- Добавляет принудительную смену временного пароля при первом входе.
alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
