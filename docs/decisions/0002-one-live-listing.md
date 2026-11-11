# ADR 0002 — "One active listing" enforced as "one occupying listing"

The rule is "at most one active public listing per physical property". We enforce a stricter invariant: at most one
listing per property in any non-terminal status (draft, pending_review, active, under_offer, paused, suspended),
via a partial unique index. This prevents parallel drafts racing to publication and keeps sale/rent on a single
listing (`purpose = sale_and_rent`). Withdrawn/rejected/sold/rented listings free the property.
