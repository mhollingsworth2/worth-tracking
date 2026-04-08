# Runbooks

Step-by-step procedures for common operational tasks on the Worth Tracking platform.

---

## Table of Contents

1. [Adding a new business and running the first scan](#1-adding-a-new-business-and-running-the-first-scan)
2. [Checking data quality](#2-checking-data-quality)
3. [Fixing data quality issues](#3-fixing-data-quality-issues)
4. [Setting up automated archival](#4-setting-up-automated-archival)
5. [Setting up automated deduplication](#5-setting-up-automated-deduplication)
6. [Monitoring data ingestion](#6-monitoring-data-ingestion)
7. [Recovering from failed scans](#7-recovering-from-failed-scans)
8. [Interpreting quality metrics](#8-interpreting-quality-metrics)

---

## 1. Adding a New Business and Running the First Scan

**Prerequisites:** Admin account, at least one API key configured.

### Step 1 — Verify API keys are active

```
GET /api/api-keys
```

Confirm at least one provider shows `"isActive": 1`. If no keys are configured, go to the API Keys page in the dashboard and add them before proceeding. See the [API key setup section in TROUBLESHOOTING.md](TROUBLESHOOTING.md#api-key-issues) if a key fails the test.

### Step 2 — Check the daily budget

```
GET /api/usage/today
```

Confirm `status` is `"ok"` and there is sufficient headroom. A typical scan across 4 providers and 7 queries costs approximately $0.08–$0.14. If `pctUsed` is above 90%, either wait until midnight UTC or increase the budget:

```
PATCH /api/settings/budget
{"dailyBudget": "25.00"}
```

### Step 3 — Create the business

```
POST /api/businesses
{
  "name": "Acme Roofing",
  "description": "Family-owned roofing contractor serving the greater Denver metro area since 1998. Specialising in residential re-roofing, storm damage repair, and commercial flat roofs.",
  "industry": "Roofing",
  "website": "https://acmeroofing.com",
  "location": "Denver, CO"
}
```

The response includes the new business `id`. Note it — you will need it for subsequent calls.

A set of demo data is automatically generated when a business is created. This gives the dashboard something to display immediately, but it is synthetic. Replace it with real data by running a scan.

### Step 4 — Run the first scan

```
POST /api/businesses/42/scan
```

Replace `42` with the actual business ID. The scan runs synchronously and returns when complete (typically 30–120 seconds depending on the number of providers and queries).

**Successful response:**

```json
{
  "jobId": 7,
  "totalQueries": 28,
  "platforms": 4,
  "mentions": 11
}
```

### Step 5 — Verify the scan results

```
GET /api/businesses/42/stats
GET /api/businesses/42/records
```

Confirm `totalSearches` matches `totalQueries` from the scan response. If it is lower, some provider calls failed — check the scan job for errors:

```
GET /api/businesses/42/scan-jobs
```

### Step 6 — Check the initial quality score

```
GET /api/data-quality/42
```

A freshly scanned business with 4 providers should score 70+ immediately. If the score is lower, see [Section 3 — Fixing data quality issues](#3-fixing-data-quality-issues).

---

## 2. Checking Data Quality

Run this procedure weekly or after any scan to confirm data health.

### Step 1 — Get the quality score

```
GET /api/data-quality/42
```

Review the `score`, `grade`, and `dimensions` object. Pay attention to any dimension scoring below 60.

### Step 2 — Check freshness

```
GET /api/data/freshness/42
```

Look for platforms with `status: "stale"` or `status: "no_data"`. Stale platforms drag down the freshness dimension score.

### Step 3 — Review recent scan jobs

```
GET /api/businesses/42/scan-jobs
```

Check the last 5 jobs. Any with `status: "failed"` should be investigated. The `error` field contains the failure reason.

### Step 4 — Review alerts

```
GET /api/alerts
```

Filter for the business. Unread alerts with `severity: "critical"` require immediate attention.

---

## 3. Fixing Data Quality Issues

### Low completeness score

**Cause:** Many records are missing `position`, `sentiment`, or `responseText`.

**Fix:** Run a fresh scan. The scan engine populates all fields from live API responses. Manually logged records (via `POST /api/businesses/:id/log-search`) often lack `responseText` — avoid using manual logging for bulk data entry.

### Low freshness score

**Cause:** No scan has been run in more than 7 days.

**Fix:** Run a scan immediately:

```
POST /api/businesses/42/scan
```

Then set up the nightly cron job so this does not recur. See [Section 4](#4-setting-up-automated-archival).

### Low coverage score

**Cause:** Fewer than 4 of the 6 supported platforms have data.

**Fix:** Add API keys for the missing providers. The platform-to-provider mapping is:

| Platform      | Provider key  | Where to get a key                          |
|---------------|---------------|---------------------------------------------|
| ChatGPT       | `openai`      | https://platform.openai.com/api-keys        |
| Claude        | `anthropic`   | https://console.anthropic.com/settings/keys |
| Google Gemini | `google`      | https://aistudio.google.com/apikey          |
| Perplexity    | `perplexity`  | https://www.perplexity.ai/settings/api      |

Note: Copilot and Meta AI are tracked in the platform list but do not have direct API integrations. Their data comes from manual log entries or future integrations.

```
POST /api/api-keys
{"provider": "google", "apiKey": "AIza..."}
```

Test the key before saving:

```
POST /api/api-keys/test
{"provider": "google", "apiKey": "AIza..."}
```

### Low consistency score

**Cause:** Records where `mentioned = 0` but `position` is not null, or vice versa.

**Fix:** Run deduplication to clean up malformed records:

```
POST /api/data/deduplicate/42
```

If the issue persists after deduplication, it may be caused by a bug in a custom integration. Validate records before inserting them:

```
POST /api/data/validate
{"businessId": 42, "platformId": 1, "query": "...", "mentioned": 0, "position": 3, "date": "2026-01-15"}
```

The validator will identify the inconsistency.

### Low volume score

**Cause:** Fewer than 30 records exist for the business.

**Fix:** Run multiple scans over several days. Each scan adds 7 queries × number of active providers records. With 4 providers, a single scan adds 28 records. Two scans on different days will push the volume above the 30-record threshold.

---

## 4. Setting up Automated Archival

Archival should run nightly to keep the database size manageable. See [CRON_SETUP.md](CRON_SETUP.md) for the full Railway cron configuration.

**Manual trigger (for testing):**

```
POST /api/data/archive
{"dryRun": true}
```

Review the `wouldArchive` counts. If they look correct, run without dry run:

```
POST /api/data/archive
{"dryRun": false}
```

**Verify the run:**

Check the response for `archived` counts and confirm `duration` is reasonable (under 30 seconds for a typical database). If archival takes longer than 60 seconds, the database may need index optimisation — see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#performance-problems).

---

## 5. Setting up Automated Deduplication

Deduplication should run weekly. It is included in the combined `POST /api/data/archival-run` endpoint, which is what the cron job calls. See [CRON_SETUP.md](CRON_SETUP.md).

**Manual trigger for a single business:**

```
POST /api/data/deduplicate/42
```

**Manual trigger for all businesses (via combined run):**

```
POST /api/data/archival-run
```

---

## 6. Monitoring Data Ingestion

### Check today's API usage

```
GET /api/usage/today
```

Key fields to watch:

- `status` — Should be `"ok"`. `"warning"` means you have used 75%+ of the daily budget. `"exceeded"` means scans are paused.
- `pctUsed` — Percentage of daily budget consumed.
- `byProvider` — Per-provider call counts and costs. Useful for identifying which provider is consuming the most budget.

### Check historical usage

```
GET /api/usage/history
```

Returns the last 30 days of daily spend. Look for unexpected spikes that might indicate runaway scans or misconfigured cron jobs.

### Check scan job history for a business

```
GET /api/businesses/42/scan-jobs
```

A healthy business should show regular `"completed"` jobs. Gaps in the job history indicate missed scans (cron not running) or budget exhaustion.

---

## 7. Recovering from Failed Scans

### Identify the failure

```
GET /api/businesses/42/scan-jobs
```

Find the job with `status: "failed"` and read the `error` field.

### Common failure causes and fixes

**"No API keys configured"**
Add at least one API key via `POST /api/api-keys` or the dashboard API Keys page.

**"Daily budget limit reached"**
Either wait until midnight UTC (the budget resets daily) or increase the budget:
```
PATCH /api/settings/budget
{"dailyBudget": "25.00"}
```

**"OpenAI API error 401"** / **"Anthropic API error 401"**
The API key is invalid or has been revoked. Test it:
```
POST /api/api-keys/test
{"provider": "openai", "apiKey": "sk-..."}
```
If it fails, generate a new key from the provider's dashboard and update it:
```
POST /api/api-keys
{"provider": "openai", "apiKey": "sk-new..."}
```

**"OpenAI API error 429"** / rate limit errors
The provider is rate-limiting your key. Wait a few minutes and retry. If this happens frequently, consider reducing scan frequency or upgrading your API plan.

**Network timeout / fetch failed**
The Railway service may have had a transient network issue. Retry the scan. If it fails consistently, check the Railway service logs for connectivity issues.

### Re-run the scan

Once the underlying issue is resolved, simply re-trigger the scan:

```
POST /api/businesses/42/scan
```

There is no need to clean up the failed job record — it is kept for audit purposes.

---

## 8. Interpreting Quality Metrics

### Understanding the composite score

The quality score (0–100) is a weighted average of five dimensions. A score of 83 does not mean 83% of records are good — it means the weighted combination of completeness, freshness, coverage, consistency, and volume is 83% of the theoretical maximum.

### What each grade means in practice

**Grade A (90–100):** The business has been scanned recently across multiple platforms, records are complete, and there are no consistency issues. The dashboard data is reliable for decision-making.

**Grade B (80–89):** Minor gaps exist — perhaps one platform is missing or data is 5 days old. The data is still reliable but a scan should be run soon.

**Grade C (70–79):** Noticeable gaps. Common causes: only 1–2 providers configured, last scan was 10+ days ago, or a significant portion of records lack position data. Decisions based on this data should be treated with caution.

**Grade D (50–69):** Data is significantly stale or incomplete. The dashboard may show misleading trends. Run a scan and add more API keys before drawing conclusions.

**Grade F (0–49):** Data is unreliable. This typically means the business was just created (only demo data exists) or no scans have been run in over a month. Do not use this data for reporting.

### The `recommendations` array

The quality endpoint returns a `recommendations` array with specific, actionable suggestions. Always address `critical` recommendations before `warning` ones. Recommendations are ordered by impact on the score.

### Freshness vs. completeness

These two dimensions are often confused:

- **Freshness** measures *when* data was collected. A business scanned yesterday has high freshness even if it has few records.
- **Completeness** measures *what* is in each record. A business with 100 records but all missing `position` has low completeness.

Both matter. A business with fresh but incomplete data (e.g., only manual log entries) will score well on freshness but poorly on completeness.
