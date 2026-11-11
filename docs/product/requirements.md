# Product requirements (summary)

**Darna** (working name, configurable in `packages/design-tokens`) is an independent, owner-direct marketplace
and transaction workspace for residential communities in Egypt. Launch community: **Madinaty, New Cairo**.
The data model supports more projects (Al Rehab, Noor, Celia are seeded as inactive). The platform is **not
affiliated** with Talaat Moustafa Group or any developer and uses no developer trademarks or data.

## Non-negotiable rules → where they are enforced

| Rule | Enforcement |
|---|---|
| No brokers | Sign-up attestation (`attest_not_broker`, stored timestamp); listing creation requires an **approved ownership claim**; "report a broker" support category; admins can suspend accounts (live listings are suspended automatically). |
| Only owners / authorized representatives list | `approved_claim_for()` checks approved claim; representatives need a power-of-attorney document and an explicit scope (`list` / `negotiate` / `sign`) with optional expiry, checked on every listing, negotiation and signing action. |
| One physical property = one canonical record | Normalized identity key + DB unique constraint `uq_properties_identity`; incomplete identities rejected (`docs/product/property-identity.md`). |
| One active public listing per property (sale, rent or both) | Partial unique index `uq_listings_one_live_per_property` over all *occupying* statuses (draft → suspended). Concurrency-tested. |
| Ownership claims & disputes | Competing claim on an owned property ⇒ `disputed` claim + `PropertyDispute`; only admins resolve; revocation withdraws the old owner's listing and cancels open deals. |
| Verification levels | Information submitted → identity verified → ownership authorization verified → financial information verified (`/auth/me.verification`, listing `owner_verified`, `financials_verified`). |
| Never show unverified as verified | Owners cannot submit `provenance: verified`; only a reviewer approving a financial verification upgrades provenance; any later edit resets it. |
| Transparent financials | `app/finance/engine.py`, spec in `financial-model.md`. |
| Transactions are not legal transfers | Deal API returns `legal_notice`; accepted offers are `preliminary`; see `docs/product/legal-boundaries.md`. |
| No commission dependency | Basic messaging, viewings, offers are free. Monetization = optional services (featured listings implemented admin-side; payments not implemented). |

## Journeys (status in `docs/IMPLEMENTATION_STATUS.md`)
A Discovery · B Owner registration · C Buying · D Renting · E Owner management — as described in the master brief.

## Out of scope for MVP (by decision)
Real-money settlement or escrow, automatic legal registration, developer system integration, SMS/OTP and
push delivery (adapters exist; credentials required), map view, saved searches.
