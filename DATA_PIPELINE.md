# Data Pipeline Architecture

This document describes how data flows through the Worth Tracking platform — from AI scan ingestion through validation, quality scoring, deduplication, and archival.

---

## Overview

The data pipeline is responsible for collecting AI search visibility data, ensuring its integrity, measuring its quality, and managing its lifecycle. Every search record, AI snapshot, and referral event passes through this pipeline before being surfaced in the dashboard.

```
AI Providers (OpenAI / Anthropic / Google / Perplexity)
        │
        ▼
   Scan Job Engine  (server/ai-providers.ts)
        │
        ▼
   Data Validation  (server/data-validation.ts)
        │
        ▼
   SQLite Database  (/data/data.db)
        │
        ├──► Quality Metrics  (server/data-quality.ts)
        │
        └──► Archival / Deduplication  (server/data-archival.ts)
```

---

## Key Components

### 1. Scan Job Engine (`server/ai-providers.ts`)

The scan engine is the entry point for all live data. When a scan is triggered via `POST /api/businesses/:id/scan`, the engine:

1. Generates a set of queries tailored to the business name, industry, and location using `generateScanQueries()`.
2. Iterates over every active API key and every query, calling the appropriate provider function (`queryOpenAI`, `queryAnthropic`, `queryGemini`, `queryPerplexity`).
3. Yields `AIQueryResult` objects containing the raw response text, mention detection, position, and sentiment.
4. Writes each result as a `search_record` and an `ai_snapshot` to the database.
5. Tracks per-call API cost in the `api_usage` table and enforces the daily budget limit before the scan begins.

**Supported providers and their platform mappings:**

| Provider key | Platform name   | Estimated cost/call |
|--------------|-----------------|---------------------|
| `openai`     | ChatGPT         | $0.003              |
| `anthropic`  | Claude          | $0.004              |
| `google`     | Google Gemini   | $0.001              |
| `perplexity` | Perplexity      | $0.005              |

### 2. Data Validation (`server/data-validation.ts`)

The validation layer runs before any record is committed to the database. It enforces structural and business-logic rules:

- **Required fields** — `businessId`, `platformId`, `query`, and `date` must be present and non-empty.
- **Date format** — Dates must be ISO 8601 (`YYYY-MM-DD`).
- **Business existence** — The referenced `businessId` must exist in the `businesses` table.
- **Platform existence** — The referenced `platformId` must exist in the `platforms` table.
- **Query length** — Queries must be between 3 and 500 characters.
- **Mention/position consistency** — If `mentioned` is `0`, `position` must be `null`.
- **Sentiment values** — Must be one of `positive`, `neutral`, or `negative`.

Validation errors are returned as structured objects with a `field` and `message` so callers can surface them precisely. Records that fail validation are rejected and never written to the database.

### 3. Quality Metrics (`server/data-quality.ts`)

The quality module computes a composite score (0–100) for each business's data. The score reflects how complete, fresh, and consistent the data is. It is used by the dashboard to surface data health warnings and by the archival module to prioritise retention.

**Scoring dimensions:**

| Dimension        | Weight | Description |
|------------------|--------|-------------|
| Completeness     | 30%    | Percentage of records with all optional fields populated (position, sentiment, response text) |
| Freshness        | 25%    | How recently data was collected; scores decay linearly over 30 days |
| Coverage         | 20%    | Number of distinct platforms with data in the last 30 days (max 6) |
| Consistency      | 15%    | Ratio of records where mention/position values are internally consistent |
| Volume           | 10%    | Whether the business has a statistically meaningful number of records (≥ 30) |

A score of **80+** is considered healthy. Scores between **50–79** indicate gaps that should be addressed. Scores below **50** suggest the data is stale or incomplete and may not reliably reflect the business's actual AI visibility.

### 4. Archival (`server/data-archival.ts`)

The archival module manages the lifecycle of older records to keep the database performant and the Railway volume within its storage allocation.

**Retention policy:**

| Record type      | Active retention | Archive after | Delete after |
|------------------|-----------------|---------------|--------------|
| `search_records` | 90 days         | 90 days       | 365 days     |
| `ai_snapshots`   | 60 days         | 60 days       | 180 days     |
| `referrals`      | 90 days         | 90 days       | 365 days     |
| `api_usage`      | 30 days         | —             | 30 days      |

Archived records are moved to `*_archive` shadow tables within the same SQLite database. They remain queryable for historical reporting but are excluded from all live dashboard queries.

### 5. Deduplication (`server/data-archival.ts`)

Duplicate records arise when a scan is re-run on the same day or when manual log entries overlap with automated scans. The deduplication routine identifies duplicates by matching on `(businessId, platformId, query, date)` and retains the record with the highest data completeness (non-null position and response text preferred). Duplicates are hard-deleted.

---

## How Data Moves Through the System

```
1. Admin triggers POST /api/businesses/:id/scan
2. Budget check: current daily spend + estimated scan cost ≤ daily budget
3. ScanJob created with status = "running"
4. For each query × provider:
   a. Call AI provider API
   b. Validate result via data-validation.ts
   c. Write search_record to DB
   d. Write ai_snapshot to DB (if response text present)
   e. Write api_usage cost record
   f. Update scan_job.completed_queries
5. ScanJob updated to status = "completed" or "failed"
6. Quality score recomputed for the business (async)
7. Nightly cron: archival-run moves old records to archive tables
8. Weekly cron: deduplicate removes duplicate records
```

---

## Quality Scoring Methodology

Quality scores are computed on demand via `GET /api/data-quality/:businessId` and cached for 5 minutes. The score is a weighted average of the five dimensions described above.

**Example calculation for a business with 45 records over 14 days across 3 platforms:**

- Completeness: 38/45 records fully populated → 84% → 25.2 pts
- Freshness: last scan 2 days ago → 93% → 23.3 pts
- Coverage: 3/6 platforms → 50% → 10.0 pts
- Consistency: 44/45 consistent → 98% → 14.7 pts
- Volume: 45 ≥ 30 → 100% → 10.0 pts
- **Total: 83.2 / 100**

---

## Retention Policies

Retention is enforced by the archival cron job. The policy is intentionally conservative — data is archived (not deleted) first, giving a recovery window before permanent deletion.

To adjust retention periods, modify the constants in `server/data-archival.ts`. Changes take effect on the next archival run.

---

## Performance Considerations

- **SQLite WAL mode** is enabled at startup (`PRAGMA journal_mode = WAL`), which allows concurrent reads during writes and significantly improves scan throughput.
- **Scan concurrency** — The scan engine processes queries sequentially (one provider at a time per query) to avoid rate-limit errors. For businesses with many queries and multiple providers, scans can take 30–120 seconds.
- **Daily budget enforcement** — The budget check happens before the scan starts, not mid-scan. If a scan would exceed the budget, it is rejected entirely rather than partially executed.
- **Archive tables** — Keeping archived records in the same SQLite file avoids cross-file joins but means the database file grows over time. Monitor volume usage via `GET /api/usage/today` and the Railway volume dashboard.
- **Index recommendations** — The most frequently queried columns are `business_id` and `date`. If query performance degrades as the database grows, add composite indexes on `(business_id, date)` for `search_records`, `ai_snapshots`, and `referrals`.
