# Implementation status

_Last updated: 2026-11-11. Future sessions: read this first, then `README.md` and `docs/architecture/overview.md`._

## Completed (backend logic + UI + persistence + authz + tests)

| Area | Backend | Mobile | Admin | Web |
|---|---|---|---|---|
| Auth (register w/ no-broker attestation, login, rotating refresh, logout, profile) | ✅ | ✅ | ✅ staff only | – |
| Identity verification (upload → review → approve / reject / more info) | ✅ | ✅ | ✅ | – |
| Property registration, identity normalization, duplicate prevention, identity check | ✅ | ✅ | ✅ duplicates view | – |
| Ownership claims (owner / legal representative w/ scope & expiry), disputes | ✅ | ✅ claim | ✅ review & resolve | – |
| Listings: create/edit/photos/submit/pause/resume/withdraw, moderation, featuring | ✅ | ✅ | ✅ | – |
| One live listing per property (sale, rent, both) — DB-enforced | ✅ | ✅ error handling | – | – |
| Search & filters, detail, favorites, compare, PV scenario | ✅ | ✅ | – | ✅ browse/detail (read-only) |
| Financial engine (provenance, overdue, premium, maintenance, fees, schedules, rent) | ✅ | ✅ breakdown | – | ✅ breakdown |
| Financial verification (reviewer upgrades provenance; edits reset) | ✅ | ✅ request | ✅ review | – |
| Messaging, viewings | ✅ | ✅ | – | – |
| Offers/counteroffers/expiry, sale & rent deal state machines, checklist, two-party confirmations, cancel | ✅ | ✅ | ✅ monitor | – |
| Private documents (encrypted, signed URLs, audited) | ✅ | ✅ upload | ✅ view | – |
| Notifications (in-app), support cases incl. broker reports | ✅ | ✅ | ✅ | – |
| Push notifications: device registration, per-category preferences, Expo adapter (off by default) | ✅ | ✅ registration, deep links, settings screen | – | – |
| Staff two-factor sign-in (TOTP, replay-protected, optional enforcement) | ✅ | – | ✅ QR enrollment, login code step, banner | – |
| Scheduled worker: offer expiry, document retention purge, featured expiry, saved-search alerts, token cleanup | ✅ (`python -m app.worker`) | – | – | – |
| Market insights: asking-price history, district price/m² (groups < 3 hidden), monthly trend | ✅ | ✅ market screen, price history | – | – |
| Cash vs installments comparison (break-even cash price at a chosen rate) | ✅ | ✅ | – | – |
| Saved searches + new-listing alerts | ✅ | ✅ save, list, results, alerts switch | – | – |
| Phone verification by SMS code (dev SMS sender only) | ✅ | ✅ verify screen + status badge | – | – |
| Account lockout after repeated failed sign-ins | ✅ | ✅ message with minutes left | ✅ (shared API) | – |
| S3-compatible storage, key rotation, ClamAV upload scanning, Redis rate limiting | ✅ | – | – | – |
| Owner listing performance: daily views/saves/inquiries/viewings/offers, funnel | ✅ | ✅ | – | – |
| Observability: request ids (header, error bodies, logs), JSON logs, Prometheus /metrics | ✅ | – | – | – |
| Professional services directory (verified providers, stage suggestions, referrals with fee disclosure) | ✅ | 🚧 in progress | 🚧 in progress | – |
| Search performance: trigram indexes, single-pass page/total (`docs/architecture/performance.md`) | ✅ | – | – | – |
| Audit log, analytics, user management (roles, suspension) | ✅ | – | ✅ | – |
| EN/AR + RTL, EGP formatting, light/dark | – | ✅ | – | ✅ |
| Public marketing site, SEO (metadata, sitemap, robots, hreflang) | – | – | – | ✅ |

## Current architecture
See `docs/architecture/overview.md`. FastAPI modular monolith + PostgreSQL 16 (Alembic), Expo Router mobile app,
two Next.js apps, OpenAPI-generated TS client and shared design tokens in an npm-workspaces monorepo.

## Last verified results (2026-11-11, this environment)

| Check | Result |
|---|---|
| `services/api`: `pytest` (real PostgreSQL 16; includes 4 concurrency tests; S3 via moto, Redis via fakeredis, fake clamd) | **176 passed** |
| `services/api`: `ruff check .` | pass |
| `services/api`: `alembic upgrade head` + `alembic check` (models match migrations) | pass |
| `apps/mobile`: `tsc --noEmit` / `jest` | pass / **59 passed** (11 suites) |
| `apps/mobile`: `expo export --platform web` (lead re-ran) and `--platform android` (agent run) | pass (`EXPO_OFFLINE=1`, Expo API blocked by network) |
| `apps/admin`: typecheck / vitest / `next build` | pass / **29 passed** / pass |
| `apps/web`: typecheck / vitest / `next build` | pass / **11 passed** / pass |
| Root `npm ci`, `npm run typecheck`, `npm test` (the CI JS job steps) | pass |
| Playwright smoke against live API: mobile web journeys, admin (12 checks), web (24 checks) | pass (run by the build agents; scripts in each app) |
| Playwright: admin two-factor enrollment → sign-out → code step → replay rejected → sign-in (real TOTP codes) | pass |
| Playwright: mobile notification settings persist; web date field | pass |
| Playwright: mobile market insights, cash-vs-installments, saved search; phone verification with a real code from the dev SMS log | pass |
| Redis rate limiter against a real Redis 7.0 server (two clients share one limit) | pass |
| Admin (12 checks) and web (24 checks) smoke suites against production builds — now also a CI job (`e2e`) | pass locally |
| Docker image / docker-compose | **not run** (no Docker daemon in this environment) |
| GitHub Actions CI (`api` + `js` jobs) | **green** on `995192f`; earlier WIP snapshot commits failed as expected |
| Native iOS/Android device or emulator runs | **not run**; no APK/IPA has been produced |

Screenshots: `apps/mobile/docs/screenshots/`, `apps/admin/docs/screenshots/`, `apps/web/docs/screenshots/`.

## Known problems / limitations
- Native RTL switching (requires app reload via `I18nManager.forceRTL`) is untested on devices.
- Native date pickers (Android dialog / iOS sheet), the OS push permission prompt and real push delivery are untested (need a device + EAS project + FCM/APNs credentials).
- Media URLs come from `DARNA_PUBLIC_BASE_URL`; the mobile app rewrites `localhost` for emulators. Set the env var to a reachable host for device testing.
- Some `validation_failed` messages are English developer text; Arabic UI shows a generic message for them.
- Viewing and checklist responses don't include server-computed allowed actions (the client derives them; the server remains authoritative).
- Rate limiting is per-process (in-memory, with eviction of inactive keys). The worker must be scheduled externally (cron / platform scheduler) or run with `--interval`.
- Verification queue has no pagination.
- The dev database used during this session contains extra test records from agent E2E runs; reset with `python seed.py --reset`.

## Next implementation tasks (priority order) — see `docs/BACKLOG.md`
1. Build and run the Docker image (compose includes `worker`; add `clamd` and `redis` services for production parity).
2. Native QA on Android emulator + iOS simulator; EAS project + development builds; verify push end to end.
3. Integrate a real SMS provider (implement `SmsSender` in `app/core/sms.py`).
4. Map view (needs property coordinates or district geometry, and a map tiles provider).
5. Optional paid services (featured listings purchase flow) through a licensed payment provider adapter.

## Required external configuration / dependencies
- Production storage: `DARNA_STORAGE_BACKEND=s3`, two buckets (private documents, public photos), `DARNA_MEDIA_BASE_URL`, optional KMS key.
- ClamAV daemon (`DARNA_MALWARE_SCANNER=clamd`) — production refuses to start without a scanner.
- Redis for shared rate limiting when running more than one API instance.
- An SMS provider contract + credentials for phone verification.
- Production secrets: `DARNA_JWT_SECRET`, `DARNA_DOCUMENT_ENCRYPTION_KEY` (app refuses to start in staging/production without them), `DARNA_DATABASE_URL`, `DARNA_PUBLIC_BASE_URL`, `DARNA_CORS_ORIGINS`.
- Expo/EAS account; Apple Developer Program (bundle id `com.darna.app` placeholder, certificates/profiles); Google Play Console + upload keystore.
- Push: set `DARNA_PUSH_PROVIDER=expo` (optional `DARNA_EXPO_ACCESS_TOKEN`); real device delivery also needs FCM/APNs credentials in the Expo project. SMS provider — not integrated.
- Staff MFA: set `DARNA_REQUIRE_STAFF_MFA=true` in production (staff without MFA are then sent to Account security before any staff API works).
- Mobile push: `EXPO_PUBLIC_EAS_PROJECT_ID` (EAS project) — without it the app skips registration and says so in settings.
- Object storage + KMS; hosting for API/Postgres; domain & TLS.
- Legal review: terms, privacy policy (Egypt PDPL Law 151/2020), representative-authority rules, disclaimers; trademark check on the working name "Darna".
- No payment provider is integrated; no real-money flows exist.
