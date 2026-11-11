# Darna — owner-direct real estate platform

Independent, owner-direct marketplace and transaction workspace for residential communities in Egypt
(launch community: Madinaty, New Cairo). **Not affiliated with Talaat Moustafa Group or any developer.**
All bundled data is synthetic.

| Path | What |
|---|---|
| `services/api` | FastAPI + PostgreSQL modular monolith (auth, verification, properties, listings, financial engine, messaging, viewings, offers & deals, admin) |
| `apps/mobile` | Expo / React Native app — the primary product (iOS, Android, web preview) |
| `apps/admin` | Next.js staff console (verification, moderation, disputes, users, deals, support, audit, analytics) |
| `apps/web` | Next.js public website (bilingual, SEO, public listing pages) |
| `packages/api-client` | TypeScript types + client generated from the API's OpenAPI schema |
| `packages/design-tokens` | Brand, colors, spacing, typography, EGP formatting |
| `docs/` | Product, architecture, API, ADRs, testing, **IMPLEMENTATION_STATUS.md** |

## Quick start (local)

Prerequisites: Python 3.12+, Node 20+, PostgreSQL 16.

```bash
# 1. Database
createdb darna && createdb darna_test

# 2. API
cd services/api
python -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
.venv/bin/alembic upgrade head
.venv/bin/python seed.py              # synthetic Madinaty data + demo accounts
.venv/bin/uvicorn app.main:app --reload --port 8000   # docs at http://localhost:8000/docs
.venv/bin/pytest                      # uses the darna_test database (schema is dropped/recreated)

# 3. JS apps (from repo root)
npm install
npm run gen:api                       # only after changing API schemas
npm run dev --workspace apps/admin    # http://localhost:3001
npm run dev --workspace apps/web      # http://localhost:3000
cd apps/mobile && npx expo start      # see apps/mobile/README.md
```

Demo accounts (password `Demo-pass-2026`): `buyer@example.com`, `tenant@example.com`, `owner@example.com`,
`newowner@example.com`, `reviewer@example.com`, `support@example.com`, `admin@example.com`.

Alternatively `docker compose -f infra/docker-compose.yml up --build` runs PostgreSQL + migrations + API.

Start with `docs/IMPLEMENTATION_STATUS.md`.
