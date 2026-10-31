# Local database runbook

PostgreSQL 18 runs in Docker Compose (`compose.yaml`), next to the app's own containers. Why it's set up this way: ADRs 0019 (database), 0020 (image), 0021 (migrations). Docker Desktop must be running.

## First time

1. Copy `.env.example` to `.env` and replace every `change-me` value with a random string of letters and digits. Use the same owner password inside `MIGRATION_DATABASE_URL` and the same runtime password inside `DATABASE_URL`.
2. `pnpm db:up` creates the volume, runs `packages/db/bootstrap/create-roles.sql` (roles + database) and waits until the database is healthy.
3. `pnpm db:migrate` applies the migrations as `app_owner`.

## Running the whole app in containers

`pnpm app:up` builds the image (the first build downloads every dependency and can take minutes; later builds reuse the cache) and starts, in order:

1. `db`, until it's healthy;
2. `migrate`, a one-shot container that applies migrations as `app_owner` and exits (`Exited (0)` is correct);
3. `api` (http://127.0.0.1:3000/api/health) and `worker`, as `app_runtime`, only if `migrate` succeeded.

`web` (http://127.0.0.1:8080) starts alongside without waiting: Caddy serves the built app and passes `/api` to `api` (ADR 0023). If the API isn't up, the page loads and its badge says it can't reach the server.

| Task | Command |
| --- | --- |
| Status | `docker compose ps -a` |
| Logs (JSON lines) | `docker compose logs api worker migrate` (Caddy: `docker compose logs web`) |
| Check the web server's headers | `curl -I http://127.0.0.1:8080/` |
| Is the database reachable? | `curl http://127.0.0.1:3000/api/health/ready` (503 means no) |
| Stop (data kept) | `docker compose stop` |

For day-to-day coding, run only the database (`pnpm db:up`) and the API and web app on the host with `pnpm dev`, which rebuilds and reloads on every save (open http://127.0.0.1:5173). Port 3000 can only be used by one of the two at a time, so `docker compose stop api` first if the containers are running.

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
# As any role; inside the container no password is checked
docker compose exec db psql -U postgres -d business_software
docker compose exec db psql -U app_runtime -d business_software
```

The image trusts every connection made from inside the container, even over `127.0.0.1`. Passwords are only checked for connections from outside it, such as the app, `pnpm db:migrate`, or a GUI client on `127.0.0.1:5432`. A wrong password there gets `password authentication failed` (`28P01`).

## Things to know

- **The bootstrap runs only on an empty volume.** Changing a password in `.env` later does nothing by itself. Change it in the database too: `ALTER ROLE app_runtime PASSWORD '...'` as `postgres`.
- **`docker compose down` is safe.** It removes the container, not the volume.
- **`docker compose down -v` deletes the database** (the `pgdata` volume). Ask the owner first (`CLAUDE.md` rule 7). It's only ever needed to rerun the bootstrap from scratch.
- **Port 5432 already in use** (e.g. a PostgreSQL installed on Windows): stop that service, or change the left side of `127.0.0.1:5432:5432` in `compose.yaml` and the port in `MIGRATION_DATABASE_URL`.
- **`pnpm test` needs Docker too.** The integration tests start their own throwaway PostgreSQL, separate from this one.
