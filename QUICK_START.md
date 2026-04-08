# Quick Start — Worth Tracking

Get the AI search visibility pipeline running in under 5 minutes.

---

## Prerequisites

- A [Railway](https://railway.app) account
- At least one AI API key (OpenAI, Anthropic, Google, or Perplexity)
- `curl` and `jq` installed locally (for the setup scripts)

---

## Step 1 — Deploy to Railway

### Option A: One-click deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

### Option B: From this repository

```bash
# Install the Railway CLI
npm install -g @railway/cli

# Log in and link your project
railway login
railway init
railway up
```

---

## Step 2 — Add a persistent volume

The app stores its SQLite database at `$DATA_DIR/data.db`. Without a volume the database resets on every deploy.

1. In the Railway dashboard, open your service → **Volumes**
2. Click **+ Add Volume**
3. Set the mount path to `/data`
4. Railway automatically sets `DATA_DIR=/data`

---

## Step 3 — Configure environment variables

Copy `.env.example` and review the values, then set them in Railway:

**Railway dashboard → Service → Variables**

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATA_DIR` | ✅ | `/data` | Path to the mounted volume |
| `NODE_ENV` | ✅ | `production` | Runtime environment |
| `PORT` | — | `5000` | Server port (Railway sets this automatically) |
| `RETENTION_DAYS_SEARCH` | — | `90` | Days before search records are archived |
| `RETENTION_DAYS_SNAPSHOTS` | — | `60` | Days before AI snapshots are archived |
| `RETENTION_DAYS_REFERRALS` | — | `180` | Days before referral records are archived |
| `DAILY_BUDGET` | — | `10.00` | Max USD spend per day across all AI providers |
| `AUTO_PAUSE_ENABLED` | — | `true` | Block scans when daily budget is reached |

> **Tip:** You can also change `DAILY_BUDGET` and `AUTO_PAUSE_ENABLED` at runtime via **Settings → Budget** in the dashboard — no redeploy needed.

---

## Step 4 — Run the one-time setup script

```bash
export BASE_URL=https://your-app.railway.app

bash scripts/setup.sh
```

This script will:
1. Verify the service is reachable
2. Log in as the default admin
3. Report any configured API keys
4. Confirm the database is accessible
5. Print next steps

---

## Step 5 — Add your AI API keys

1. Open the dashboard at your Railway URL
2. Go to **Settings → API Keys**
3. Add keys for the providers you have access to:

| Provider | Where to get a key |
|---|---|
| **OpenAI** (ChatGPT) | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| **Anthropic** (Claude) | [console.anthropic.com](https://console.anthropic.com) |
| **Google** (Gemini) | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Perplexity** | [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api) |

4. Click **Test** next to each key to verify connectivity before running scans.

---

## Step 6 — Add your first business

1. Click **+ Add Business** in the dashboard
2. Fill in the business name, industry, website, and location
3. Click **Save** — demo data is generated automatically so you can explore the UI immediately

---

## Step 7 — Schedule nightly scans (optional)

```bash
export BASE_URL=https://your-app.railway.app
export RAILWAY_PROJECT_ID=your-project-id   # from the Railway dashboard URL

bash scripts/init-cron.sh
```

This prints the exact cron command to paste into Railway's **New → Cron Job** dialog. The default schedule is `0 2 * * *` (02:00 UTC nightly).

---

## Verify it works

### Run a manual scan

1. Open the dashboard → select your business
2. Click **Run Scan**
3. Watch the mention rate and platform breakdown update in real time

### Run the health check

```bash
export BASE_URL=https://your-app.railway.app

bash scripts/health-check.sh
```

A healthy output looks like:

```
[OK]    Service is responding (HTTP 200).
[OK]    2 API key(s) configured.
[OK]    Database is reachable. 1 business(es) found.
[OK]    Mention rate is healthy.
[OK]    Budget usage is within normal range (12%).

  All checks passed — pipeline is healthy.
```

---

## Default credentials

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `worthcreative2026` |

**Change the password immediately** after first login: **Settings → Admin → Change Password**.

---

## Next steps

- **Add competitors** — track how rivals appear across AI platforms
- **Review content gaps** — see which queries you should rank for but don't
- **Set up alerts** — get notified when your mention rate drops
- **Export data** — download CSV reports for any business from the dashboard
- **Custom domain** — add your domain in Railway → Settings → Domains

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Database resets on deploy | Ensure a volume is mounted at `/data` and `DATA_DIR=/data` is set |
| Scans return no results | Check API keys are valid — use the **Test** button on the API Keys page |
| Budget exceeded immediately | Increase `DAILY_BUDGET` or disable `AUTO_PAUSE_ENABLED` in Settings → Budget |
| Can't log in | Default credentials are `admin` / `worthcreative2026` — check `ADMIN_PASS` if using scripts |
| Service not reachable | Confirm the Railway deploy succeeded and the volume is attached |

For more detail see the full [README](./README.md).
