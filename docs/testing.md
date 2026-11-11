# Test strategy

| Layer | Tooling | Location |
|---|---|---|
| Financial engine (pure) | pytest | `services/api/tests/test_finance.py` |
| API integration (real PostgreSQL, schema built by Alembic) | pytest + FastAPI TestClient | `services/api/tests/` |
| Concurrency (threads + barrier against the real DB) | pytest | `test_properties.py`, `test_listings.py`, `test_deals.py` |
| Mobile components / i18n / auth refresh | Jest (jest-expo) + Testing Library | `apps/mobile` |
| Admin & web | see each app's README | `apps/admin`, `apps/web` |
| E2E smoke | Playwright (Chromium) against the running stack; runs in CI as the `e2e` job (screenshots uploaded as an artifact) | `apps/admin/e2e`, `apps/web/e2e` |
| Accessibility | axe-core (WCAG 2.1 A/AA) inside the smoke suites: any serious/critical violation fails the job; keyboard checks for visible focus and skip links. Web: every page in EN and AR at desktop and 375px | `apps/web/e2e/smoke.cjs` (admin audit in progress) |

Run backend tests: `cd services/api && .venv/bin/pytest` (needs PostgreSQL; `DARNA_DATABASE_URL` defaults to
`postgresql+psycopg://postgres@localhost:5432/darna_test`). The suite drops and recreates the `public` schema of
that database — never point it at a database you care about.
