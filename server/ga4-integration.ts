/**
 * GA4 Integration — connects to Google Analytics Data API to pull traffic,
 * referral, and conversion data attributed to AI search platforms.
 *
 * Credentials are stored per-business in the automation_settings table.
 * The GA4 Data API requires a service-account JSON key or an API key with
 * the Analytics Data API enabled.
 */

export interface GA4TrafficRow {
  date: string;
  source: string;
  medium: string;
  campaign: string;
  sessions: number;
  conversions: number;
  avgSessionDuration: number;
  landingPage: string;
}

export interface GA4Result {
  rows: GA4TrafficRow[];
  dateRange: string;
  propertyId: string;
  error?: string;
}

// AI search platform UTM sources we care about
const AI_SOURCES = [
  "chatgpt", "perplexity", "gemini", "claude", "copilot",
  "meta-ai", "bard", "bing-chat", "you.com", "phind",
];

async function callGA4Api(
  propertyId: string,
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<any> {
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport?key=${apiKey}`;

  const body = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: "date" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
      { name: "sessionCampaignName" },
      { name: "landingPage" },
    ],
    metrics: [
      { name: "sessions" },
      { name: "conversions" },
      { name: "averageSessionDuration" },
    ],
    dimensionFilter: {
      orGroup: {
        expressions: AI_SOURCES.map((src) => ({
          filter: {
            fieldName: "sessionSource",
            stringFilter: { matchType: "CONTAINS", value: src },
          },
        })),
      },
    },
    limit: 1000,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GA4 API HTTP ${res.status}: ${errText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseDateRange(dateRange: string): { startDate: string; endDate: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];

  switch (dateRange) {
    case "7d": {
      const start = new Date(today);
      start.setDate(today.getDate() - 7);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case "30d": {
      const start = new Date(today);
      start.setDate(today.getDate() - 30);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    case "90d": {
      const start = new Date(today);
      start.setDate(today.getDate() - 90);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
    default: {
      // Treat as "YYYY-MM-DD/YYYY-MM-DD"
      const parts = dateRange.split("/");
      if (parts.length === 2) return { startDate: parts[0], endDate: parts[1] };
      const start = new Date(today);
      start.setDate(today.getDate() - 30);
      return { startDate: fmt(start), endDate: fmt(today) };
    }
  }
}

export async function fetchGA4Data(
  propertyId: string,
  apiKey: string,
  dateRange = "30d"
): Promise<GA4Result> {
  if (!propertyId || !apiKey) {
    return {
      rows: [],
      dateRange,
      propertyId: propertyId ?? "",
      error: "GA4 property ID and API key are required.",
    };
  }

  const { startDate, endDate } = parseDateRange(dateRange);

  try {
    const data = await callGA4Api(propertyId, apiKey, startDate, endDate);

    const rows: GA4TrafficRow[] = (data.rows ?? []).map((row: any) => {
      const dims = row.dimensionValues ?? [];
      const mets = row.metricValues ?? [];
      return {
        date: dims[0]?.value ?? "",
        source: dims[1]?.value ?? "",
        medium: dims[2]?.value ?? "",
        campaign: dims[3]?.value ?? "",
        landingPage: dims[4]?.value ?? "",
        sessions: parseInt(mets[0]?.value ?? "0", 10),
        conversions: parseInt(mets[1]?.value ?? "0", 10),
        avgSessionDuration: parseFloat(mets[2]?.value ?? "0"),
      };
    });

    return { rows, dateRange: `${startDate}/${endDate}`, propertyId };
  } catch (err: any) {
    return {
      rows: [],
      dateRange: `${startDate}/${endDate}`,
      propertyId,
      error: err.message ?? "GA4 fetch failed",
    };
  }
}
