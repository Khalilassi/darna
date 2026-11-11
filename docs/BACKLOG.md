# Backlog

Legend: P1 next, P2 soon, P3 later.

## Platform & quality
- ✅ CI green on GitHub. P1 build/run Docker image; staging deployment plan (no public deploy without approval).
- ✅ Scheduled worker (done): `python -m app.worker`.
- ✅ Redis rate limiting; request ids, JSON logs, Prometheus metrics. P3 distributed tracing.
- ✅ Server-computed `allowed_actions` on viewings and checklist items (one rule function per resource, used by both the endpoint and the response).
- ✅ Coded validation errors (`type` per rule + `ctx` limits), localized in the mobile app. P3 same localization in admin/web forms.
- ✅ Search benchmark + trigram indexes; Arabic-normalized substring + English/Arabic stemmed full-text search.

## Security
- ✅ Staff MFA (backend + admin screens); account lockout.
- ✅ Malware scanning (ClamAV), S3 storage with SSE/KMS, key rotation.
- ✅ Dependency scanning in CI (pip-audit, npm audit) + Dependabot. P2 External penetration test.
- ✅ Internal security review (2026-11-11): 10 findings fixed, see `docs/architecture/security.md`.
- P1 Admin-issued one-time codes for staff MFA enrolment (closes the remaining enrolment-bootstrap gap).
- P2 Let the approved owner (or a reviewer) correct property attributes registered by someone else.
- P2 Set `FORWARDED_ALLOW_IPS` to the load balancer range at deployment (rate limits key on client IP).

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
