# Data Quality API Reference

Complete reference for the six data quality and pipeline management endpoints introduced with the `data-validation.ts`, `data-quality.ts`, and `data-archival.ts` modules.

All endpoints require authentication. Admin-only endpoints are noted. Requests and responses use `Content-Type: application/json`.

---

## Authentication

All API requests must include a valid session cookie or Bearer token obtained from `POST /api/auth/login`.

```
Cookie: session=<token>
# or
Authorization: Bearer <token>
```

---

## Endpoints

### GET /api/data-quality/:businessId

Returns the composite quality score and per-dimension breakdown for a business's data.

**Auth:** Any authenticated user with access to the business.

**Path parameters:**

| Parameter    | Type    | Description                  |
|--------------|---------|------------------------------|
| `businessId` | integer | ID of the business to assess |

**Response `200 OK`:**

```json
{
  "businessId": 42,
  "score": 83,
  "grade": "B",
  "dimensions": {
    "completeness": {
      "score": 84,
      "weight": 0.30,
      "detail": "38 of 45 records fully populated"
    },
    "freshness": {
      "score": 93,
      "weight": 0.25,
      "detail": "Last scan 2 days ago"
    },
    "coverage": {
      "score": 50,
      "weight": 0.20,
      "detail": "3 of 6 platforms have data in the last 30 days"
    },
    "consistency": {
      "score": 98,
      "weight": 0.15,
      "detail": "44 of 45 records are internally consistent"
    },
    "volume": {
      "score": 100,
      "weight": 0.10,
      "detail": "45 records (minimum 30 required)"
    }
  },
  "recommendations": [
    "Add API keys for Copilot and Meta AI to improve platform coverage",
    "Run a scan to refresh data older than 7 days"
  ],
  "computedAt": "2026-01-15T14:32:00.000Z"
}
```

**Grade scale:**

| Score  | Grade | Meaning                                      |
|--------|-------|----------------------------------------------|
| 90–100 | A     | Excellent — data is fresh, complete, and broad |
| 80–89  | B     | Good — minor gaps, no immediate action needed |
| 70–79  | C     | Fair — some dimensions need attention         |
| 50–69  | D     | Poor — stale or incomplete data               |
| 0–49   | F     | Critical — data is unreliable                 |

**Error responses:**

| Status | Body                                      | Cause                          |
|--------|-------------------------------------------|--------------------------------|
| `401`  | `{"error": "Not authenticated"}`          | Missing or expired session     |
| `403`  | `{"error": "Access denied to this business"}` | User not assigned to business |
| `404`  | `{"error": "Business not found"}`         | Invalid `businessId`           |

---

### GET /api/data/freshness/:businessId

Returns a freshness report showing when data was last collected for each platform, and which platforms have gone stale.

**Auth:** Any authenticated user with access to the business.

**Path parameters:**

| Parameter    | Type    | Description       |
|--------------|---------|-------------------|
| `businessId` | integer | Target business ID |

**Response `200 OK`:**

```json
{
  "businessId": 42,
  "overallFreshness": "stale",
  "lastScanAt": "2026-01-08T09:15:00.000Z",
  "daysSinceLastScan": 7,
  "platforms": [
    {
      "platformId": 1,
      "platformName": "ChatGPT",
      "lastRecordDate": "2026-01-08",
      "daysSinceUpdate": 7,
      "status": "stale",
      "recordCount": 12
    },
    {
      "platformId": 2,
      "platformName": "Perplexity",
      "lastRecordDate": "2026-01-08",
      "daysSinceUpdate": 7,
      "status": "stale",
      "recordCount": 9
    },
    {
      "platformId": 3,
      "platformName": "Google Gemini",
      "lastRecordDate": null,
      "daysSinceUpdate": null,
      "status": "no_data",
      "recordCount": 0
    }
  ],
  "recommendation": "Run a new scan to refresh data. 2 platforms have no data — add API keys for Google and Anthropic."
}
```

**Freshness status values:**

| Status     | Meaning                                  |
|------------|------------------------------------------|
| `fresh`    | Data collected within the last 3 days    |
| `aging`    | Data is 4–7 days old                     |
| `stale`    | Data is 8–30 days old                    |
| `expired`  | Data is older than 30 days               |
| `no_data`  | No records exist for this platform       |

**Error responses:** Same as `GET /api/data-quality/:businessId`.

---

### POST /api/data/validate

Validates a search record payload without writing it to the database. Use this to pre-check data before bulk imports or to debug validation failures.

**Auth:** Any authenticated user.

**Request body:**

```json
{
  "businessId": 42,
  "platformId": 1,
  "query": "best marketing agencies in New York",
  "mentioned": 1,
  "position": 2,
  "date": "2026-01-15",
  "sentiment": "positive",
  "responseText": "Some of the top marketing agencies in New York include..."
}
```

**Required fields:** `businessId`, `platformId`, `query`, `date`

**Response `200 OK` — valid record:**

```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    {
      "field": "responseText",
      "message": "responseText is recommended for quality scoring but not required"
    }
  ]
}
```

**Response `200 OK` — invalid record:**

```json
{
  "valid": false,
  "errors": [
    {
      "field": "date",
      "message": "date must be in YYYY-MM-DD format"
    },
    {
      "field": "position",
      "message": "position must be null when mentioned is 0"
    }
  ],
  "warnings": []
}
```

Note: This endpoint always returns `200`. The `valid` field in the body indicates whether the record passed validation. A `400` is only returned if the request body itself is malformed JSON.

**Error responses:**

| Status | Body                                 | Cause                      |
|--------|--------------------------------------|----------------------------|
| `400`  | `{"error": "Invalid request body"}`  | Malformed JSON             |
| `401`  | `{"error": "Not authenticated"}`     | Missing or expired session |

---

### POST /api/data/deduplicate/:businessId

Triggers a deduplication run for a specific business. Identifies and removes duplicate `search_records` based on `(platformId, query, date)` matching, retaining the most complete record in each group.

**Auth:** Admin only.

**Path parameters:**

| Parameter    | Type    | Description       |
|--------------|---------|-------------------|
| `businessId` | integer | Target business ID |

**Request body:** Empty (`{}`) or omitted.

**Response `200 OK`:**

```json
{
  "businessId": 42,
  "duplicatesFound": 14,
  "duplicatesRemoved": 14,
  "recordsRetained": 31,
  "duration": "1.2s",
  "completedAt": "2026-01-15T14:45:00.000Z"
}
```

**How duplicates are selected for removal:**

When multiple records share the same `(businessId, platformId, query, date)`, the deduplication routine scores each record and retains the highest-scoring one:

1. +2 points if `position` is not null
2. +2 points if `responseText` is not null (via linked `ai_snapshot`)
3. +1 point if `sentiment` is not `neutral`

Ties are broken by keeping the record with the lowest `id` (earliest inserted).

**Error responses:**

| Status | Body                                      | Cause                          |
|--------|-------------------------------------------|--------------------------------|
| `401`  | `{"error": "Not authenticated"}`          | Missing or expired session     |
| `403`  | `{"error": "Forbidden"}`                  | Non-admin user                 |
| `404`  | `{"error": "Business not found"}`         | Invalid `businessId`           |

---

### POST /api/data/archive

Manually triggers an archival run across all businesses. Moves records older than the configured retention thresholds into archive tables. This is the same operation run by the nightly cron job.

**Auth:** Admin only.

**Request body:**

```json
{
  "dryRun": false
}
```

| Field    | Type    | Default | Description                                                                 |
|----------|---------|---------|-----------------------------------------------------------------------------|
| `dryRun` | boolean | `false` | If `true`, reports what would be archived without making any changes        |

**Response `200 OK`:**

```json
{
  "dryRun": false,
  "archived": {
    "search_records": 312,
    "ai_snapshots": 87,
    "referrals": 204,
    "api_usage": 1450
  },
  "deleted": {
    "search_records": 0,
    "ai_snapshots": 0,
    "referrals": 0,
    "api_usage": 0
  },
  "duration": "3.4s",
  "completedAt": "2026-01-15T02:00:00.000Z"
}
```

**Dry run response** (same shape, no data modified):

```json
{
  "dryRun": true,
  "wouldArchive": {
    "search_records": 312,
    "ai_snapshots": 87,
    "referrals": 204,
    "api_usage": 1450
  },
  "wouldDelete": {
    "search_records": 0,
    "ai_snapshots": 0,
    "referrals": 0,
    "api_usage": 0
  },
  "duration": "0.8s",
  "completedAt": "2026-01-15T14:50:00.000Z"
}
```

**Error responses:**

| Status | Body                                 | Cause                      |
|--------|--------------------------------------|----------------------------|
| `401`  | `{"error": "Not authenticated"}`     | Missing or expired session |
| `403`  | `{"error": "Forbidden"}`             | Non-admin user             |
| `500`  | `{"error": "<message>"}`             | Database error during archival |

---

### POST /api/data/archival-run

Triggers a full pipeline maintenance run: archival followed by deduplication across all businesses. This is the endpoint called by the Railway cron job.

**Auth:** Admin only.

**Request body:** Empty (`{}`) or omitted.

**Response `200 OK`:**

```json
{
  "archival": {
    "archived": {
      "search_records": 312,
      "ai_snapshots": 87,
      "referrals": 204,
      "api_usage": 1450
    },
    "deleted": {
      "search_records": 0,
      "ai_snapshots": 0,
      "referrals": 0,
      "api_usage": 0
    }
  },
  "deduplication": {
    "businessesProcessed": 8,
    "totalDuplicatesRemoved": 23
  },
  "duration": "12.1s",
  "completedAt": "2026-01-15T02:05:00.000Z"
}
```

**Error responses:**

| Status | Body                                 | Cause                      |
|--------|--------------------------------------|----------------------------|
| `401`  | `{"error": "Not authenticated"}`     | Missing or expired session |
| `403`  | `{"error": "Forbidden"}`             | Non-admin user             |
| `500`  | `{"error": "<message>"}`             | Pipeline error             |

---

## Error Handling Summary

All endpoints follow a consistent error shape:

```json
{
  "error": "Human-readable description of what went wrong"
}
```

For validation errors from `POST /api/data/validate`, errors are returned as an array of `{ field, message }` objects within the `200` response body — not as HTTP error codes — so callers can display field-level feedback.

Retry guidance:
- `400` — Fix the request payload. Do not retry as-is.
- `401` — Re-authenticate and retry.
- `403` — You do not have permission. Do not retry.
- `404` — The resource does not exist. Verify the ID.
- `429` — Daily budget exceeded. Wait until midnight UTC or increase the budget via `PATCH /api/settings/budget`.
- `500` — Server error. Safe to retry after a short delay. Check Railway logs if it persists.
