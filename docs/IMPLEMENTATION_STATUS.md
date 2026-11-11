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
| Audit log, analytics, user management (roles, suspension) | ✅ | – | ✅ | – |
| EN/AR + RTL, EGP formatting, light/dark | – | ✅ | – | ✅ |
| Public marketing site, SEO (metadata, sitemap, robots, hreflang) | – | – | – | ✅ |

## Current architecture
See `docs/architecture/overview.md`. FastAPI modular monolith + PostgreSQL 16 (Alembic), Expo Router mobile app,
two Next.js apps, OpenAPI-generated TS client and shared design tokens in an npm-workspaces monorepo.

## Last verified results (2026-11-11, this environment)

| Check | Result |
|---|---|
| `services/api`: `pytest` (real PostgreSQL 16; includes 3 concurrency tests) | **89 passed** |
| `services/api`: `ruff check .` | pass |
| `services/api`: `alembic upgrade head` + `alembic check` (models match migrations) | pass |
| `apps/mobile`: `tsc --noEmit` / `jest` | pass / **18 passed** (4 suites) |
| `apps/mobile`: `expo export --platform web` (lead re-ran) and `--platform android` (agent run) | pass (`EXPO_OFFLINE=1`, Expo API blocked by network) |
| `apps/admin`: typecheck / vitest / `next build` | pass / **15 passed** / pass |
| `apps/web`: typecheck / vitest / `next build` | pass / **11 passed** / pass |
| Root `npm ci`, `npm run typecheck`, `npm test` (the CI JS job steps) | pass |
| Playwright smoke against live API: mobile web journeys, admin (12 checks), web (24 checks) | pass (run by the build agents; scripts in each app) |
| Docker image / docker-compose | **not run** (no Docker daemon in this environment) |
| GitHub Actions CI (`api` + `js` jobs) | **green** on commit `3750af4` (run #8); earlier WIP snapshot commits failed as expected |
| Native iOS/Android device or emulator runs | **not run**; no APK/IPA has been produced |

Screenshots: `apps/mobile/docs/screenshots/`, `apps/admin/docs/screenshots/`, `apps/web/docs/screenshots/`.

## Known problems / limitations
- Native RTL switching (requires app reload via `I18nManager.forceRTL`) is untested on devices.
- Installment/handover/lease dates in mobile forms are typed text (YYYY-MM-DD); only viewings use a picker.
- Media URLs come from `DARNA_PUBLIC_BASE_URL`; the mobile app rewrites `localhost` for emulators. Set the env var to a reachable host for device testing.
- Some `validation_failed` messages are English developer text; Arabic UI shows a generic message for them.
- Viewing and checklist responses don't include server-computed allowed actions (the client derives them; the server remains authoritative).
- Rate limiting is per-process (in-memory); offer expiry is lazy + an admin-triggered sweep (no scheduler yet).
- Verification queue has no pagination.
- The dev database used during this session contains extra test records from agent E2E runs; reset with `python seed.py --reset`.

## Next implementation tasks (priority order) — see `docs/BACKLOG.md`
1. Build and run the Docker image (CI is already green on GitHub).
2. Scheduled jobs: offer expiry sweep, document retention purge, featured-listing expiry.
3. Push notifications via Expo push (adapter exists: `app/core/notify.py`), SMS/OTP phone verification adapter.
4. Native QA on Android emulator + iOS simulator; EAS development builds; date pickers for all date fields.
5. Object storage adapter (S3-compatible with SSE) for documents and photos; KMS-managed keys.
6. Staff MFA; malware scanning on uploads; Redis-backed rate limiting.
7. Price history & price-per-m² analytics; cash-vs-installment comparison scenario.
8. Optional paid services (featured listings purchase flow) through a licensed payment provider adapter.

## Required external configuration / dependencies
- Production secrets: `DARNA_JWT_SECRET`, `DARNA_DOCUMENT_ENCRYPTION_KEY` (app refuses to start in staging/production without them), `DARNA_DATABASE_URL`, `DARNA_PUBLIC_BASE_URL`, `DARNA_CORS_ORIGINS`.
- Expo/EAS account; Apple Developer Program (bundle id `com.darna.app` placeholder, certificates/profiles); Google Play Console + upload keystore.
- Push (Expo/FCM/APNs) and SMS provider credentials — not configured; dev adapters only log.
- Object storage + KMS; hosting for API/Postgres; domain & TLS.
- Legal review: terms, privacy policy (Egypt PDPL Law 151/2020), representative-authority rules, disclaimers; trademark check on the working name "Darna".
- No payment provider is integrated; no real-money flows exist.
