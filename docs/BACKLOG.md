# Backlog

Legend: P1 next, P2 soon, P3 later.

## Platform & quality
- P1 Run GitHub Actions CI; build/run Docker image; staging deployment plan (no public deploy without approval).
- P1 Scheduled worker: offer expiry, document retention purge (`documents.retain_until`), featured expiry.
- P2 Redis rate limiting; structured JSON logs with request ids; metrics/tracing.
- P2 Server-computed `allowed_actions` on viewings and checklist items.
- P2 Localized server validation messages (or field-level codes only).
- P3 Load tests for search; Postgres full-text search (Arabic + English).

## Security
- P1 Staff MFA (TOTP); account lockout policy.
- P2 Malware scanning for uploads; S3-compatible private bucket with SSE + KMS; key rotation.
- P2 Penetration test; dependency scanning in CI.

## Product
- P1 Push notifications (Expo push adapter), notification preferences.
- P1 Phone verification (SMS/OTP adapter).
- P2 Mobile date pickers for all date fields; map view; saved searches & alerts.
- P2 Owner analytics (views over time, inquiry funnel).
- P2 Price history, price-per-m² analytics by district; cash-vs-installment comparison.
- P3 Additional communities (Al Rehab, Noor, Celia are seeded inactive — activate with district data).
- P3 Optional paid services via licensed payment provider; authorized professional referral directory.

## Done (this session)
See `docs/IMPLEMENTATION_STATUS.md`.
