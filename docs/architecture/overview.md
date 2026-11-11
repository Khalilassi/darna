# Architecture overview

```
apps/mobile   Expo + Expo Router (iOS/Android/web)  ─┐
apps/admin    Next.js staff console                  ├─ @darna/api-client (generated from OpenAPI)
apps/web      Next.js public site (SSR, SEO)         ─┘  @darna/design-tokens
                         │ HTTPS/JSON (Bearer JWT)
services/api  FastAPI modular monolith ── PostgreSQL 16 (SQLAlchemy 2, Alembic)
                         └── storage adapters: encrypted private documents · public photo media
```

## Backend modules (`services/api/app/modules`)
`auth` · `catalog` (projects/districts) · `documents` · `verification` · `properties` (identity, claims, disputes)
· `listings` (lifecycle, search, favorites, compare, financial scenarios) · `messaging` · `viewings` · `deals`
(offers + sale/rent transaction workspace) · `notifications` · `support` · `admin`. Cross-cutting code lives in
`app/core` (config, db, errors, security, deps/permissions, audit, rate limiting, idempotency, storage, notify,
state machine). The financial engine (`app/finance`) is pure and has no DB dependency.

## State machines (all validated server-side via `core/state_machine.py`)
- **Listing**: draft → pending_review → active ⇄ paused; active → under_offer → sold/rented; active/paused/under_offer → suspended → active; rejected → pending_review; draft/pending/active/paused/suspended → withdrawn. Resuming an edited listing goes back to review (`approved_version`).
- **Offer**: pending → accepted | rejected | countered | withdrawn | expired (lazy expiry on access + admin sweep).
- **Sale deal**: negotiating → offer_accepted → due_diligence → contract_preparation* → contract_signed* → developer_transfer → completed* (*both parties confirm); any non-terminal → cancelled.
- **Rent deal**: negotiating → terms_agreed → lease_preparation → lease_signed* → handover_scheduled (owner) → lease_active* → completed.
- **Verification**: submitted → under_review → approved | rejected | more_info_required → submitted.
- **Ownership claim**: submitted/under_review → approved | rejected; disputed → approved | rejected (via dispute resolution); approved → revoked | superseded.
- **Viewing**: requested → confirmed | declined | cancelled; confirmed → completed | no_show | cancelled.

Checklist items gate transitions (`required_for`), e.g. ownership contract + developer statement before
contract preparation.

## Consistency & concurrency
DB constraints are the last line of defence (see `app/models/entities.py` docstring). Critical writes lock rows
(`SELECT … FOR UPDATE` on listing/deal/offer) and translate `IntegrityError` into `409` codes. Mutating offer/deal
endpoints accept `Idempotency-Key`. Concurrency tests: `test_concurrent_registration_of_same_unit_creates_one_property`,
`test_concurrent_listing_creation_single_winner`, `test_concurrent_acceptance_on_same_listing_single_winner`.

## API contract
FastAPI generates OpenAPI; `npm run gen:api` exports it to `packages/api-client/openapi.json` and generates TS
types. Errors: `{"error": {"code", "message", "details"}}`; clients localize by `code`.
