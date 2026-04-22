# SteamGuard Web

Open-source веб-реализация Steam Desktop Authenticator (SDA) с поддержкой мультипользовательского режима и нескольких Steam-аккаунтов на пользователя.

English version: `README.md`

- Backend: Fastify + TypeScript (REST API + WebSocket-уведомления)
- Frontend: React + Vite + Tailwind + PWA
- БД: MySQL 8 в Docker с шифрованием секретов и сессий
- Общая инфраструктура: Redis для rate limiting в Docker-развертываниях
- Бот: Aiogram (единый Telegram-бот для всех пользователей)
- Лицензия: MIT

## Установка в production на VPS

```bash
git clone git@github.com:feskolech/steamwebauthenticator.git
cd steamwebauthenticator
cp .env.example .env
```

Перед запуском отредактируй `.env`:
- установи `NODE_ENV=production`
- задай `APP_URL` как публичный HTTPS origin, например `https://steam.example.com`
- задай `API_URL` как API path на том же origin, например `https://steam.example.com/api`
- замени `ADMIN_EMAIL` и `ADMIN_PASSWORD`
- сгенерируй сильные `JWT_SECRET`, `COOKIE_SECRET` и `ENCRYPTION_KEY`
- задай пароли MySQL
- при необходимости задай Telegram bot и Turnstile keys

Сгенерировать сильные secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Запустить production containers:

```bash
make deploy
```

Production containers по умолчанию слушают только localhost:
- Frontend: `127.0.0.1:3100`
- Backend API + WebSocket: `127.0.0.1:3101`

Поставь внешний Nginx/Caddy/Traefik reverse proxy перед этими портами:
- `/` -> `http://127.0.0.1:3100`
- `/api` -> `http://127.0.0.1:3101`
- `/ws` -> `http://127.0.0.1:3101`

## Локальная разработка

```bash
cp .env.example .env
make dev
```

Открыть:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- OpenAPI: `http://localhost:3001/api-docs/openapi.json` (включен по умолчанию в dev/test)

## Почему такой стек

- **Fastify**: меньшие накладные расходы и лучшая производительность для polling/real-time сценариев.
- **TypeScript**: более безопасный рефакторинг и общие API-контракты.
- **MySQL 8 + Docker internal network**: надежная реляционная модель, простой деплой на VPS, изоляция БД от внешнего мира.
- **Redis-backed rate limiting**: общий throttling между инстансами backend и после перезапусков, с fallback на память вне Redis-конфигураций.
- **React + Vite + Tailwind**: быстрый DX, отзывчивый UI, простое тематизирование.
- **Vite PWA plugin**: installable app и поддержка service worker.
- **Aiogram**: зрелый асинхронный Telegram framework для команд и deep-link flow.

## Ключевые возможности

- Импорт/экспорт `.maFile` с AES-256-GCM шифрованием в БД.
- Мультипользовательский режим + неограниченное число Steam-аккаунтов на пользователя.
- Генерация Steam-кодов из `shared_secret`.
- Очередь trade/login confirmations с ручным confirm/reject.
- Auto-confirm с настройкой задержки на аккаунт.
- Папки и теги для аккаунтов с фильтрацией на странице аккаунтов.
- Telegram OAuth-подобный логин через deep-link в бота.
- Привязка Telegram-аккаунта через `/add=<code>`.
- Telegram-команды: `/accounts`, `/codes`, `/confirm <trade_id>`, `/status`.
- Логин через Passkey/WebAuthn, включая usernameless passkey login, если устройство поддерживает discoverable credentials.
- Поддержка TOTP-приложений-аутентификаторов.
- Recovery codes для аварийного восстановления доступа.
- JWT cookie sessions, CSRF protection, Helmet, rate limiting, опциональный Turnstile.
- Политики регистрации: open, disabled, domain allowlist, invite-only.
- Admin panel с настройками регистрации, invite-кодами, удалением пользователей и аудитом событий.
- Webhook-уведомления для login/trade/session-expired событий с generic и Discord target.
- i18n EN/RU + light/dark theme.
- OpenAPI JSON по `/api-docs/openapi.json`, если `OPENAPI_ENABLED=true`.

## Админ по умолчанию

- Email: `admin@admin.com`
- Пароль: `admin123`

Переопределяется через `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`

Важно:
- Пароль администратора по умолчанию предназначен только для локального bootstrap.
- В production запуск блокируется, если `ADMIN_PASSWORD=admin123`.
- В production запуск также блокируется, если `JWT_SECRET`, `COOKIE_SECRET` или `ENCRYPTION_KEY` все еще используют placeholder-значения вроде `change_me...`, короче 32 символов или повторяют одно и то же значение.

## Архитектура

- Монолитный API-first backend (`/api/...`) + WS (`/ws`) на порту `3001`.
- Frontend SPA на порту `3000`.
- Frontend server (Vite/Nginx) проксирует `/api` и `/ws` в backend.
- MySQL и Redis изолированы во внутренней Docker-сети и не торчат наружу.
- Опциональный reverse proxy сервис (`nginx`) в compose profile `proxy`.

## Структура проекта

```text
.
├── backend/                 # Fastify API (TypeScript)
├── frontend/                # React + Vite + Tailwind + PWA
├── bot/                     # Aiogram Telegram bot
├── docker/
│   ├── mysql/init.sql       # Bootstrap схемы
│   └── nginx/nginx.conf     # Пример reverse proxy
├── docker-compose.yml
├── docker-compose.dev.yml
├── Makefile
├── .env.example
├── README.md
└── readme_ru.md
```

## Make targets

- `make dev` - Docker dev stack с hot reload.
- `make build` - собрать production images.
- `make up` - запустить production stack в фоне.
- `make deploy` - alias для `make up`.
- `make down` - остановить и удалить контейнеры.
- `make lint` - backend + frontend lint.
- `make test` - backend Jest + frontend Cypress (через docker service).
- `make logs` - смотреть логи контейнеров.

## Переменные окружения

Смотри `.env.example`.

Основные переменные:
- `DB_*` - параметры MySQL и bootstrap пользователя.
- `JWT_SECRET`, `COOKIE_SECRET`, `ENCRYPTION_KEY` - security secrets.
- `APP_URL`, `API_URL` - browser/backend origins.
- `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX` - backend для общего rate limiting; Docker Compose по умолчанию использует внутренний Redis и prefix на основе `NODE_ENV`.
- `FORCE_HTTPS` - включает HTTP->HTTPS redirect в production (`true` по умолчанию, можно отключить для специальных сценариев).
- `OPENAPI_ENABLED` - управляет `/api-docs/openapi.json`; по умолчанию включен в dev/test и должен быть выключен в production, если не нужен явно.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` - настройки бота.
- `STEAM_POLL_INTERVAL_SEC` - интервал auto-confirm polling.
- `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` - опциональная защита регистрации через Cloudflare Turnstile.
- `VITE_TURNSTILE_SITE_KEY` - публичный site key для frontend registration flow.

Перед production deploy сгенерируй сильные секреты, например:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

И помести их в `.env` так:

```env
JWT_SECRET=<первое сгенерированное значение>
COOKIE_SECRET=<второе сгенерированное значение>
ENCRYPTION_KEY=<третье сгенерированное значение>
```

Важные operator notes:
- Если `TELEGRAM_BOT_TOKEN` пустой или начинается с `change_me`, bot service остается в отключенном idle-режиме.
- Если включаешь `OPENAPI_ENABLED` в production, лучше закрыть доступ через admin auth, VPN или IP allowlist.
- `APP_URL` должен в точности совпадать с browser-facing origin, используемым для WebAuthn/passkey. Если reverse proxy отдает другой hostname или scheme, passkey login/registration сломается.

## Модель безопасности

- **MA encryption**: AES-256-GCM на пользователя.
- **Key derivation**: пользовательский ключ строится из bcrypt password hash + глобального `ENCRYPTION_KEY`.
- **Auth**: JWT в HTTP-only cookie.
- **2FA**: Telegram, passkeys, TOTP-приложение.
- **Break-glass recovery**: одноразовые recovery codes можно сгенерировать в Settings; использование recovery code сбрасывает настроенный 2FA и удаляет зарегистрированные passkeys у пользователя.
- **Sensitive actions**: повторное подтверждение пароля требуется перед `.maFile` export, показом recovery code Steam, ручным обновлением Steam session и регенерацией recovery codes.
- **CSRF**: double-submit защита для mutating endpoints.
- **Brute-force/DoS**: `rate-limiter-flexible` на auth/write путях.
- **Shared throttling**: в Docker deployment используется Redis-backed rate limiting с in-memory insurance fallback; текущие Compose defaults не сохраняют limiter state после перезапуска Redis.
- **Anti-bot registration**: signed registration challenge, honeypot, отдельный registration rate limiter и опциональный invisible Cloudflare Turnstile.
- **Hardening**: `helmet`, CORS с credentials.
- **WebSocket auth**: только cookie/bearer, query-string auth отключен.
- **API caching**: `/api/*` ответы отдаются с `Cache-Control: no-store`.
- **DB isolation**: MySQL только во внутренней Docker-сети (`db_internal`).

## Политики регистрации

Admin panel поддерживает следующие режимы регистрации:

- `open` - обычная саморегистрация.
- `disabled` - регистрация полностью отключена.
- `domain_allowlist` - регистрироваться могут только email из списка разрешенных доменов.
- `invite_only` - регистрация требует валидный invite code.

Для invite-only также есть управление invite-кодами в админке.

## Telegram flows

### Привязка Telegram-аккаунта
1. В Settings нажми `Generate /add code`.
2. Отправь `/add=<code>` боту в течение 15 минут.
3. Бот привяжет `telegram_user_id` к твоему веб-пользователю.

### Вход через Telegram
1. На странице логина нажми `Login via Telegram`.
2. Открой бота вручную через кнопку или команду `/start login_<code>`.
3. Подтверди вход в боте.
4. Вернись на веб-страницу; она автоматически допуллит результат и создаст сессию.

Frontend и backend нужно деплоить вместе при изменениях Telegram login polling, потому что flow теперь требует `x-telegram-poll-token` header вместо legacy query-string token.

## Методы аутентификации

### Passkeys
- Passkeys можно зарегистрировать из Settings.
- Логин поддерживает как email-first passkey flow, так и usernameless passkey login.
- Usernameless passkey login зависит от discoverable credentials, поддерживаемых authenticator/platform.

### TOTP
- Настройка TOTP запускается в Settings.
- Приложение показывает QR-код и secret для ручного ввода.
- После подтверждения первого кода TOTP можно выбрать как основной 2FA method.

### Recovery codes
- Recovery codes генерируются из Settings после повторного подтверждения пароля.
- Коды показываются только один раз.
- Использование recovery code логинит пользователя и очищает настроенный 2FA/passkeys, чтобы безопасно восстановить доступ.

## Организация аккаунтов

- Аккаунты можно группировать по папкам.
- У аккаунтов может быть несколько тегов.
- Страница аккаунтов поддерживает фильтрацию по папке и тегу.
- Страница деталей аккаунта позволяет назначать папку/теги для конкретного аккаунта.

## Аудит в админке

В admin panel есть audit view с фильтрами по категории и пользователю.

Основные категории:
- `steam`
- `auth`
- `security`

Примеры отслеживаемых событий:
- изменения registration policy
- создание/удаление invite-кодов
- создание/тест/удаление webhook-ов
- включение TOTP
- регенерация/использование recovery codes
- удаление пользователя администратором
- Steam confirmations и session events

## Webhook-уведомления

Настройки webhook-ов доступны в пользовательском Settings.

Поддерживаемые target types:
- `generic` - JSON POST webhook
- `discord` - Discord embed webhook

Поддерживаемые события:
- `trade`
- `login`
- `steam_session_expired`

Примечания:
- Ошибки доставки webhook записываются в БД и не ломают встроенные уведомления сайта.
- Из Settings можно отправить test delivery.

Форма generic webhook payload:

```json
{
  "event": "trade",
  "occurredAt": "2026-03-22T12:00:00.000Z",
  "payload": {
    "accountId": 1,
    "accountAlias": "Main",
    "headline": "New trade offer",
    "summary": "..."
  }
}
```

## Заметки по Steam confirmations

Steam mobile confirmations требуют валидных session tokens (`steamLoginSecure`, `sessionid`, optional `oauthToken`).
Их можно задать/обновить на странице деталей аккаунта (`/accounts/:id`) или они импортируются, если есть в `.maFile` session payload.

В queue view показываются только активные `pending` confirmations.

## Bot API integration

Внутренние bot endpoints находятся под `/api/telegram/bot/*` и защищены заголовком:

- `x-telegram-bot-token: $TELEGRAM_BOT_TOKEN`

## Скриншоты

### Login
![Login](docs/screenshots/login.png)

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

### Accounts
![Accounts](docs/screenshots/accounts.png)

### Account Detail
![Account detail](docs/screenshots/account-detail.png)

### Settings
![Settings](docs/screenshots/settings.png)

### Admin
![Admin](docs/screenshots/admin.png)

### Logs
![Logs](docs/screenshots/logs.png)

## Дополнительные заметки по деплою

- Установи Docker + Docker Compose перед запуском `make deploy`.
- Настрой `APP_URL` и `API_URL` так, чтобы они совпадали с реальным внешним HTTPS origin.
- Production Compose stack биндингует frontend/backend на localhost host ports `3100` и `3101`.
- Если нужна anti-bot registration, задай Cloudflare Turnstile keys в `.env`.

Опциональный bundled Nginx proxy:

```bash
docker compose --profile proxy up -d
```

## Тестирование

- Backend unit/API tests: Jest (`backend/tests/*`).
- Frontend unit tests: Vitest (`frontend/src/utils/format.test.ts`).
- E2E smoke: Cypress (`frontend/cypress/e2e/smoke.cy.ts`).

Для локальных запусков Cypress могут понадобиться системные зависимости (`Xvfb`). `make test` использует `cypress/included` Docker image, чтобы не требовать настройки хоста.

## Лицензия

MIT (`LICENSE`).
