# Worth Tracking — AI Search Visibility Platform

Track how any business appears across AI search platforms like ChatGPT, Perplexity, Gemini, Claude, Copilot, and Meta AI.

Built by [Worth Creative LLC](https://worthcreative.com).

## Features

- **AI Search Monitoring** — Track mentions across 6 AI platforms with real API connections
- **Referral Tracking** — See when AI mentions lead to actual website visits and conversions
- **Competitor Analysis** — Compare your visibility against competitors
- **AI Response Snapshots** — See exactly what AI platforms say about your business
- **Content Gap Analysis** — Find queries where you should appear but don't
- **Prompt Optimizer** — Score your business description for AI visibility
- **Alerts & Notifications** — Get notified about visibility changes
- **Multi-Location Support** — Track multiple business locations
- **CSV Export** — Download any data for reporting
- **UTM Link Generator** — Create tracked URLs for AI-referred traffic
- **User Authentication** — Admin + up to 5 customer logins
- **API Budget Tracking** — Monitor daily API spend with auto-pause

## Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template)

1. Click the button above (or go to [railway.app](https://railway.app))
2. Connect your GitHub account
3. Create a new project from this repository
4. Railway auto-detects the config and deploys
5. Add a volume mounted at `/data` for persistent database storage
6. Your app is live at the Railway-provided URL

### Add a Custom Domain

1. In Railway dashboard → Settings → Domains
2. Add your domain (e.g., `tracking.worthcreative.com`)
3. Add the CNAME record Railway provides to your DNS
4. SSL is automatic

## Local Development

```bash
npm install
npm run dev
```

The app runs at `http://localhost:5000`.

## Default Admin Login

- **Username:** `admin`
- **Password:** `worthcreative2026`

Change this immediately after first login.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `NODE_ENV` | `development` | Set to `production` for deploys |
| `DATA_DIR` | `.` | Directory for SQLite database file |

## Tech Stack

- **Frontend:** React, Tailwind CSS, shadcn/ui, Recharts
- **Backend:** Express.js, Drizzle ORM, SQLite
- **Auth:** Session-based with HTTP-only cookies
- **Fonts:** Cormorant Garamond + Jost
