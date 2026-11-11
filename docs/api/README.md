# API

- Live docs (development): `http://localhost:8000/docs`
- Contract: `packages/api-client/openapi.json` (regenerate with `npm run gen:api`)
- Typed TS client: `@darna/api-client`

Conventions: JSON; `Authorization: Bearer <access>`; errors `{"error":{"code","message","details"}}`
(HTTP 401/403/404/409/422/429); money is a decimal **string** in EGP; datetimes ISO-8601 with timezone;
`Idempotency-Key` header supported on `POST /deals/offers`, counter, respond and advance; pagination
`?page=&page_size=` returning `{items,total,page,page_size}`.

Main groups: `/auth`, `/projects`, `/documents`, `/verifications`, `/properties`, `/listings`, `/conversations`,
`/viewings`, `/deals`, `/notifications`, `/support`, `/admin/*`.
