# ADR 0004 — Deal = negotiation + transaction workspace

One `Deal` per (listing, buyer, kind) negotiation holds offers, checklist, events and milestones. Separate sale and
rent state machines; critical milestones need confirmations from both parties; checklist items gate transitions.
Accepting an offer locks the listing row and a partial unique index allows only one committed deal per listing,
so a `sale_and_rent` listing can never be both sold and leased.
