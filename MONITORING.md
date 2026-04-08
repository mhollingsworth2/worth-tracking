# Monitoring Guide

How to monitor the health, performance, and cost of the Worth Tracking data pipeline.

---

## Understanding Quality Metrics

The quality score is the primary health indicator for each business's data. It is a composite of five dimensions, each weighted by its importance to data reliability.

### Reading the score

```
GET /api/data-quality/:businessId
```

```json
{
  "score": 76,
  "grade": "C",
  "dimensions": {
    "completeness": { "score": 90, "weight": 0.30 },
    "freshness":    { "score": 55, "weight": 0.25 },
    "coverage":     { "score": 67, "weight": 0.20 },
    "consistency":  { "score": 100, "weight": 0.15 },
    "volume":       { "score": 100, "weight": 0.10 }
  }
}
```

In this example, the low freshness score (55) is the primary drag on the overall score. The data is complete and consistent, but it has not been refreshed recently. The fix is to run a scan.

### Score thresholds and actions

| Score  | Grade | Recommended action                                                  |
|--------|-------|---------------------------------------------------------------------|
| 90–100 | A     | No action needed. Maintain current scan frequency.                  |
| 80–89  | B     | Monitor. Run a scan if freshness is below 70.                       |
| 70–79  | C     | Run a scan. Check for missing API keys.                             |
| 50–69  | D     | Run a scan immediately. Investigate missing platforms.              |
| 0–49   | F     | Data is unreliable. Do not use for reporting until resolved.        |

---

## Setting Up Dashboards

The built-in dashboard surfaces the most important metrics. For custom monitoring, use the API endpoints below to build external dashboards in tools like Grafana, Datadog, or a simple spreadsheet.

### Key endpoints for dashboard data

| Metric                        | Endpoint                                          |
|-------------------------------|---------------------------------------------------|
| Quality score per business    | `GET /api/data-quality/:businessId`               |
| Data freshness per platform   | `GET /api/data/freshness/:businessId`             |
| Search stats (mentions, rate) | `GET /api/businesses/:id/stats`                   |
| 30-day mention trend          | `GET /api/businesses/:id/trend`                   |
| Platform breakdown            | `GET /api/businesses/:id/platform-breakdown`      |
| Referral stats                | `GET /api/businesses/:id/referral-stats`          |
| Today's API spend             | `GET /api/usage/today`                            |
| 30-day spend history          | `GET /api/usage/history`                          |
| Scan job history              | `GET /api/businesses/:id/scan-jobs`               |
| Unread alert count            | `GET /api/alerts/unread-count`                    |

### Polling frequency recommendations

| Endpoint                  | Recommended poll interval |
|---------------------------|---------------------------|
| Quality score             | Every 15 minutes          |
| Freshness                 | Every 30 minutes          |
| API usage today           | Every 5 minutes           |
| Scan job status           | Every 30 seconds (during active scans only) |
| Alerts unread count       | Every 5 minutes           |
| Trend / stats             | Every 60 minutes          |

---

## Creating Alerts

The platform has a built-in alert system. Alerts are created automatically by the scan engine and quality module, and can also be created manually.

### Alert types

| Type                | Severity  | Trigger                                                    |
|---------------------|-----------|------------------------------------------------------------|
| `mention_drop`      | warning   | Mention rate drops more than 10% week-over-week            |
| `competitor_outrank`| warning   | A competitor appears before the business in a tracked query|
| `platform_missing`  | critical  | No mentions on a platform for 7+ days                     |
| `accuracy_issue`    | critical  | AI snapshot flagged with issues                            |
| `quality_degraded`  | warning   | Quality score drops below 70                               |
| `budget_warning`    | warning   | Daily API spend exceeds 75% of budget                      |
| `scan_failed`       | critical  | A scan job fails                                           |

### Checking unread alerts

```
GET /api/alerts/unread-count
```

```json
{"count": 3}
```

### Fetching all alerts

```
GET /api/alerts
```

Filter by `severity: "critical"` and `isRead: 0` to find items requiring immediate attention.

### Marking alerts as read

```
PATCH /api/alerts/:id/read
```

### Creating a custom alert

```
POST /api/alerts
{
  "businessId": 42,
  "type": "accuracy_issue",
  "message": "Perplexity is reporting an outdated phone number for Acme Roofing",
  "severity": "warning",
  "date": "2026-01-15"
}
```

### External alerting (webhook / email)

The platform does not currently send push notifications or emails natively. To integrate with an external alerting system (PagerDuty, Slack, email):

1. Set up a cron job that polls `GET /api/alerts/unread-count` every 5 minutes.
2. If `count > 0`, fetch `GET /api/alerts` and filter for unread critical alerts.
3. Send the alert details to your notification channel via webhook.

Example shell script for Slack:

```bash
#!/bin/bash
COUNT=$(curl -s "$SERVICE_URL/api/alerts/unread-count" \
  -H "Authorization: Bearer $CRON_TOKEN" | jq -r '.count')

if [ "$COUNT" -gt "0" ]; then
  ALERTS=$(curl -s "$SERVICE_URL/api/alerts" \
    -H "Authorization: Bearer $CRON_TOKEN" \
    | jq '[.[] | select(.isRead == 0 and .severity == "critical")]')

  curl -s -X POST "$SLACK_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"⚠️ $COUNT unread critical alerts in Worth Tracking:\n\`\`\`$ALERTS\`\`\`\"}"
fi
```

---

## Performance Monitoring

### Scan duration

Scan duration is not directly exposed via the API, but can be calculated from scan job records:

```
GET /api/businesses/42/scan-jobs
```

Calculate `completedAt - startedAt` for completed jobs. A healthy scan with 4 providers and 7 queries should complete in 30–90 seconds. Scans consistently taking over 3 minutes may indicate:

- Provider API latency issues (check provider status pages)
- Railway service under memory pressure
- Too many queries per scan (reduce via `generateScanQueries` in `server/ai-providers.ts`)

### Database size

SQLite database size is not exposed via the API. Monitor it via the Railway volume dashboard:

1. Railway project → your service → **Volumes** tab.
2. Check the used/total storage ratio.
3. If usage exceeds 80%, run a manual archival and VACUUM (see [CRON_SETUP.md](CRON_SETUP.md#volume-is-still-growing-after-archival)).

**Typical growth rates:**

| Businesses | Scans/day | Approximate growth/month |
|------------|-----------|--------------------------|
| 1–5        | 1         | ~5 MB                    |
| 5–10       | 1         | ~10 MB                   |
| 10–20      | 2         | ~40 MB                   |

With archival enabled, growth is bounded by the retention policy. After the first 90 days, the database size stabilises.

### API response times

Monitor response times via Railway's built-in metrics or by timing API calls. Expected response times:

| Endpoint                          | Expected p95 |
|-----------------------------------|--------------|
| `GET /api/businesses/:id/stats`   | < 50ms       |
| `GET /api/data-quality/:id`       | < 200ms      |
| `GET /api/data/freshness/:id`     | < 100ms      |
| `POST /api/data/validate`         | < 50ms       |
| `POST /api/businesses/:id/scan`   | 30–120s      |
| `POST /api/data/archival-run`     | 5–30s        |

If `GET` endpoints are taking over 500ms, the database may need indexes. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md#performance-problems).

---

## Volume Usage Tracking

### Current database file size

The database lives at `/data/data.db` on the Railway volume. Check its size via the Railway CLI:

```bash
railway run ls -lh /data/
```

### Estimating future growth

Each scan record is approximately 200 bytes. An AI snapshot is approximately 1–2 KB (due to the `responseText` field). A referral record is approximately 300 bytes.

For a business with 4 providers and 7 queries per scan, one daily scan generates:
- 28 `search_records` × 200 bytes = ~5.6 KB
- 28 `ai_snapshots` × 1.5 KB = ~42 KB
- ~8 `referrals` × 300 bytes = ~2.4 KB
- **Total per scan: ~50 KB**

With archival enabled and a 90-day retention window, the steady-state size for one business scanned daily is approximately:
- 90 days × 50 KB = ~4.5 MB per business

For 10 businesses: ~45 MB. Well within Railway's default volume allocation.

---

## Cost Tracking

### Today's spend

```
GET /api/usage/today
```

```json
{
  "date": "2026-01-15",
  "totalSpend": 0.087,
  "callCount": 28,
  "dailyBudget": 10.00,
  "pctUsed": 1,
  "byProvider": {
    "openai":     {"calls": 7, "cost": 0.021},
    "anthropic":  {"calls": 7, "cost": 0.028},
    "google":     {"calls": 7, "cost": 0.007},
    "perplexity": {"calls": 7, "cost": 0.035}
  },
  "status": "ok"
}
```

### 30-day spend history

```
GET /api/usage/history
```

Use this to identify days with unusually high spend (e.g., multiple scans triggered, or a runaway cron job).

### Adjusting the daily budget

```
PATCH /api/settings/budget
{
  "dailyBudget": "15.00",
  "autoPauseEnabled": true
}
```

With `autoPauseEnabled: true`, scans that would exceed the daily budget are rejected before any API calls are made. This prevents unexpected charges.

### Cost per provider (reference)

| Provider   | Model                  | Approx. cost/scan (7 queries) |
|------------|------------------------|-------------------------------|
| OpenAI     | gpt-5-mini             | $0.021                        |
| Anthropic  | claude-haiku-4-5       | $0.028                        |
| Google     | gemini-2.5-flash       | $0.007                        |
| Perplexity | sonar                  | $0.035                        |
| **Total**  | All 4 providers        | **~$0.091 per scan**          |

Monthly cost for one business scanned daily with all 4 providers: ~$2.73/month.

### Cost optimisation tips

1. **Reduce query count** — Edit `generateScanQueries()` in `server/ai-providers.ts` to generate fewer queries per scan. Reducing from 7 to 5 queries saves ~28% per scan.
2. **Disable expensive providers** — Perplexity costs 5× more than Google per call. If budget is tight, remove the Perplexity key and rely on the other three providers.
3. **Scan less frequently** — For businesses where daily freshness is not critical, reduce scan frequency to 3× per week. Quality scores above 80 can be maintained with scans every 2–3 days.
4. **Use the budget cap** — Keep `autoPauseEnabled: true` and set `dailyBudget` to a value you are comfortable with. The system will never exceed it.
