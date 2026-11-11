# Transaction & legal boundaries

- An **accepted offer** sets a deal to `offer_accepted` (sale) / `terms_agreed` (rent) and stores
  `agreed_terms.preliminary = true`. It is not a contract.
- Milestones such as `contract_signed`, `developer_transfer`, `lease_signed`, `completed` record what both parties
  report (two-party confirmation where it matters). Signing, notarization, developer assignment, registration and
  payments happen **outside** the platform with the developer, notaries, registries and licensed professionals.
- `completed` closes the platform record and marks the listing `sold`/`rented`. It does **not** change the
  property's ownership claim. A new owner submits an ownership claim with their documents; a reviewer may then
  supersede the previous claim (explicit note required, audited).
- Every deal response includes `legal_notice`, which clients must display.
- No custody of purchase funds, escrow, or payment processing exists in the MVP. Any future payment for optional
  services (e.g. featured listings) must go through a licensed payment provider adapter (not implemented).
- Legal review of terms of service, privacy policy (Egypt PDPL, Law 151/2020) and representative-authority rules
  is an **external dependency** before launch.
