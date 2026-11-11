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
- **Data minimization**: public listing payloads exclude building/unit, owner contact and email; only owner first
  name. Unit is disclosed to deal parties after terms are agreed.
- **Audit log**: append-only `audit_logs` written in the same transaction as the change; metadata passes through
  `redact()` (sensitive keys, phone numbers, emails). Server logs never include bodies; unhandled errors log only
  type + path and return a generic 500.
- **Account lockout**: 8 failed sign-ins (password or two-factor code) within 15 minutes lock that email for 15
  minutes. Counted per email hash, including unknown emails, so the response never reveals whether an account
  exists. The owner gets an in-app notification.
- **Abuse controls**: per-IP sliding-window rate limits on register/login/refresh/uploads/messages/support
  (in-process; use Redis for multi-instance). Messages with phone/email return a safety tip.
- **Headers/config**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `no-store` on private
  routes; explicit CORS allow-list; docs disabled in production; process refuses to start in staging/production
  with development secrets.

## Known gaps (tracked in backlog)
Malware scanning of uploads, application-key rotation (re-encrypting stored documents), Redis-backed rate
limiting for multiple instances, PDPL legal review, penetration test.
