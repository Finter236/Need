(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN = 'vault.local' } = window.APP_CONFIG;
  // Вход только по логину и паролю: письма и ссылки не используются.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { detectSessionInUrl: false } });

  const BUCKET = 'files';
  const MAX_SIZE = 50 * 1024 * 1024;     // 50 МБ, как и лимит бакета
  const SIGNED_URL_TTL = 60;             // секунд
  const ALLOWED_EXT = ['pdf','zip','txt','csv','png','jpg','jpeg','gif','webp','docx','xlsx','pptx','mp3','mp4'];
  const ALLOWED_MIME = [
    'application/pdf','application/zip','application/x-zip-compressed','text/plain','text/csv',
    'application/vnd.ms-excel','image/png','image/jpeg','image/gif','image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg','video/mp4'
  ];
  const ICONS = { pdf:'📕', zip:'🗜️', txt:'📄', csv:'📊', xlsx:'📊', docx:'📝', pptx:'📽️',
                  png:'🖼️', jpg:'🖼️', jpeg:'🖼️', gif:'🖼️', webp:'🖼️', mp3:'🎵', mp4:'🎬' };
  const DROP_HINT = 'Перетащите файл сюда или нажмите, чтобы выбрать';

  const $ = (id) => document.getElementById(id);
  const state = { user: null, isAdmin: false, files: [], picked: null, mustChange: false };

  // ---------- утилиты ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
  const fmtSize = (b) => b < 1024 ? `${b} Б` : b < 1048576 ? `${(b/1024).toFixed(1)} КБ` : `${(b/1048576).toFixed(1)} МБ`;
  const fmtDate = (d) => new Date(d).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' });
  let toastTimer;
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  // ---------- сессия ----------
  const VIEWS = ['auth-view', 'setpw-view', 'app-view'];
  const show = (id) => VIEWS.forEach((v) => $(v).classList.toggle('hidden', v !== id));

  async function enterApp(session) {
    // Роль берётся из БД; UI лишь отражает её, реальную защиту обеспечивает RLS.
    const { data } = await sb.from('profiles').select('role, must_change_password').eq('id', session.user.id).maybeSingle();
    state.isAdmin = data?.role === 'admin';
    state.mustChange = data?.must_change_password === true;
    $('user-email').textContent = session.user.email.replace('@' + LOGIN_DOMAIN, '');
    if (state.mustChange) { showSetPw(true); return; }   // первый вход: временный пароль нужно заменить своим
    show('app-view');
    await loadFiles();
    route();
  }

  async function applySession(session) {
    if (session && state.user && session.user.id === state.user.id) return;
    if (!session) {
      Object.assign(state, { user: null, isAdmin: false, files: [] });
      show('auth-view');
      return;
    }
    state.user = session.user;
    await enterApp(session);
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn'), err = $('login-error');
    btn.disabled = true; err.classList.add('hidden');
    const raw = $('login-email').value.trim();
    const email = raw.includes('@') ? raw : `${raw.toLowerCase()}@${LOGIN_DOMAIN}`;   // логин -> служебный адрес
    const { error } = await sb.auth.signInWithPassword({ email, password: $('login-password').value });
    btn.disabled = false;
    if (error) {
      const bad = error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message);
      err.textContent = bad ? 'Неверный логин или пароль.' : `Ошибка входа: ${error.message}`;
      err.classList.remove('hidden');
    } else $('login-password').value = '';
  });

  $('logout-btn').addEventListener('click', () => sb.auth.signOut());

  // ---------- пароль: первый вход и смена ----------
  const MIN_PW = 10;

  function showSetPw(forced) {
    $('setpw-form').reset();
    $('setpw-title').textContent = forced ? 'Задайте пароль' : 'Смена пароля';
    $('setpw-cancel').classList.toggle('hidden', forced);
    $('setpw-error').classList.add('hidden');
    show('setpw-view');
  }

  $('chpw-btn').addEventListener('click', () => showSetPw(false));
  $('setpw-cancel').addEventListener('click', () => show('app-view'));

  $('setpw-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('setpw-1').value, p2 = $('setpw-2').value, err = $('setpw-error'), btn = $('setpw-btn');
    const fail = (m) => { err.textContent = m; err.classList.remove('hidden'); };
    if (p1.length < MIN_PW) return fail(`Пароль короче ${MIN_PW} символов.`);
    if (p1 !== p2) return fail('Пароли не совпадают.');
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) {
      btn.disabled = false;
      return fail(/different/i.test(error.message)
        ? 'Новый пароль должен отличаться от прежнего.' : 'Не удалось сохранить пароль: ' + error.message);
    }
    const wasForced = state.mustChange;
    if (wasForced) {
      const { error: e2 } = await sb.rpc('password_changed');
      if (e2) { btn.disabled = false; return fail('Пароль изменён, но отметку снять не удалось. Выполните supabase/update.sql и войдите снова.'); }
      state.mustChange = false;
    }
    btn.disabled = false;
    toast('Пароль сохранён');
    const { data } = await sb.auth.getSession();
    if (wasForced && data.session) await enterApp(data.session); else show('app-view');
  });

  // ---------- маршрутизация ----------
  function route() {
    const admin = location.hash === '#/admin' && state.isAdmin;
    $('catalog-view').classList.toggle('hidden', admin);
    $('admin-view').classList.toggle('hidden', !admin);
    const on = 'bg-line text-mist', off = 'text-dim hover:text-mist';
    $('tab-catalog').className = `px-3 py-1.5 rounded-lg ${admin ? off : on}`;
    $('tab-admin').className = `${state.isAdmin ? '' : 'hidden '}px-3 py-1.5 rounded-lg ${admin ? on : off}`;
  }
  window.addEventListener('hashchange', route);

  // ---------- данные ----------
  async function loadFiles() {
    const { data, error } = await sb.from('files').select('*').order('created_at', { ascending: false });
    if (error) { toast('Не удалось загрузить список файлов'); return; }
    state.files = data;
    renderFilters(); renderCatalog(); renderAdminList();
  }

  function categories() {
    return [...new Set(state.files.map((f) => f.category))].sort((a, b) => a.localeCompare(b, 'ru'));
  }

  function renderFilters() {
    const sel = $('category-filter'), cur = sel.value;
    sel.innerHTML = '<option value="">Все категории</option>' +
      categories().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.value = categories().includes(cur) ? cur : '';
    $('category-options').innerHTML = categories().map((c) => `<option value="${esc(c)}">`).join('');
  }

  function renderCatalog() {
    const q = $('search').value.trim().toLowerCase(), cat = $('category-filter').value;
    const list = state.files.filter((f) =>
      f.title.toLowerCase().includes(q) && (!cat || f.category === cat));
    $('catalog-list').innerHTML = list.map((f) => `
      <li class="bg-panel border border-line rounded-xl p-4 flex items-start gap-4">
        <span class="text-3xl leading-none mt-1" aria-hidden="true">${ICONS[extOf(f.file_name)] || '📁'}</span>
        <div class="min-w-0 flex-1">
          <h3 class="font-medium truncate">${esc(f.title)}</h3>
          ${f.description ? `<p class="text-sm text-dim mt-1 break-words">${esc(f.description)}</p>` : ''}
          <p class="text-xs text-dim mt-2">${esc(f.category)} · ${fmtSize(f.size)} · ${fmtDate(f.created_at)}</p>
        </div>
        <button class="btn btn-primary shrink-0" data-download="${esc(f.id)}" type="button">Скачать</button>
      </li>`).join('');
    const empty = $('catalog-empty');
    empty.classList.toggle('hidden', list.length > 0);
    empty.textContent = state.files.length ? 'Ничего не найдено. Измените запрос или категорию.' : 'Пока нет файлов.';
  }

  function renderAdminList() {
    $('tab-admin').classList.toggle('hidden', !state.isAdmin);
    $('admin-list').innerHTML = state.files.length ? state.files.map((f) => `
      <li class="bg-panel border border-line rounded-xl p-4 flex items-center gap-4">
        <span class="text-2xl" aria-hidden="true">${ICONS[extOf(f.file_name)] || '📁'}</span>
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">${esc(f.title)}</p>
          <p class="text-xs text-dim">${esc(f.file_name)} · ${fmtSize(f.size)} · ${fmtDate(f.created_at)}</p>
        </div>
        <button class="btn btn-ghost" data-edit="${esc(f.id)}" type="button">Изменить</button>
        <button class="btn btn-danger" data-delete="${esc(f.id)}" type="button">Удалить</button>
      </li>`).join('') : '<li class="text-dim">Файлов пока нет. Загрузите первый выше.</li>';
  }

  $('search').addEventListener('input', renderCatalog);
  $('category-filter').addEventListener('change', renderCatalog);

  // ---------- скачивание: временная подписанная ссылка ----------
  $('catalog-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-download]'); if (!btn) return;
    const f = state.files.find((x) => x.id === btn.dataset.download); if (!f) return;
    btn.disabled = true;
    const { data, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(f.file_path, SIGNED_URL_TTL, { download: f.file_name });
    btn.disabled = false;
    if (error || !data?.signedUrl) { toast('Не удалось получить ссылку на скачивание'); return; }
    const a = document.createElement('a'); a.href = data.signedUrl; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  });

  // ---------- загрузка (админ) ----------
  const drop = $('drop-zone'), input = $('file-input');

  function validate(file) {
    if (!ALLOWED_EXT.includes(extOf(file.name))) return 'Этот тип файла не разрешён.';
    if (file.type && !ALLOWED_MIME.includes(file.type)) return 'Этот тип файла не разрешён.';
    if (file.size > MAX_SIZE) return `Файл больше ${fmtSize(MAX_SIZE)}.`;
    if (file.size === 0) return 'Файл пустой.';
    return null;
  }

  function pick(file) {
    if (!file) return;
    const problem = validate(file);
    if (problem) { toast(problem); state.picked = null; $('drop-label').textContent = DROP_HINT; return; }
    state.picked = file;
    $('drop-label').textContent = `${file.name} · ${fmtSize(file.size)}`;
    if (!$('f-title').value) $('f-title').value = file.name.replace(/\.[^.]+$/, '');
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => pick(input.files[0]));
  ['dragenter','dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drop-active'); }));
  ['dragleave','drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drop-active'); }));
  drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

  $('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, file = state.picked, msg = $('upload-msg'), btn = $('upload-btn');
    if (!file) { msg.textContent = 'Сначала выберите файл.'; return; }
    btn.disabled = true; msg.textContent = 'Загрузка…';
    const path = `${crypto.randomUUID()}.${extOf(file.name)}`;   // имя на диске не зависит от ввода пользователя
    const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (up.error) { btn.disabled = false; msg.textContent = 'Ошибка загрузки: ' + up.error.message; return; }
    const ins = await sb.from('files').insert({
      title: $('f-title').value.trim(),
      description: $('f-desc').value.trim(),
      category: $('f-category').value.trim() || 'Прочее',
      file_path: path, file_name: file.name, size: file.size, mime_type: file.type || null,
    });
    btn.disabled = false;
    if (ins.error) {
      await sb.storage.from(BUCKET).remove([path]);               // откат: не оставляем «осиротевший» файл
      msg.textContent = 'Не удалось сохранить запись: ' + ins.error.message; return;
    }
    form.reset(); state.picked = null; input.value = '';
    $('drop-label').textContent = DROP_HINT;
    msg.textContent = ''; toast('Файл загружен');
    await loadFiles();
  });

  // ---------- изменение и удаление (админ) ----------
  $('admin-list').addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-edit]'), del = e.target.closest('[data-delete]');
    const id = edit ? edit.dataset.edit : del ? del.dataset.delete : null;
    const f = state.files.find((x) => x.id === id);
    if (!f) return;

    if (edit) {
      const title = prompt('Название', f.title); if (title === null || !title.trim()) return;
      const description = prompt('Описание', f.description); if (description === null) return;
      const { error } = await sb.from('files').update({ title: title.trim(), description: description.trim() }).eq('id', f.id);
      if (error) toast('Не удалось сохранить изменения'); else { toast('Изменения сохранены'); await loadFiles(); }
    } else {
      if (!confirm(`Удалить «${f.title}»? Файл будет удалён безвозвратно.`)) return;
      const rm = await sb.storage.from(BUCKET).remove([f.file_path]);
      if (rm.error) { toast('Не удалось удалить файл из хранилища'); return; }
      const { error } = await sb.from('files').delete().eq('id', f.id);
      if (error) toast('Не удалось удалить запись'); else { toast('Файл удалён'); await loadFiles(); }
    }
  });

  // ---------- старт ----------
  sb.auth.onAuthStateChange((evt, session) => {
    // откладываем, чтобы не вызывать запросы Supabase внутри самого колбэка
    if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') setTimeout(() => applySession(session), 0);
  });
  if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.startsWith('YOUR-')) {
    $('login-error').textContent = 'Не заполнен js/config.js: впишите URL проекта и anon-ключ Supabase.';
    $('login-error').classList.remove('hidden');
  }
  sb.auth.getSession().then(({ data }) => applySession(data.session));
})();
