# SteamGuard Web

Open-source web implementation of Steam Desktop Authenticator (SDA) with multi-user and multi-account support.

Russian version: `readme_ru.md`

- Backend: Fastify + TypeScript (REST API + WebSocket notifications)
- Frontend: React + Vite + Tailwind + PWA
- DB: MySQL 8 in Docker with encrypted secrets/session data
- Shared infra: Redis for rate limiting in Docker deployments
- Bot: Aiogram (single Telegram bot for all users)
- License: MIT

## Production install on VPS

```bash
git clone git@github.com:feskolech/steamwebauthenticator.git
cd steamwebauthenticator
cp .env.example .env
```

Edit `.env` before starting:
- set `NODE_ENV=production`
- set `APP_URL` to your public HTTPS origin, for example `https://steam.example.com`
- set `API_URL` to the same origin API path, for example `https://steam.example.com/api`
- replace `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- generate strong `JWT_SECRET`, `COOKIE_SECRET`, and `ENCRYPTION_KEY`
- set MySQL passwords
- optionally set Telegram bot and Turnstile keys

Generate strong secrets:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Start production containers:

```bash
make deploy
```

Or use Docker Compose directly:

```bash
docker compose up -d --build
```

Production containers bind to localhost by default:
- Frontend: `127.0.0.1:3100`
- Backend API + WebSocket: `127.0.0.1:3101`

Put your external Nginx/Caddy/Traefik reverse proxy in front of these ports:
- `/` -> `http://127.0.0.1:3100`
- `/api` -> `http://127.0.0.1:3101`
- `/ws` -> `http://127.0.0.1:3101`

## Local development

```bash
cp .env.example .env
make dev
```

Open:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- OpenAPI: `http://localhost:3001/api-docs/openapi.json` (enabled by default in dev/test)

## Why this stack

- **Fastify**: lower overhead and better throughput for polling/real-time workloads.
- **TypeScript**: safer refactoring and shared API contracts.
- **MySQL 8 + Docker internal network**: relational consistency, easy VPS deploy, DB isolated from public access.
- **Redis-backed rate limiting**: shared throttling across backend instances and restarts, with in-memory fallback outside Redis setups.
- **React + Vite + Tailwind**: fast DX, responsive UI, simple theming.
- **Vite PWA plugin**: installable app + service worker support.
- **Aiogram bot**: mature async Telegram framework for command and deep-link flows.

## Key features

- `.maFile` import/export with AES-256-GCM encryption in DB.
- Multi-user + unlimited Steam accounts per user.
- Steam code generation from `shared_secret`.
- Trade/login confirmations queue with manual confirm/reject.
- Auto-confirm toggles with per-account delay.
- Account folders and tags with filtering in the accounts view.
- Telegram OAuth-like login via bot deep-link.
- Telegram account linking with `/add=<code>`.
- Telegram commands: `/accounts`, `/codes`, `/confirm <trade_id>`, `/status`.
- Passkey/WebAuthn login, including usernameless passkey login when the device supports discoverable credentials.
- TOTP authenticator app support.
- Recovery codes for break-glass account recovery.
- JWT cookie sessions, CSRF protection, Helmet, rate limiting, optional Turnstile.
- Registration policies: open, disabled, domain allowlist, invite-only.
- Admin panel with registration controls, invite codes, user deletion, and audit trail.
- Webhook notifications for login/trade/session-expired events with generic and Discord targets.
- i18n EN/RU + light/dark theme.
- OpenAPI JSON at `/api-docs/openapi.json` when `OPENAPI_ENABLED=true`.

## Default admin

- Email: `admin@admin.com`
- Password: `admin123`

Override with `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`

Important:
- The default admin password is for local bootstrap only.
- Production startup is blocked if `ADMIN_PASSWORD=admin123`.
- Production startup is also blocked if `JWT_SECRET`, `COOKIE_SECRET`, or `ENCRYPTION_KEY` still use placeholder-style values such as `change_me...`, are shorter than 32 characters, or reuse the same secret value.

## Architecture

- Monolith API-first backend (`/api/...`) + WS (`/ws`) on port `3001`.
- Frontend SPA on port `3000`.
- Frontend server (Vite/Nginx) proxies `/api` and `/ws` to backend.
- MySQL and Redis are isolated in internal Docker network and not exposed externally.
- Optional reverse proxy service (`nginx`) in compose profile `proxy`.

## Project structure

```text
.
├── backend/                 # Fastify API (TypeScript)
├── frontend/                # React + Vite + Tailwind + PWA
├── bot/                     # Aiogram Telegram bot
├── docker/
│   ├── mysql/init.sql       # Schema bootstrap
│   └── nginx/nginx.conf     # Reverse proxy example
├── docker-compose.yml
├── docker-compose.dev.yml
├── Makefile
├── .env.example
├── README.md
└── readme_ru.md
```

## Make targets

- `make dev` - Docker dev stack with hot reload.
- `make build` - build production images.
- `make up` - run production stack detached.
- `make deploy` - alias for `make up`.
- `make down` - stop and remove containers.
- `make lint` - backend + frontend lint.
- `make test` - backend Jest + frontend Cypress (via docker service).
- `make logs` - follow container logs.

## Environment variables

See `.env.example`.

Core variables:
- `DB_*` MySQL connection and bootstrap user credentials.
- `JWT_SECRET`, `COOKIE_SECRET`, `ENCRYPTION_KEY` security secrets.
- `APP_URL`, `API_URL` browser/backend origins.
- `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX` shared rate limiting backend; Docker Compose defaults to internal Redis and a `NODE_ENV`-based prefix.
- `FORCE_HTTPS` enables HTTP->HTTPS redirects in production (`true` by default, can be disabled for special deployments).
- `OPENAPI_ENABLED` controls `/api-docs/openapi.json`; enabled by default in dev/test and should stay off in production unless explicitly needed.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` bot settings.
- `STEAM_POLL_INTERVAL_SEC` auto-confirm polling interval.
- `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` optional Cloudflare Turnstile backend protection.
- `VITE_TURNSTILE_SITE_KEY` frontend public site key for invisible Turnstile registration flow.

Generate strong secrets before production deploy, for example:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Then place the generated values into `.env` as:

```env
JWT_SECRET=<first generated value>
COOKIE_SECRET=<second generated value>
ENCRYPTION_KEY=<third generated value>
```

Important operator notes:
- If `TELEGRAM_BOT_TOKEN` is empty or starts with `change_me`, bot service stays in disabled idle mode.
- If you enable `OPENAPI_ENABLED` in production, prefer exposing it only behind admin auth, VPN, or IP allowlisting.
- `APP_URL` must exactly match the browser-facing origin used for WebAuthn/passkeys. If your reverse proxy exposes another hostname or scheme, passkey login/registration will fail.

## Security model

- **MA encryption**: AES-256-GCM per user.
- **Key derivation**: per-user key derived from bcrypt password hash + global `ENCRYPTION_KEY`.
- **Auth**: JWT in HTTP-only cookie.
- **2FA**: Telegram, passkeys, TOTP authenticator app.
- **Break-glass recovery**: one-time recovery codes can be generated from settings; using one resets configured 2FA and removes registered passkeys for that user.
- **Sensitive actions**: password re-confirmation required before `.maFile` export, recovery code reveal, manual Steam session updates, and recovery code regeneration.
- **CSRF**: double-submit protection for mutating endpoints.
- **Brute-force/DoS**: `rate-limiter-flexible` in auth/write paths.
- **Shared throttling**: Docker deployments use Redis-backed rate limits with in-memory insurance fallback if Redis is temporarily unavailable; current Compose defaults do not persist limiter state across Redis restarts.
- **Anti-bot registration**: signed registration challenge, honeypot, dedicated registration rate limiter and optional invisible Cloudflare Turnstile.
- **Hardening**: `helmet`, CORS with credentials.
- **WebSocket auth**: cookie/bearer only, query-string auth disabled.
- **API caching**: `/api/*` responses are served with `Cache-Control: no-store`.
- **DB isolation**: MySQL only on internal Docker network (`db_internal`).

## Registration policies

The admin panel supports these registration modes:

- `open` - normal self-registration.
- `disabled` - registration blocked for everyone.
- `domain_allowlist` - only email domains from the configured allowlist can register.
- `invite_only` - registration requires a valid invite code.

Invite-only mode also includes invite code management in the admin panel.

## Telegram flows

### Link Telegram account
1. In Settings click `Generate /add code`.
2. Send `/add=<code>` to the bot within 15 minutes.
3. The bot binds `telegram_user_id` to your web user.

### Login via Telegram
1. On login page click `Login via Telegram`.
2. Open the bot manually using the provided button or `/start login_<code>` command.
3. Confirm the login in the bot.
4. Return to the web page; it polls and creates the session automatically.

Deploy frontend and backend together when changing Telegram login polling, because the flow now requires the `x-telegram-poll-token` header instead of the legacy query-string token.

## Authentication methods

### Passkeys
- Passkeys can be registered from Settings.
- Login supports both email-first passkey flow and usernameless passkey login.
- Usernameless passkey login depends on discoverable credentials supported by the authenticator/platform.

### TOTP
- TOTP setup is started in Settings.
- The app shows a QR code and manual secret.
- After verifying the first code, TOTP can be selected as the primary 2FA method.

### Recovery codes
- Recovery codes are generated from Settings after password re-authentication.
- Codes are shown only once.
- Using a recovery code signs the user in and clears configured 2FA/passkeys so the user can recover access safely.

## Account organization

- Accounts can be grouped into folders.
- Accounts can have multiple tags.
- The accounts page supports filtering by folder and tag.
- Account details page supports assigning folder/tags per account.

## Admin audit trail

The admin panel includes an audit view with filters by category and actor.

Main categories:
- `steam`
- `auth`
- `security`

Examples of tracked events:
- registration policy changes
- invite creation/deletion
- webhook creation/testing/deletion
- TOTP enablement
- recovery code regeneration/use
- admin user deletion
- Steam confirmations and session events

## Webhook notifications

Webhook settings are available in the user Settings page.

Supported targets:
- `generic` - JSON POST webhook
- `discord` - Discord embed webhook

Supported events:
- `trade`
- `login`
- `steam_session_expired`

Notes:
- Webhook delivery failures are recorded in DB and do not break the in-app notification flow.
- Test delivery is available from Settings.

Generic webhook payload shape:

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

## Steam confirmations notes

Steam mobile confirmations require valid session tokens (`steamLoginSecure`, `sessionid`, optional `oauthToken`).
You can set/update them in account detail page (`/accounts/:id`) or they are imported if present in `.maFile` session payload.

Only active `pending` confirmations are shown in the queue view.

## Bot API integration

Internal bot endpoints are under `/api/telegram/bot/*` and protected by header:

- `x-telegram-bot-token: $TELEGRAM_BOT_TOKEN`

## Screenshots

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

## Additional deployment notes

- Install Docker + Docker Compose before running `make deploy`.
- Configure `APP_URL` and `API_URL` to match your real external HTTPS origin.
- The production Compose stack binds frontend/backend to localhost host ports `3100` and `3101`.
- If you want anti-bot registration, configure Cloudflare Turnstile keys in `.env`.

Optional bundled Nginx proxy:

```bash
docker compose --profile proxy up -d
```

## Testing

- Backend unit/API tests: Jest (`backend/tests/*`).
- Frontend unit tests: Vitest (`frontend/src/utils/format.test.ts`).
- E2E smoke: Cypress (`frontend/cypress/e2e/smoke.cy.ts`).

For local host runs Cypress may require system dependencies (`Xvfb`). `make test` uses `cypress/included` Docker image to avoid host setup issues.

## License

MIT (`LICENSE`).
