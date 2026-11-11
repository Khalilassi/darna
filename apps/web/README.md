# Darna public website (`@darna/web`)

Bilingual (English `/en`, Arabic `/ar` with `dir="rtl"`) marketing site and public listing pages. Next.js App Router,
server-rendered, port **3000**. Uses `@darna/api-client` for `GET /listings` and `GET /listings/{id}` and
`@darna/design-tokens` for colours/spacing (CSS variables, light/dark via `prefers-color-scheme`).

```bash
npm install                     # from the repo root
cp apps/web/.env.example apps/web/.env.local   # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SITE_URL
npm run dev -w @darna/web       # http://localhost:3000 (→ /en or /ar by Accept-Language)
npm run build -w @darna/web && npm run start -w @darna/web
npm run typecheck -w @darna/web
npm run test -w @darna/web      # Vitest + Testing Library
npm run e2e -w @darna/web       # Playwright smoke against the running site + API
```

- Routes: `/[locale]` landing, `/[locale]/listings` (purpose tabs, sort, pagination), `/[locale]/listings/[id]`
  (`generateMetadata` with OpenGraph cover photo, hreflang alternates), `/robots.txt`, `/sitemap.xml` (listing URLs when
  the API is reachable; revalidated hourly).
- Listing pages show the district only (never building/unit), the financial summary with provenance labels
  (verified / seller-provided / estimate / not yet confirmed) and a "Open in the app" CTA; store badges are "Coming soon".
- If the API is down, the build still succeeds and pages render a friendly "temporarily unavailable" message.
- Copy lives in `src/lib/dict/{en,ar}.ts` (the Arabic dictionary is type-checked against the English one).

Screenshots: `docs/screenshots/`.
