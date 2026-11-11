# Backlog

Legend: P1 next, P2 soon, P3 later.

## Platform & quality
- ✅ CI green on GitHub. P1 build/run Docker image; staging deployment plan (no public deploy without approval).
- ✅ Scheduled worker (done): `python -m app.worker`.
- P2 Redis rate limiting; structured JSON logs with request ids; metrics/tracing.
- P2 Server-computed `allowed_actions` on viewings and checklist items.
- P2 Localized server validation messages (or field-level codes only).
- P3 Load tests for search; Postgres full-text search (Arabic + English).

## Security
- ✅ Staff MFA (backend + admin screens). P2 account lockout policy.
- P2 Malware scanning for uploads; S3-compatible private bucket with SSE + KMS; key rotation.
- P2 Penetration test; dependency scanning in CI.

## Product
- ✅ Push (backend, mobile registration, deep links, settings). P1 verify on a device with an EAS project.
- P1 Phone verification (SMS/OTP adapter).
- ✅ Mobile date pickers. P2 map view; saved searches & alerts.
- P2 Owner analytics (views over time, inquiry funnel).
- P2 Price history, price-per-m² analytics by district; cash-vs-installment comparison.
- P3 Additional communities (Al Rehab, Noor, Celia are seeded inactive — activate with district data).
- P3 Optional paid services via licensed payment provider; authorized professional referral directory.

## Done (this session)
See `docs/IMPLEMENTATION_STATUS.md`.
