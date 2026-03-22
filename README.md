# SteamGuard Web

Open-source web implementation of Steam Desktop Authenticator (SDA) with multi-user and multi-account support.

- Backend: Fastify + TypeScript (API-first REST + WebSocket notifications)
- Frontend: React + Vite + Tailwind + PWA
- DB: MySQL 8 in Docker with encrypted MA files
- Bot: Aiogram (single Telegram bot for all users)
- License: MIT

## Why this stack

- **Fastify (instead of Express)**: lower overhead and better throughput for polling/real-time workloads.
- **TypeScript on backend/frontend**: safer refactoring and better API contracts.
- **MySQL 8 + Docker internal network**: relational consistency, easy VPS deploy, DB isolated from public access.
- **Redis-backed rate limiting in Docker**: shared throttling across backend instances and backend restarts, with in-memory fallback outside Redis setups.
- **React + Vite + Tailwind**: fast DX + responsive UI + simple theming.
- **Vite PWA plugin**: installable app + service worker caching.
- **Aiogram bot**: mature async Telegram framework for command and deep-link flows.

## Key features

- MA file import/export (`.maFile`) with AES-256 encryption in DB.
- Multi-user + unlimited Steam accounts per user.
- Steam code generation from `shared_secret`.
- Trade/login confirmations API + queue + manual confirm/reject.
- Auto-confirm toggle with per-account delay (0-60s).
- Telegram OAuth-like login flow via bot deep-link.
- Telegram account linking with `/add=<code>` (15 min TTL).
- Telegram commands: `/accounts`, `/codes`, `/confirm <trade_id>`, `/status`.
- JWT cookie sessions, CSRF protection, Helmet, bcrypt, brute-force guard via `rate-limiter-flexible`.
- Registration anti-bot protection with honeypot, signed registration challenge, strict rate limits and optional Cloudflare Turnstile.
- Invisible Turnstile support for registration when configured.
- Password re-confirmation for sensitive actions such as `.maFile` export, recovery code reveal and manual Steam session save.
- i18n EN/RU + light/dark theme.
- Admin panel with global registration toggle and user deletion.
- OpenAPI docs JSON at `/api-docs/openapi.json` when `OPENAPI_ENABLED=true`.

## Default admin

- Email: `admin@admin.com`
- Password: `admin123`

(Override with `.env`: `ADMIN_EMAIL`, `ADMIN_PASSWORD`)

Important:
- The default admin password is for local bootstrap only.
- Production startup is blocked if `ADMIN_PASSWORD=admin123`.
- Production startup is also blocked if `JWT_SECRET`, `COOKIE_SECRET`, or `ENCRYPTION_KEY` still use placeholder-style values such as `change_me...`, are shorter than 32 characters, or reuse the same secret value.

## Architecture

- Monolith API-first backend (`/api/...`) + WS (`/ws`) on port `3001`.
- Frontend SPA on port `3000`.
- Frontend server (Vite/Nginx) proxies `/api` and `/ws` to backend.
- MySQL is isolated in internal Docker network and not exposed externally.
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
└── README.md
```

## Quick start

```bash
cp .env.example .env
make dev
```

Open:
- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:3001`
- OpenAPI: `http://localhost:3001/api-docs/openapi.json` (enabled by default in dev/test)

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
- `APP_URL`, `API_URL` frontend/backend origins.
- `RATE_LIMIT_REDIS_URL`, `RATE_LIMIT_REDIS_PREFIX` shared rate limiting backend; Docker Compose defaults to internal Redis and a NODE_ENV-based prefix.
- `FORCE_HTTPS` enables HTTP->HTTPS redirects in production (`true` by default, can be disabled for special deployments).
- `OPENAPI_ENABLED` controls `/api-docs/openapi.json`; enabled by default in dev/test and should stay off in production unless explicitly needed.
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` bot settings.
- `STEAM_POLL_INTERVAL_SEC` auto-confirm polling interval.
- `TURNSTILE_ENABLED`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` optional Cloudflare Turnstile backend protection.
- `VITE_TURNSTILE_SITE_KEY` frontend public site key for invisible Turnstile registration flow. Use the same value as `TURNSTILE_SITE_KEY` because it is the same public Cloudflare site key, just exposed to the Vite frontend build via the `VITE_` prefix.

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

If `TELEGRAM_BOT_TOKEN` is empty or starts with `change_me`, bot service stays in disabled idle mode (no crash, API stays up).
If you enable `OPENAPI_ENABLED` in production, prefer exposing it only behind admin auth, VPN, or IP allowlisting.

## Security model

- **MA encryption**: AES-256-GCM per user.
- **Key derivation**: per-user key derived from bcrypt password hash + global `ENCRYPTION_KEY`.
- **Auth**: JWT in HTTP-only cookie.
- **Sensitive actions**: password re-confirmation required before `.maFile` export, recovery code reveal and manual Steam session updates.
- **CSRF**: double-submit protection for mutating endpoints.
- **Brute-force/DoS**: `rate-limiter-flexible` in auth/write paths.
- **Shared throttling**: Docker deployments use Redis-backed rate limits with in-memory insurance fallback if Redis is temporarily unavailable; current Compose defaults do not persist limiter state across Redis restarts.
- **Anti-bot registration**: signed registration challenge, honeypot, dedicated registration rate limiter and optional invisible Cloudflare Turnstile.
- **Hardening**: `helmet`, CORS with credentials.
- **WebSocket auth**: cookie/bearer only, query-string auth disabled.
- **API caching**: `/api/*` responses are served with `Cache-Control: no-store` to reduce leakage of session-bound data.
- **DB isolation**: MySQL only on internal Docker network (`db_internal`).

## Telegram flows

### Link Telegram account
1. In Settings click "Generate /add code".
2. Send `/add=<code>` to bot within 15 min.
3. Bot binds `telegram_user_id` to your web user.

### Login via Telegram
1. On login page click "Login via Telegram".
2. Open bot deep-link (`/start login_<code>`).
3. Bot confirms code.
4. Web page polls and creates session automatically.

Deploy frontend and backend together when changing Telegram login polling, because the flow now requires the `x-telegram-poll-token` header instead of the legacy query-string token.

## Steam confirmations notes

Steam mobile confirmations require valid session tokens (`steamLoginSecure`, `sessionid`, optional `oauthToken`).
You can set/update them in account detail page (`/accounts/:id`) or they are imported if present in `.maFile` session payload.

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

## Deployment on VPS

1. Install Docker + Docker Compose.
2. Clone repository.
3. `cp .env.example .env` and set production secrets.
4. Change `ADMIN_PASSWORD` from the bootstrap default before production start.
4. Optionally set external reverse proxy to forward:
   - `/` -> frontend `:3000`
   - `/api` and `/ws` -> backend `:3001`
5. If you want anti-bot registration, configure Cloudflare Turnstile keys in `.env`.
6. Run `make deploy`.

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
