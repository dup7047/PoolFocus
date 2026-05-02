# PoolFocus Backend Runbook

Operational procedures for the Postgres database. Update this file whenever the
backup, restore, or alerting topology changes.

---

## Backups & point-in-time recovery

### Production (Railway Postgres)

Enable these in the Railway dashboard for the Postgres plugin **before** the
first real user data lands:

| Setting                       | Value                                     |
|-------------------------------|-------------------------------------------|
| Daily snapshots               | **Enabled**                               |
| Snapshot retention            | **30 days**                               |
| Point-in-time recovery (PITR) | **Enabled**, **7-day** window             |
| Snapshot region               | Match the primary database region         |

Notes:
- Railway's PITR window is the maximum interval inside which we can restore to
  any second. Choose 7 days as a balance of cost vs. blast-radius.
- Snapshots and PITR both live on Railway-managed storage. We do **not** need
  to ship dumps to S3 for v1, but the local `scripts/backup.sh` exists for
  pre-migration safety dumps and ad-hoc archival.
- If Railway is ever changed to a different provider, mirror the same retention
  policy on the new provider before flipping DNS.

### Local development

```bash
DATABASE_URL=postgres://… ./scripts/backup.sh
```

Writes a `pg_dump --format=custom` archive into `./tmp/`.

---

## Restoring from a backup

Two modes: **full restore** (latest snapshot) and **PITR** (specific second).
Use PITR when we know roughly when bad data was written; use full when the
whole database is corrupted or lost.

### Production: full restore from snapshot (Railway)

1. **Stop writes**: in Railway, scale the backend service to 0 replicas.
2. In Railway → Postgres plugin → **Backups**, pick the most recent snapshot
   prior to the incident. Click **Restore** → choose **Restore as new database**.
   This takes a few minutes; do not click again.
3. Once the new database is healthy, copy its `DATABASE_URL`.
4. Update the backend service environment variable to point at the restored
   database. Redeploy.
5. Scale the backend back to 1 replica.
6. Smoke-test: `curl https://<backend-host>/health` returns `storage: postgres`.
   Verify a known user can call `/challenge/leaderboard/...` and get a 200.

### Production: point-in-time recovery (Railway)

1. Steps 1–2 above, but choose **Point in time** and enter the target UTC
   timestamp. Railway provisions a new database restored to that exact second.
2. Continue with steps 3–6 above.

### Local: restore drill (the rehearsal we actually test)

This is the procedure that's exercised by `./scripts/restore-drill.sh`. Run it
quarterly, and any time the schema changes substantially.

```bash
DATABASE_URL=postgres://poolfocus:poolfocus@localhost:5432/poolfocus_dev \
  ./scripts/restore-drill.sh
```

The script will:

1. `pg_dump` the source database to `./tmp/<db>.dump`.
2. `CREATE DATABASE restore_drill_<timestamp>` on the same cluster.
3. `pg_restore` the dump into the scratch DB.
4. Run sanity checks: every expected table is queryable, the
   `screen_time_events_entry_client_event_unique` index is present, and the
   `challenge_entries_set_updated_at` trigger is wired.
5. `DROP DATABASE` the scratch.
6. Print elapsed seconds. Exits non-zero if elapsed > **900 s** (the 15-minute
   SLO).

**Acceptance:** the drill must complete inside 15 minutes against a database of
realistic size. Last run: see the most recent commit that touches this file.

**Last verified:** 2026-05-02 against the seeded `poolfocus_dev` database
(8 tables, ≤10 rows). Drill completed in **3 seconds**. Procedure was
verified by running the equivalent `pg_dump`/`pg_restore`/`psql` commands
inside the `poolfocus-postgres` Docker container (since libpq client tools
are not installed on the operator's laptop). The script as written assumes
local libpq; the equivalent docker-exec form is below.

#### Docker-only fallback (no local libpq)

If you don't have `pg_dump` etc. installed locally, run the same drill via
the running Postgres container:

```bash
SCRATCH="restore_drill_$(date -u +%Y%m%d_%H%M%S)"
docker exec poolfocus-postgres pg_dump --format=custom --no-owner --no-acl \
  -U poolfocus -d poolfocus_dev -f /tmp/snap.dump
docker exec poolfocus-postgres psql -U poolfocus -d postgres \
  -c "CREATE DATABASE \"$SCRATCH\";"
docker exec poolfocus-postgres pg_restore --no-owner --no-acl \
  -U poolfocus -d "$SCRATCH" /tmp/snap.dump
# …sanity checks…
docker exec poolfocus-postgres psql -U poolfocus -d postgres \
  -c "DROP DATABASE \"$SCRATCH\" WITH (FORCE);"
```

---

## Common operations

### Apply migrations

```bash
DATABASE_URL=… npm run migrate
```

Migrator is `dist/src/db/migrate.js`. It takes an exclusive advisory lock, so
running it twice concurrently is safe.

### Generate a schema-diff migration

```bash
npm run migrate:generate
```

### Generate a custom (raw SQL) migration

```bash
npm run migrate:custom
```

Edit the produced file in `drizzle/` and re-run `npm run migrate`.

---

## What this runbook does **not** cover (yet)

- Cross-region disaster recovery (single-region Railway for v1).
- Encryption-at-rest key rotation (Railway-managed; no action needed for v1).
- Read replicas (none until traffic justifies it).

Update this section as soon as any of the above changes.
