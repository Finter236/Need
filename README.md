# Файловое хранилище (GitHub Pages + Supabase)

```
file-vault/
├── .github/workflows/deploy.yml   # автодеплой на GitHub Pages
├── supabase/schema.sql            # таблицы, RLS, приватный бакет
├── site/                          # то, что публикуется
│   ├── index.html                 # UI (Tailwind, тёмная тема)
│   └── js/
│       ├── config.js              # URL и anon-ключ Supabase
│       └── app.js                 # вся логика
└── README.md
```

## 1. Supabase

1. Зарегистрируйтесь на supabase.com и создайте проект (Free plan).
2. **SQL Editor → New query**: вставьте `supabase/schema.sql`, нажмите Run.
3. **Authentication → Sign In / Providers → Email**: отключите **Allow new users to sign up**.
   Без этого любой желающий сможет зарегистрироваться и получить доступ к каталогу.
4. **Authentication → Users → Add user → Create new user**: создайте пользователей
   (отметьте Auto Confirm User). Так вы сами выдаёте доступ.
5. Сделайте себя администратором (SQL Editor):
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
6. **Project Settings → API**: скопируйте Project URL и `anon public` key
   в `site/js/config.js`. Ключ `service_role` никуда не копируйте.
7. **Authentication → URL Configuration**: в Site URL укажите адрес будущего сайта
   (`https://<user>.github.io/<repo>/`).

## 2. Деплой на GitHub Pages

1. Создайте репозиторий и загрузите содержимое папки `file-vault` в ветку `main`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. После пуша в `main` workflow опубликует папку `site/`. Адрес появится в Actions и в Settings → Pages.

Репозиторий может быть публичным: в нём нет секретов (anon-ключ публичен, доступ защищён RLS).

## Как устроена безопасность

- Вход только по email и паролю; регистрация закрыта, пользователей создаёте вы.
- Роль хранится в `public.profiles`. Клиент не может её изменить: на таблице нет политик insert/update/delete.
- Список файлов видят только вошедшие пользователи; вставка, изменение и удаление записей и объектов Storage разрешены только `is_admin()`.
- Бакет приватный. Скачивание идёт по Signed URL, который живёт 60 секунд (`SIGNED_URL_TTL` в `app.js`).
- Лимит размера и список MIME-типов заданы и в браузере, и на сервере (бакет). Проверка в браузере нужна для удобства, защищает серверная.
- Имена файлов на диске генерируются как UUID, пользовательский ввод в путь не попадает. Весь вывод экранируется.

## Ограничения

- Ссылка не строго «одноразовая»: Supabase не умеет отзывать Signed URL, поэтому ссылка действует короткое время (60 с) и создаётся при каждом нажатии.
- Free plan: 1 ГБ хранилища, файл до 50 МБ; проект «засыпает» после недели без активности (оживляется в дашборде).
- Tailwind подключён через CDN для простоты. Для продакшена соберите CSS через Tailwind CLI или Vite.
- Если добавите новый тип файла, расширьте списки в `app.js` и `allowed_mime_types` бакета.
