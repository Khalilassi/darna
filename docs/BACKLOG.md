# Backlog

Legend: P1 next, P2 soon, P3 later.

## Platform & quality
- ✅ CI green on GitHub. P1 build/run Docker image; staging deployment plan (no public deploy without approval).
- ✅ Scheduled worker (done): `python -m app.worker`.
- ✅ Redis rate limiting; request ids, JSON logs, Prometheus metrics. P3 distributed tracing.
- P2 Server-computed `allowed_actions` on viewings and checklist items.
- P2 Localized server validation messages (or field-level codes only).
- ✅ Search benchmark + trigram indexes. P3 Postgres full-text search (Arabic + English).

## Security
- ✅ Staff MFA (backend + admin screens); account lockout.
- ✅ Malware scanning (ClamAV), S3 storage with SSE/KMS, key rotation.
- P2 Penetration test; dependency scanning in CI.

## Product
- ✅ Push (backend, mobile registration, deep links, settings). P1 verify on a device with an EAS project.
- ✅ Phone verification flow. P1 real SMS provider.
- ✅ Mobile date pickers; saved searches & alerts. P2 map view.
- ✅ Owner analytics (views over time, inquiry funnel) — backend and mobile.
- ✅ Price history, district price-per-m² analytics, cash-vs-installment comparison.
- P3 Additional communities (Al Rehab, Noor, Celia are seeded inactive — activate with district data).
- ✅ Professional referral directory (no payments). P3 optional paid services via a licensed payment provider.

## Done (this session)
See `docs/IMPLEMENTATION_STATUS.md`.
