# Local database runbook

PostgreSQL 18 runs in Docker Compose (`compose.yaml`). Why it's set up this way: ADR 0019. Docker Desktop must be running.

## First time

1. Copy `.env.example` to `.env` and replace every `change-me` value with a random string of letters and digits. Use the same owner password inside `MIGRATION_DATABASE_URL`.
2. `pnpm db:up` creates the volume, runs `packages/db/bootstrap/create-roles.sql` (roles + database) and waits until the database is healthy.
3. `pnpm db:migrate` applies the migrations as `app_owner`.

## Every day

| Task | Command |
| --- | --- |
| Start | `pnpm db:up` |
| Stop (data kept) | `docker compose stop` |
| Apply new migrations | `pnpm db:migrate` |
| New migration from schema changes | `pnpm db:generate` (review the SQL before committing) |
| Hand-written migration | `pnpm db:generate --custom --name=<what_it_does>` |
| Logs | `docker compose logs db` |

## Connecting with psql

```powershell
# As the administrator (inside the container, no password over the socket)
docker compose exec db psql -U postgres -d business_software
# As a specific app role over TCP (as the app does); put the password from .env
docker compose exec -e PGPASSWORD=<password> db psql -h 127.0.0.1 -U app_runtime -d business_software
```

## Things to know

- **The bootstrap runs only on an empty volume.** Changing a password in `.env` later does nothing by itself. Change it in the database too: `ALTER ROLE app_runtime PASSWORD '...'` as `postgres`.
- **`docker compose down` is safe.** It removes the container, not the volume.
- **`docker compose down -v` deletes the database** (the `pgdata` volume). Ask the owner first (`CLAUDE.md` rule 7). It's only ever needed to rerun the bootstrap from scratch.
- **Port 5432 already in use** (e.g. a PostgreSQL installed on Windows): stop that service, or change the left side of `127.0.0.1:5432:5432` in `compose.yaml` and the port in `MIGRATION_DATABASE_URL`.
- **`pnpm test` needs Docker too.** The integration tests start their own throwaway PostgreSQL, separate from this one.
