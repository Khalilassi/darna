# ADR 0003 — Provenance on every monetary amount

Each amount is `verified | seller_provided | estimate | unknown`. Owners can never submit `verified`; reviewers
upgrade seller-provided amounts only by approving a financial verification, and any later edit resets the listing's
financial verification. Totals include only known (verified + seller-provided) amounts; estimates are summed
separately with mandatory assumption text; unknowns are listed as unconfirmed.
