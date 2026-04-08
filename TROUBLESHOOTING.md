# Troubleshooting Guide

Common issues and their solutions for the Worth Tracking data pipeline.

---

## Table of Contents

1. [Validation errors](#1-validation-errors)
2. [Low quality scores](#2-low-quality-scores)
3. [Duplicate records](#3-duplicate-records)
4. [Archival failures](#4-archival-failures)
5. [API key issues](#5-api-key-issues)
6. [Stuck scan jobs](#6-stuck-scan-jobs)
7. [Volume space issues](#7-volume-space-issues)
8. [Performance problems](#8-performance-problems)

---

## 1. Validation Errors

### "date must be in YYYY-MM-DD format"

**Cause:** The `date` field was passed as a full ISO timestamp (`2026-01-15T14:32:00.000Z`) or in a non-standard format (`01/15/2026`).

**Fix:** Strip the time component before sending:

```javascript
const date = new Date().toISOString().split('T')[0]; // "2026-01-15"
```

### "position must be null when mentioned is 0"

**Cause:** A record was submitted with `mentioned: 0` but a non-null `position` value. This is logically inconsistent — a business cannot have a position in a response that does not mention it.

**Fix:** Set `position: null` whenever `mentioned` is `0`:

```javascript
const record = {
  mentioned: 0,
  position: null, // always null when mentioned is 0
  // ...
};
```

### "businessId does not exist"

**Cause:** The `businessId` in the record does not match any business in the database. This can happen if a business was deleted after the record was queued, or if the wrong ID was used.

**Fix:** Verify the business exists:

```
GET /api/businesses/:id
```

If it returns `404`, the business has been deleted. Either recreate it or discard the record.

### "platformId does not exist"

**Cause:** The `platformId` does not match any of the 6 seeded platforms.

**Fix:** Fetch the current platform list to get valid IDs:

```
GET /api/platforms
```

The platform IDs are seeded at startup and are stable (1–6), but may differ between environments if the database was recreated.

### "query must be between 3 and 500 characters"

**Cause:** The query string is either too short (e.g., an empty string or a single word) or too long (e.g., a full paragraph was accidentally passed as the query).

**Fix:** Truncate long queries to 500 characters. Ensure queries are meaningful search phrases, not single characters or empty strings.

### "sentiment must be one of: positive, neutral, negative"

**Cause:** An invalid sentiment value was passed (e.g., `"mixed"`, `"unknown"`, `null`).

**Fix:** Map your sentiment values to the accepted set. If sentiment is unknown, use `"neutral"`.

---

## 2. Low Quality Scores

### Score is below 50 (Grade F)

This almost always means the business was just created and only has demo data, or no scans have been run in over 30 days.

**Fix:**
1. Run a scan: `POST /api/businesses/:id/scan`
2. Verify at least 2 API keys are active: `GET /api/api-keys`
3. Check the scan completed successfully: `GET /api/businesses/:id/scan-jobs`

### Freshness dimension is below 60

**Cause:** The last scan was more than 10 days ago.

**Fix:** Run a scan immediately and set up the nightly cron job. See [CRON_SETUP.md](CRON_SETUP.md).

### Coverage dimension is below 50

**Cause:** Fewer than 3 of the 6 platforms have data in the last 30 days.

**Fix:** Add API keys for more providers. The four supported providers (OpenAI, Anthropic, Google, Perplexity) cover 4 of the 6 platforms. Copilot and Meta AI require manual log entries until direct API integrations are added.

```
POST /api/api-keys
{"provider": "google", "apiKey": "AIza..."}
```

### Completeness dimension is below 70

**Cause:** Many records are missing `position`, `sentiment`, or `responseText`. This typically happens when records are inserted manually via `POST /api/businesses/:id/log-search` without providing `responseText`.

**Fix:** Run a full scan to replace manual records with complete automated records. For future manual entries, always include `responseText`.

### Consistency dimension is below 90

**Cause:** Records exist where `mentioned = 0` but `position` is not null, or where `mentioned = 1` but `position` is null.

**Fix:** Run deduplication to remove malformed records:

```
POST /api/data/deduplicate/:businessId
```

If the issue persists, check any custom integrations that insert records directly and ensure they follow the validation rules.

---

## 3. Duplicate Records

### Symptoms

- `GET /api/businesses/:id/stats` shows an unusually high `totalSearches` count
- The same query appears multiple times on the same date in `GET /api/businesses/:id/records`
- Quality score is high but mention rate seems inflated

### Cause

Duplicates arise from:
- Running multiple scans on the same day (each scan re-queries all providers)
- A cron job running more frequently than intended
- Manual log entries overlapping with automated scan results

### Fix

Run deduplication for the affected business:

```
POST /api/data/deduplicate/42
```

Check the response to confirm duplicates were found and removed:

```json
{
  "duplicatesFound": 28,
  "duplicatesRemoved": 28,
  "recordsRetained": 35
}
```

### Prevention

- Run scans at most once per day per business.
- Verify the cron schedule is correct — `0 2 * * *` runs once daily, not `* 2 * * *` (which would run every minute during the 2am hour).
- Do not manually log searches for queries that are already covered by automated scans.

---

## 4. Archival Failures

### "database is locked"

**Cause:** Another operation (a scan, a query, or a previous archival run) was holding a write lock on the SQLite database when the archival job started.

**Fix:** SQLite WAL mode (enabled at startup) significantly reduces lock contention, but it does not eliminate it entirely. Retry the archival run after a few seconds:

```
POST /api/data/archive
{"dryRun": false}
```

If locking is frequent, ensure the nightly archival cron runs at a time when no scans are scheduled (e.g., 2am UTC when no users are active).

### "SQLITE_FULL: database or disk is full"

**Cause:** The Railway volume has run out of space.

**Fix:** See [Section 7 — Volume space issues](#7-volume-space-issues).

### Archival ran but database size did not decrease

**Cause:** SQLite does not reclaim disk space when rows are deleted or moved. The file size only decreases after a `VACUUM` operation.

**Fix:** Run VACUUM via the Railway CLI:

```bash
railway run sqlite3 /data/data.db "VACUUM;"
```

This rewrites the entire database file and can take several minutes. The database is locked during this operation — schedule it during off-peak hours.

### Archival removed records that should have been kept

**Cause:** The retention thresholds in `server/data-archival.ts` may be set too aggressively, or the system clock on the Railway service is incorrect.

**Fix:**
1. Check the current date on the server: `GET /api/usage/today` — the `date` field reflects the server's current date.
2. Review the retention constants in `server/data-archival.ts` and adjust if needed.
3. Archived records are moved to `*_archive` tables, not deleted immediately. You can recover them by moving them back from the archive table using the Railway CLI and SQLite.

---

## 5. API Key Issues

### "No API keys configured"

**Cause:** No API keys have been added, or all keys have been deactivated.

**Fix:** Add at least one key via the dashboard API Keys page or directly:

```
POST /api/api-keys
{"provider": "openai", "apiKey": "sk-..."}
```

### Key test fails with "Invalid API key"

**Cause:** The key was entered incorrectly, has been revoked, or belongs to a different provider.

**Fix:**
1. Copy the key directly from the provider's dashboard — do not retype it.
2. Verify you are using the correct `provider` value (`openai`, `anthropic`, `google`, or `perplexity`).
3. Check the provider's dashboard to confirm the key is active and has not expired.

```
POST /api/api-keys/test
{"provider": "openai", "apiKey": "sk-..."}
```

### Key test passes but scans still fail

**Cause:** The key may have insufficient permissions or quota for the model used by the scan engine.

**Fix:** Check the specific model requirements:

| Provider   | Model used              | Required permission          |
|------------|-------------------------|------------------------------|
| OpenAI     | `gpt-5-mini`            | Chat completions access      |
| Anthropic  | `claude-haiku-4-5`      | Messages API access          |
| Google     | `gemini-2.5-flash`      | Generative Language API      |
| Perplexity | `sonar`                 | Chat completions access      |

Ensure the API key's associated account has access to these specific models. Some providers require explicit model access to be enabled in the account settings.

### "OpenAI API error 429" during scan

**Cause:** The OpenAI key has hit its rate limit (requests per minute or tokens per minute).

**Fix:**
- Wait 60 seconds and retry.
- If this happens frequently, upgrade your OpenAI API tier.
- Alternatively, reduce scan frequency or remove OpenAI and rely on other providers.

### Masked keys in the API response

The `GET /api/api-keys` endpoint returns keys with the value masked (e.g., `"sk-proj-ab..."`). This is intentional — full key values are never returned via the API after initial storage. If you need to verify a key, use the test endpoint.

---

## 6. Stuck Scan Jobs

### Scan job shows status "running" for more than 10 minutes

**Cause:** The scan process may have crashed mid-execution, leaving the job in a `running` state without a process to complete it. This can happen if the Railway service was restarted during a scan.

**Diagnosis:**

```
GET /api/businesses/42/scan-jobs
```

If the most recent job has `status: "running"` and `startedAt` is more than 10 minutes ago, it is stuck.

**Fix:** There is no automatic recovery for stuck jobs. The job record will remain in `running` state permanently. To resolve:

1. Note the stuck job's `id` for your records.
2. Run a new scan — this creates a fresh job and the old stuck job is effectively abandoned:

```
POST /api/businesses/42/scan
```

3. If stuck jobs accumulate and clutter the scan history, they can be cleaned up directly in the database via the Railway CLI:

```bash
railway run sqlite3 /data/data.db \
  "UPDATE scan_jobs SET status='failed', error='Abandoned - service restart', completed_at=datetime('now') WHERE status='running' AND started_at < datetime('now', '-10 minutes');"
```

### Scan returns immediately with 0 queries completed

**Cause:** All API keys failed validation or all providers returned errors.

**Fix:**
1. Test each API key individually: `POST /api/api-keys/test`
2. Check the Railway service logs for provider error messages.
3. Verify the business has a valid `name` and `industry` — these are used to generate queries.

---

## 7. Volume Space Issues

### Railway volume is above 80% capacity

**Symptoms:** Archival runs slowly, database writes start failing, or Railway shows a volume usage warning.

**Immediate fix:**

1. Run archival to move old records to archive tables:

```
POST /api/data/archive
{"dryRun": false}
```

2. Run VACUUM to reclaim space:

```bash
railway run sqlite3 /data/data.db "VACUUM;"
```

3. Check the volume size after VACUUM:

```bash
railway run ls -lh /data/
```

### Volume is full (SQLITE_FULL errors)

**Cause:** The database file has grown to fill the entire Railway volume allocation.

**Immediate fix:**

1. In the Railway dashboard, increase the volume size (Settings → Volumes → Resize).
2. Once the volume is resized, run archival and VACUUM as above.

**Long-term fix:**

- Reduce scan frequency for businesses that do not need daily updates.
- Reduce the retention period in `server/data-archival.ts` (e.g., from 90 days to 60 days for `search_records`).
- Remove businesses that are no longer being tracked: `DELETE /api/businesses/:id`.

### Archive tables are growing too large

**Cause:** Records are being archived but never permanently deleted. The deletion thresholds in `server/data-archival.ts` may be set too conservatively.

**Fix:** Review and reduce the deletion thresholds. For example, to delete archived `search_records` after 180 days instead of 365:

```typescript
// server/data-archival.ts
const DELETION_THRESHOLDS = {
  search_records: 180, // was 365
  ai_snapshots: 120,   // was 180
  referrals: 180,      // was 365
  api_usage: 30,
};
```

Deploy the change and run `POST /api/data/archival-run` to apply it immediately.

---

## 8. Performance Problems

### Dashboard loads slowly (> 2 seconds)

**Cause:** The SQLite database has grown large and queries are doing full table scans.

**Diagnosis:** Check the database file size:

```bash
railway run ls -lh /data/
```

If the file is over 100 MB, indexes may help significantly.

**Fix:** Add composite indexes for the most common query patterns:

```bash
railway run sqlite3 /data/data.db "
  CREATE INDEX IF NOT EXISTS idx_search_records_biz_date
    ON search_records(business_id, date);

  CREATE INDEX IF NOT EXISTS idx_ai_snapshots_biz_date
    ON ai_snapshots(business_id, date);

  CREATE INDEX IF NOT EXISTS idx_referrals_biz_date
    ON referrals(business_id, date);

  CREATE INDEX IF NOT EXISTS idx_api_usage_date
    ON api_usage(date);
"
```

These indexes are not created by default because they add write overhead. For databases under 50 MB, they are not necessary.

### Quality score endpoint is slow (> 500ms)

**Cause:** The quality score computation involves multiple aggregate queries across large tables.

**Fix:**
1. Add the indexes described above.
2. The quality score is cached for 5 minutes — if you are polling it more frequently than that, reduce the polling interval.

### Scans are taking over 3 minutes

**Cause:** Provider API latency is high, or the Railway service is under memory pressure.

**Diagnosis:**
1. Check provider status pages for outages:
   - OpenAI: https://status.openai.com
   - Anthropic: https://status.anthropic.com
   - Google: https://status.cloud.google.com
   - Perplexity: https://status.perplexity.ai

2. Check Railway service memory usage in the Railway dashboard (Metrics tab).

**Fix:**
- If a specific provider is slow, temporarily remove its API key to skip it during scans.
- If memory is high, consider upgrading the Railway service plan or reducing the number of concurrent operations.
- Reduce the number of queries per scan by editing `generateScanQueries()` in `server/ai-providers.ts`.

### Archival run takes over 60 seconds

**Cause:** The database has a very large number of records to process, or the database file is fragmented.

**Fix:**
1. Run VACUUM to defragment the database:

```bash
railway run sqlite3 /data/data.db "VACUUM;"
```

2. Add indexes (see above) to speed up the date-range queries used by the archival module.

3. If the database is very large (> 500 MB), consider splitting the archival run into smaller batches by processing one table at a time using the individual `POST /api/data/archive` endpoint rather than the combined `POST /api/data/archival-run`.
