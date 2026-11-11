# Darna admin console (`@darna/admin`)

Internal staff operations console (Next.js App Router, client-rendered, port **3001**). Talks to the Darna API through
`@darna/api-client`; styling comes from `@darna/design-tokens` (emitted as CSS variables, light/dark via `prefers-color-scheme`).

```bash
npm install                       # from the repo root
cp apps/admin/.env.example apps/admin/.env.local   # optional; defaults to http://localhost:8000
npm run dev -w @darna/admin       # http://localhost:3001
npm run build -w @darna/admin && npm run start -w @darna/admin
npm run typecheck -w @darna/admin # next typegen + tsc
npm run test -w @darna/admin      # Vitest + Testing Library
npm run e2e -w @darna/admin       # Playwright smoke against running app + API (seeds one identity verification in the DEV db)
                                  # also fails on serious/critical axe-core (WCAG 2.1 AA) violations, dialog focus and keyboard/skip-link regressions
```

## Auth & permissions
- Email/password via `POST /auth/login`; tokens are kept in memory and `sessionStorage` (never `localStorage`), refreshed
  single-flight via `/auth/refresh` on a 401 (refresh tokens rotate). Non-staff roles are rejected and their session revoked.
- `src/lib/permissions.ts` mirrors `PERMISSIONS` in `services/api/app/core/deps.py` — keep them in sync. Nav items and
  pages are hidden/blocked per role; a 403 from the API still renders a "No access" state or an error toast.

## Pages
Dashboard (analytics, "Expire stale offers"), Verification queue (filters, detail panel, signed-URL documents, decisions,
ownership supersede with warning), Listings moderation, Disputes (existing vs challenger), Duplicate candidates, Users
(search, role, suspend/reactivate with reason), Deals monitor, Support cases, Service providers (create/edit, verify,
activate; `services.manage` = admin + support), Referral requests (status filter, contacted/completed/cancelled), Audit log.

## Accessibility
Text colours use AA-safe variants defined in `globals.css` (`--c-text-muted-aa`, `--c-accent-aa`, `--c-warning-aa`,
`--c-success-aa`: the design tokens mixed towards `--c-text`), because some light-scheme token pairs are below 4.5:1.
Use them for text; raw tokens are fine for borders/icons. Dialogs (`Modal`/`ConfirmDialog`) move focus inside, trap Tab,
close on Escape and return focus to the trigger.

Screenshots: `docs/screenshots/`.
