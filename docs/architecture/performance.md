# Search performance

Benchmark: `services/api/scripts/bench_search.py` fills a dedicated database with synthetic listings and times
representative searches through the real search code (`run_search`), reporting p50/p95 and query plans.

```bash
createdb darna_bench
DARNA_DATABASE_URL=postgresql+psycopg:///darna_bench?host=/var/run/postgresql alembic upgrade head
DARNA_DATABASE_URL=... PYTHONPATH=. python scripts/bench_search.py --listings 20000 --explain
```

## Results (2026-11-11, 20,000 listings ≈ 14,000 public; PostgreSQL 16; shared dev container)

Medians in ms (p95 in brackets). Measured back-to-back; the machine was also running builds, so absolute
numbers are noisy — compare rows, not single values.

| Query | Before | Trigram indexes only | + single-pass page/total (current) |
|---|---|---|---|
| Default browsing (newest) | 52 (66) | 52 (82) | **31 (43)** |
| Sale, 3+ beds, price range | 9 (12) | 10 (13) | **8 (12)** |
| Rent, district, furnished | 13 (19) | 15 (23) | **8 (11)** |
| Text "garden" (in ~70% of listings) | 108 (126) | 118 (134) | **45 (57)** |
| Text "corner view" | 88 (113) | 99 (137) | **45 (56)** |
| Text "skylight" (in ~1%) | 66 (77) | 6 (7) | **5 (7)** |
| Sort by price per m² | 31 (39) | 31 (35) | **19 (24)** |

What changed:
1. **Trigram GIN indexes** (`pg_trgm`) on `listings.title` and `listings.description` make `ILIKE '%term%'`
   fast for selective terms (~10×). For terms present in most listings PostgreSQL still scans, as it should.
2. **One pass for page + total**: search fetches the page's ids together with `count(*) OVER ()` instead of a
   separate `COUNT(*)` that scanned every match a second time, then loads the 20 cards by id.

Realistic scale for one community is a few thousand active listings, where every query above is well under
the 20,000-listing figures. Next steps if search grows: full-text search with Arabic/English configurations,
and caching the anonymous default browse page.
