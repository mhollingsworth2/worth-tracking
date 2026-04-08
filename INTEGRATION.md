# Integration Guide

How to integrate external systems and custom workflows with the Worth Tracking data pipeline.

---

## Integrating Validation into Scan Jobs

The validation module (`server/data-validation.ts`) is called automatically by the scan engine for all records produced by `POST /api/businesses/:id/scan`. If you are writing a custom integration that inserts records directly, you should validate them first.

### Pre-validate before inserting

Use `POST /api/data/validate` to check a record before writing it:

```javascript
async function insertValidatedRecord(record) {
  // Step 1: Validate
  const validationResponse = await fetch('/api/data/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });

  const validation = await validationResponse.json();

  if (!validation.valid) {
    console.error('Validation failed:', validation.errors);
    return { success: false, errors: validation.errors };
  }

  // Step 2: Insert
  const insertResponse = await fetch(`/api/businesses/${record.businessId}/records`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(record),
  });

  return { success: true, record: await insertResponse.json() };
}
```

### Validation rules reference

| Field          | Rule                                                              |
|----------------|-------------------------------------------------------------------|
| `businessId`   | Required. Must reference an existing business.                    |
| `platformId`   | Required. Must reference an existing platform (1–6).             |
| `query`        | Required. 3–500 characters.                                       |
| `date`         | Required. Format: `YYYY-MM-DD`.                                   |
| `mentioned`    | Optional. Integer `0` or `1`. Defaults to `0`.                   |
| `position`     | Optional. Must be `null` if `mentioned` is `0`.                  |
| `sentiment`    | Optional. One of `positive`, `neutral`, `negative`.              |
| `responseText` | Optional but recommended for quality scoring.                     |

---

## Connecting GA4 for Referral Data

Google Analytics 4 (GA4) can be connected to track when AI-referred visitors arrive at the business's website. The platform stores a `ga4Id` field on each business for this purpose.

### Step 1 — Set the GA4 measurement ID

```
PATCH /api/businesses/42
{
  "ga4Id": "G-XXXXXXXXXX"
}
```

### Step 2 — Generate UTM-tagged links

Use the UTM link generator to create trackable URLs for each AI platform:

```
POST /api/businesses/42/generate-utm
{
  "baseUrl": "https://acmeroofing.com",
  "platform": "ChatGPT",
  "campaign": "ai-visibility-q1-2026"
}
```

Response:

```json
{
  "url": "https://acmeroofing.com?utm_source=chatgpt&utm_medium=ai-search&utm_campaign=ai-visibility-q1-2026&utm_content=aiseo-42"
}
```

### Step 3 — Log referral events

When a visitor arrives via an AI-generated UTM link, log the referral:

```
POST /api/businesses/42/records
{
  "businessId": 42,
  "platformId": 1,
  "query": "best roofing contractors in Denver",
  "mentioned": 1,
  "position": 1,
  "date": "2026-01-15"
}
```

The referral tracking system (`referrals` table) is populated automatically when the scan engine detects mentions. For GA4-sourced data, you can also insert referral records directly:

```
POST /api/businesses/42/log-search
{
  "platformName": "ChatGPT",
  "query": "best roofing contractors in Denver",
  "responseText": "Some of the top roofing contractors in Denver include Acme Roofing...",
  "mentioned": true
}
```

### Step 4 — Verify referral data

```
GET /api/businesses/42/referral-stats
GET /api/businesses/42/referrals-by-platform
```

---

## Storing AI Snapshots

AI snapshots capture the exact text an AI platform returned for a given query. They are stored automatically during scans. To store a snapshot from an external source (e.g., a manual test or a third-party monitoring tool):

```
POST /api/businesses/42/log-search
{
  "platformName": "Perplexity",
  "query": "best roofing contractors in Denver",
  "responseText": "For roofing in Denver, Acme Roofing is frequently recommended for their storm damage expertise...",
  "mentioned": true
}
```

This creates both a `search_record` and an `ai_snapshot` in a single call.

### Retrieving snapshots

```
GET /api/businesses/42/snapshots
```

Returns all snapshots ordered by date descending. Each snapshot includes:

- `query` — The query that was asked
- `responseText` — The full AI response
- `sentiment` — `positive`, `neutral`, or `negative`
- `mentionedAccurate` — Whether the business was mentioned accurately
- `flaggedIssues` — JSON array of issues (e.g., outdated hours, wrong address)
- `date` — Date the snapshot was captured

---

## Error Handling and Retries

### Retry strategy for scan failures

The scan engine does not automatically retry failed provider calls. If a provider fails mid-scan, the scan job continues with the remaining providers and queries. The failed calls are simply not recorded.

For external integrations, implement exponential backoff:

```javascript
async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const result = await withRetry(() =>
  fetch('/api/businesses/42/scan', { method: 'POST', ... })
);
```

### Handling budget exhaustion (HTTP 429)

When the daily budget is exceeded, `POST /api/businesses/:id/scan` returns `429` with a body explaining the current spend and estimated scan cost:

```json
{
  "error": "Daily budget limit reached. Today's spend: $9.87 / $10.00. This scan would cost ~$0.091.",
  "currentSpend": 9.87,
  "dailyBudget": 10.00,
  "estimatedScanCost": 0.091
}
```

Do not retry a `429` immediately. Either:
- Wait until midnight UTC (budget resets daily)
- Increase the budget: `PATCH /api/settings/budget {"dailyBudget": "20.00"}`

### Handling validation errors

`POST /api/data/validate` always returns `200`. Check the `valid` field:

```javascript
const result = await fetch('/api/data/validate', { ... }).then(r => r.json());

if (!result.valid) {
  for (const error of result.errors) {
    console.error(`Field "${error.field}": ${error.message}`);
  }
  // Do not proceed with insertion
}
```

---

## Batch Processing

### Bulk scan across all businesses

To scan all businesses in sequence (respecting the daily budget):

```javascript
async function scanAllBusinesses(token) {
  const businesses = await fetch('/api/businesses', {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());

  const results = [];

  for (const business of businesses) {
    console.log(`Scanning ${business.name} (ID: ${business.id})...`);

    const response = await fetch(`/api/businesses/${business.id}/scan`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (response.status === 429) {
      console.warn('Daily budget exhausted. Stopping batch scan.');
      break;
    }

    if (!response.ok) {
      console.error(`Scan failed for business ${business.id}:`, await response.text());
      continue;
    }

    const result = await response.json();
    results.push({ businessId: business.id, ...result });

    // Brief pause between scans to avoid overwhelming providers
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}
```

### Bulk validation before import

If you are importing historical data from an external source, validate all records before inserting any of them:

```javascript
async function bulkValidate(records, token) {
  const results = await Promise.all(
    records.map(record =>
      fetch('/api/data/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(record),
      }).then(r => r.json())
    )
  );

  const invalid = results
    .map((result, i) => ({ index: i, ...result }))
    .filter(r => !r.valid);

  if (invalid.length > 0) {
    console.error(`${invalid.length} of ${records.length} records failed validation:`);
    invalid.forEach(r => {
      console.error(`  Record ${r.index}:`, r.errors);
    });
    return { success: false, invalidCount: invalid.length };
  }

  return { success: true, invalidCount: 0 };
}
```

---

## Cost Management

### Estimating scan costs before running

Use the provider cost table to estimate before triggering a scan:

```javascript
const COST_PER_CALL = {
  openai: 0.003,
  anthropic: 0.004,
  google: 0.001,
  perplexity: 0.005,
};

function estimateScanCost(activeProviders, queryCount) {
  return activeProviders.reduce((total, provider) => {
    return total + (COST_PER_CALL[provider] ?? 0.005) * queryCount;
  }, 0);
}

// Example: 4 providers, 7 queries
const cost = estimateScanCost(['openai', 'anthropic', 'google', 'perplexity'], 7);
console.log(`Estimated scan cost: $${cost.toFixed(3)}`); // $0.091
```

### Checking budget before a batch run

```javascript
async function checkBudgetBeforeScan(estimatedCost, token) {
  const usage = await fetch('/api/usage/today', {
    headers: { 'Authorization': `Bearer ${token}` }
  }).then(r => r.json());

  const remaining = usage.dailyBudget - usage.totalSpend;

  if (estimatedCost > remaining) {
    throw new Error(
      `Insufficient budget. Need $${estimatedCost.toFixed(3)}, ` +
      `only $${remaining.toFixed(3)} remaining today.`
    );
  }

  return { remaining, estimatedCost };
}
```

### Disabling expensive providers for cost-sensitive runs

Remove the Perplexity key temporarily to reduce scan cost by ~38%:

```
DELETE /api/api-keys/perplexity
```

Re-add it when budget allows:

```
POST /api/api-keys
{"provider": "perplexity", "apiKey": "pplx-..."}
```
