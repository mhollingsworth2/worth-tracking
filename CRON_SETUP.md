# Cron Job Setup

Instructions for configuring automated pipeline maintenance jobs on Railway.

---

## Overview

Two recurring jobs keep the data pipeline healthy:

| Job                  | Frequency | Endpoint                      | Purpose                                      |
|----------------------|-----------|-------------------------------|----------------------------------------------|
| Nightly archival     | Daily 2am | `POST /api/data/archival-run` | Archive old records, remove expired data     |
| Weekly deduplication | Sunday 3am| `POST /api/data/deduplicate/:id` | Remove duplicate scan records per business |

Both jobs are authenticated — they require an admin session token passed as a Bearer token in the `Authorization` header.

---

## Prerequisites

1. The Worth Tracking service is deployed and running on Railway.
2. You have the service's public URL (e.g., `https://worth-tracking.up.railway.app`).
3. You have an admin username and password.

### Obtain a long-lived session token

Railway cron jobs cannot maintain cookie sessions between runs. Use the Bearer token returned by the login endpoint instead.

```bash
curl -s -X POST https://worth-tracking.up.railway.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "worthcreative2026"}' \
  | jq -r '.token'
```

Copy the token value. You will use it as the `CRON_TOKEN` environment variable in the cron service.

> **Security note:** Store this token as a Railway environment variable, never hardcoded in a script. Rotate it by logging out and logging in again if it is ever exposed.

---

## Setting Up Nightly Archival

### Option A — Railway Cron Service (recommended)

Railway supports cron jobs as a separate service within the same project.

1. In your Railway project, click **+ New Service → Empty Service**.
2. Name it `pipeline-cron`.
3. Under **Settings → Deploy**, set the **Start Command** to:

```bash
curl -s -X POST $SERVICE_URL/api/data/archival-run \
  -H "Authorization: Bearer $CRON_TOKEN" \
  -H "Content-Type: application/json" \
  --fail \
  && echo "Archival run completed successfully" \
  || (echo "Archival run FAILED" && exit 1)
```

4. Under **Settings → Cron**, enable cron scheduling and set the schedule to:

```
0 2 * * *
```

This runs at 2:00 AM UTC every day.

5. Add the following environment variables to the `pipeline-cron` service:

| Variable      | Value                                          |
|---------------|------------------------------------------------|
| `SERVICE_URL` | `https://worth-tracking.up.railway.app`        |
| `CRON_TOKEN`  | The admin token obtained in the prerequisites  |

6. Deploy the service. Railway will execute the start command on the cron schedule.

### Option B — External cron (cron-job.org, EasyCron, etc.)

If you prefer an external scheduler:

1. Create a new cron job at your chosen provider.
2. Set the URL to: `https://worth-tracking.up.railway.app/api/data/archival-run`
3. Set the method to `POST`.
4. Add the header: `Authorization: Bearer <your-token>`
5. Add the header: `Content-Type: application/json`
6. Set the schedule to `0 2 * * *` (daily at 2am UTC).
7. Enable failure notifications to your email.

---

## Setting Up Weekly Deduplication

Deduplication is included in the `POST /api/data/archival-run` endpoint, so if you are using the nightly archival cron above, deduplication already runs every night. No separate job is needed.

If you want deduplication to run on a different schedule (e.g., weekly on Sundays to reduce load), you can run it per-business using a script:

### Per-business deduplication script

Create a shell script `deduplicate-all.sh`:

```bash
#!/bin/bash
set -e

SERVICE_URL="${SERVICE_URL:?SERVICE_URL is required}"
CRON_TOKEN="${CRON_TOKEN:?CRON_TOKEN is required}"

# Fetch all business IDs
BUSINESSES=$(curl -s "$SERVICE_URL/api/businesses" \
  -H "Authorization: Bearer $CRON_TOKEN" \
  | jq -r '.[].id')

for BIZ_ID in $BUSINESSES; do
  echo "Deduplicating business $BIZ_ID..."
  RESULT=$(curl -s -X POST "$SERVICE_URL/api/data/deduplicate/$BIZ_ID" \
    -H "Authorization: Bearer $CRON_TOKEN" \
    -H "Content-Type: application/json" \
    --fail)
  REMOVED=$(echo "$RESULT" | jq -r '.duplicatesRemoved')
  echo "  Business $BIZ_ID: $REMOVED duplicates removed"
done

echo "Deduplication complete."
```

Set the Railway cron schedule to:

```
0 3 * * 0
```

This runs at 3:00 AM UTC every Sunday.

---

## Monitoring Cron Execution

### Check Railway service logs

In the Railway dashboard, select the `pipeline-cron` service and open the **Logs** tab. Each execution should show the curl output. A successful run ends with `Archival run completed successfully`.

### Verify via the API

After a cron run, confirm archival happened by checking the database size indirectly through usage stats:

```bash
curl -s https://worth-tracking.up.railway.app/api/usage/history \
  -H "Authorization: Bearer $CRON_TOKEN"
```

You can also check that old records are no longer returned in search record queries — records older than 90 days should not appear in `GET /api/businesses/:id/records`.

### Set up Railway deployment notifications

In Railway project settings, enable **Deploy Notifications** to receive alerts when a cron service fails to deploy or crashes.

---

## Handling Failures

### The cron job ran but archival failed (HTTP 500)

1. Check the Railway logs for the `pipeline-cron` service for the error message.
2. Check the main `cooperative-learning` service logs for the corresponding server-side error.
3. Common causes: database locked (another operation was running), disk full (volume at capacity), or a bug in the archival module.
4. Retry manually:

```bash
curl -X POST https://worth-tracking.up.railway.app/api/data/archival-run \
  -H "Authorization: Bearer $CRON_TOKEN" \
  -H "Content-Type: application/json"
```

### The cron job ran but got HTTP 401

The session token has expired or been invalidated. Generate a new token (see Prerequisites) and update the `CRON_TOKEN` environment variable in the Railway `pipeline-cron` service.

### The cron job did not run at all

1. Verify the cron schedule syntax is correct. Use [crontab.guru](https://crontab.guru) to validate.
2. Check that the `pipeline-cron` service is deployed and not in a crashed state.
3. Railway cron jobs require the service to be in a running state. If the service has no persistent process, it will be started on schedule and exit after the command completes — this is the expected behaviour.

### Volume is still growing after archival

The archival job moves records to archive tables within the same SQLite file. The file size does not shrink immediately because SQLite does not reclaim space by default. To reclaim space, run a manual VACUUM:

```bash
# Connect to the Railway volume via a one-off command
# (requires Railway CLI)
railway run sqlite3 /data/data.db "VACUUM;"
```

This can take several minutes on large databases and briefly locks the database. Schedule it during off-peak hours.

---

## Example Configurations

### Minimal setup (archival only, nightly)

```
Schedule:  0 2 * * *
Command:   curl -sf -X POST $SERVICE_URL/api/data/archival-run -H "Authorization: Bearer $CRON_TOKEN" -H "Content-Type: application/json"
```

### Full setup (archival nightly + deduplication weekly)

Nightly archival (includes deduplication):
```
Schedule:  0 2 * * *
Command:   curl -sf -X POST $SERVICE_URL/api/data/archival-run -H "Authorization: Bearer $CRON_TOKEN" -H "Content-Type: application/json"
```

Weekly standalone deduplication (if you want a separate run):
```
Schedule:  0 3 * * 0
Command:   /scripts/deduplicate-all.sh
```

### Dry-run archival (for testing the schedule without modifying data)

```
Schedule:  0 2 * * *
Command:   curl -sf -X POST $SERVICE_URL/api/data/archive -H "Authorization: Bearer $CRON_TOKEN" -H "Content-Type: application/json" -d '{"dryRun": true}'
```

Switch `dryRun` to `false` once you have confirmed the schedule is working correctly.
