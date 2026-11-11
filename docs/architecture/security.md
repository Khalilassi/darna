# Security & privacy model

- **Authentication**: Argon2id password hashes; 15-min HS256 access JWT; 30-day opaque refresh tokens stored as
  SHA-256 hashes, rotated on use, reuse ⇒ whole family revoked. Uniform login errors with timing equalization.
- **Authorization**: role (`member`, `reviewer`, `support`, `admin`) + permission matrix (`core/deps.PERMISSIONS`)
  for staff; resource checks for members (owner-only listing ops via approved claim; deal/conversation/viewing
  party checks returning 404 to outsiders; representative scope & expiry). Reviewers cannot decide their own
  submissions; admins cannot demote/suspend themselves.
- **Documents**: content-sniffed type allow-list (PDF/JPEG/PNG/WEBP), 10 MB cap, Fernet encryption by the
  application before storage, random storage keys, never publicly routable. With `DARNA_STORAGE_BACKEND=s3` the
  ciphertext is also stored with SSE-KMS (or SSE-S3) in a private bucket separate from the photo bucket. Access through 5-minute HMAC-signed URLs bound to user+document,
  re-authorized at read time, `Cache-Control: no-store`, every read audited. Deletion blocked when attached to a
  deal record (retention); `retain_until` stored per document (retention job: backlog).
- **Photos**: decoded and re-encoded by Pillow (strips EXIF/GPS), size-capped.
- **Malware scanning**: every document and photo is streamed to ClamAV (`clamd` INSTREAM) before it is stored;
  infected files get `422 file_rejected_malware`. If the scanner is down, uploads are refused (`503`) unless
  fail-open is explicitly configured. Production refuses to start without a scanner.
- **Key rotation**: `DARNA_DOCUMENT_ENCRYPTION_KEY` takes several keys (first encrypts, all decrypt).
  `python -m app.rotate_keys` re-encrypts stored documents and staff TOTP secrets with the newest key, after
  which old keys are removed. Procedure in `app/core/crypto.py`.
- **Phone verification**: 6-digit SMS codes, 10-minute expiry, 5 attempts, 60 s resend cooldown, 5 per hour;
  only an HMAC of the code is stored; a verified number belongs to one account (partial unique index).
- **Data minimization**: public listing payloads exclude building/unit, owner contact and email; only owner first
  name. Unit is disclosed to deal parties after terms are agreed.
- **Audit log**: append-only `audit_logs` written in the same transaction as the change; metadata passes through
  `redact()` (sensitive keys, phone numbers, emails). Server logs never include bodies; unhandled errors log only
  type + path and return a generic 500.
- **Account lockout**: 8 failed sign-ins (password or two-factor code) within 15 minutes lock that email for 15
  minutes. Counted per email hash, including unknown emails, so the response never reveals whether an account
  exists. The owner gets an in-app notification.
- **Abuse controls**: per-IP sliding-window rate limits on register/login/refresh/uploads/messages/support
  (in-process by default; `DARNA_RATE_LIMIT_BACKEND=redis` shares limits across instances with an atomic
  Lua script, failing open if Redis is unreachable). Messages with phone/email return a safety tip.
- **Headers/config**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `no-store` on private
  routes; explicit CORS allow-list; docs disabled in production; process refuses to start in staging/production
  with development secrets.

## Internal security review (2026-11-11)

A code-level review of the API (not a substitute for an external penetration test). Every finding below was
reproduced with a test before it was fixed; regression tests are in `services/api/tests/test_security_review.py`
(plus `test_properties.py` for the unit-number oracle).

| Severity | Finding | Fix |
|---|---|---|
| High | A reviewer/admin without MFA could read any private document: document access checked the role directly and skipped the staff-MFA policy. | All role checks go through `has_permission()`; signed document URLs carry whether the issuing session used MFA. |
| High | `/properties/identity-check` + public group/floor/type revealed private building and unit numbers (300 guesses found a listing's unit). | Endpoint removed. Registering an existing unit becomes an ownership claim (needs an ownership document, goes to review, opens a dispute with an approved owner). Claims are rate-limited per user (10/day) and per user+property (3/30 days). |
| Medium | Financial verification could certify figures edited after submission. | Requests store a hash of the sale terms; approval is refused (`terms_changed_since_submission`) if they changed. |
| Medium | Deal documents stayed readable by the counterparty after the deal was cancelled, and could not be deleted. | Access and retention apply only to deals that are not cancelled. |
| Medium | Staff MFA was checked per account, not per session; enrolment needed only an access token and kept older sessions. | Access tokens carry an `mfa` claim (kept across refresh); staff tools require it. MFA setup re-checks the password; confirming revokes every earlier session and returns a fresh MFA session. |
| Medium | Users could delete documents a pending or approved verification relies on. | Refused with `document_in_verification`. |
| Low | Suspending an owner left listings under offer public; staff could approve a suspended owner's pending listing. | Under-offer listings are suspended too; approval checks `is_active`. |
| Low | Claim/withdraw loops could spam an owner with dispute notifications. | Claim rate limits above. |
| Low | No limit on SMS codes sent to one number across accounts. | 5/hour and 10/day per destination number, serialized per number. |
| Low | Photos were decoded without a pixel limit (decompression bomb). | Images above 40 MP are refused before decoding. |

**Not fixed — decisions or follow-ups:**
- **Staff MFA enrolment bootstrap (P1).** Someone who already has the password of a staff account that has
  not enrolled yet can still enrol their own authenticator. Closing this needs admin-issued, one-time
  enrolment codes. Until then, enrol staff MFA when the role is granted.
- **Rate limits behind a load balancer.** Limits are keyed on the client address that uvicorn sees. In
  production, set `FORWARDED_ALLOW_IPS` to the load balancer's address range; never `*`, which lets clients
  spoof `X-Forwarded-For`.
- **Property details registered first cannot be corrected** (area, floor, bedrooms). Reviewers should
  confirm attributes when approving the first claim; an edit flow for the approved owner is a backlog item.
- **Accepted trade-offs:** registration reveals whether an email is taken (`email_taken`), and 8 bad
  passwords lock an account for 15 minutes. Re-registering an Expo push token moves it to the new account;
  push content is generic. Listing view counts can be inflated, which affects only owner statistics.

## Known gaps (tracked in backlog)
A real SMS provider, operating ClamAV/Redis in production, PDPL legal review, external penetration test,
admin-issued staff MFA enrolment codes.
