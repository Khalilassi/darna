# Security & privacy model

- **Authentication**: Argon2id password hashes; 15-min HS256 access JWT; 30-day opaque refresh tokens stored as
  SHA-256 hashes, rotated on use, reuse ⇒ whole family revoked. Uniform login errors with timing equalization.
- **Authorization**: role (`member`, `reviewer`, `support`, `admin`) + permission matrix (`core/deps.PERMISSIONS`)
  for staff; resource checks for members (owner-only listing ops via approved claim; deal/conversation/viewing
  party checks returning 404 to outsiders; representative scope & expiry). Reviewers cannot decide their own
  submissions; admins cannot demote/suspend themselves.
- **Documents**: content-sniffed type allow-list (PDF/JPEG/PNG/WEBP), 10 MB cap, Fernet encryption at rest,
  random storage keys, never publicly routable. Access through 5-minute HMAC-signed URLs bound to user+document,
  re-authorized at read time, `Cache-Control: no-store`, every read audited. Deletion blocked when attached to a
  deal record (retention); `retain_until` stored per document (retention job: backlog).
- **Photos**: decoded and re-encoded by Pillow (strips EXIF/GPS), size-capped.
- **Data minimization**: public listing payloads exclude building/unit, owner contact and email; only owner first
  name. Unit is disclosed to deal parties after terms are agreed.
- **Audit log**: append-only `audit_logs` written in the same transaction as the change; metadata passes through
  `redact()` (sensitive keys, phone numbers, emails). Server logs never include bodies; unhandled errors log only
  type + path and return a generic 500.
- **Abuse controls**: per-IP sliding-window rate limits on register/login/refresh/uploads/messages/support
  (in-process; use Redis for multi-instance). Messages with phone/email return a safety tip.
- **Headers/config**: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `no-store` on private
  routes; explicit CORS allow-list; docs disabled in production; process refuses to start in staging/production
  with development secrets.

## Known gaps (tracked in backlog)
MFA for staff, account lockout beyond rate limits, malware scanning of uploads, KMS-managed keys and key
rotation, object storage with server-side encryption, retention purge job, PDPL legal review, penetration test.
