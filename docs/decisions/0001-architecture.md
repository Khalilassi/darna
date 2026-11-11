# ADR 0001 — Modular monolith, sync SQLAlchemy, generated client

**Decision**: one FastAPI service with domain modules; synchronous SQLAlchemy 2 + psycopg 3 on PostgreSQL;
OpenAPI-generated TypeScript types shared by all clients; npm workspaces monorepo.

**Why**: the domain is transaction-heavy (row locks, partial unique indexes); a single database and synchronous
code keep invariants simple and testable. Generated types prevent client/server drift. Microservices would add
operational cost without benefit at this stage.
