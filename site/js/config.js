// Project URL и anon (public) key: Supabase -> Project Settings -> API.
// anon-ключ публичный по дизайну: доступ ограничивают RLS-политики, а не секретность ключа.
// НИКОГДА не размещайте здесь service_role ключ.
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
};
