# Darna — owner-direct real estate platform

Independent, owner-direct marketplace and transaction workspace for residential communities in Egypt
(initially Madinaty, New Cairo). Not affiliated with any developer.

Monorepo layout (work in progress — see `docs/IMPLEMENTATION_STATUS.md`):

- `services/api` — FastAPI + PostgreSQL backend (modular monolith)
- `apps/mobile` — Expo / React Native app (primary product)
- `apps/admin` — Next.js administration dashboard
- `apps/web` — public website
- `packages/` — shared API types and design tokens
- `docs/` — product, architecture, API and decision records
