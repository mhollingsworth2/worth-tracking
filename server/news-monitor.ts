/**
 * News Monitor — fetches recent news mentions via NewsAPI.
 *
 * Requires a NEWS_API_KEY environment variable (free tier available at
 * https://newsapi.org).  Degrades gracefully when the key is absent.
 */

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  summary: string;
}

export interface NewsResult {
  items: NewsItem[];
  queriesUsed: string[];
  error?: string;
}

async function fetchNews(
  query: string,
  apiKey: string,
  pageSize = 5
): Promise<NewsItem[]> {
  const params = new URLSearchParams({
    q: query,
    apiKey,
    pageSize: String(pageSize),
    sortBy: "publishedAt",
    language: "en",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?${params.toString()}`,
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error(`NewsAPI HTTP ${res.status}`);
    const data = (await res.json()) as any;

    if (data.status !== "ok") {
      throw new Error(data.message ?? "NewsAPI error");
    }

    return (data.articles ?? []).map((a: any) => ({
      title: a.title ?? "",
      source: a.source?.name ?? "Unknown",
      url: a.url ?? "",
      publishedAt: a.publishedAt ?? new Date().toISOString(),
      summary: a.description ?? "",
    }));
  } finally {
    clearTimeout(timer);
  }
}

export async function monitorNews(
  businessName: string,
  industry: string,
  newsApiKey?: string
): Promise<NewsResult> {
  const key = newsApiKey ?? process.env.NEWS_API_KEY;
  if (!key) {
    return {
      items: [],
      queriesUsed: [],
      error:
        "NEWS_API_KEY not configured. Add it in API Keys or set the NEWS_API_KEY environment variable.",
    };
  }

  const queries = [
    `"${businessName}"`,
    `"${businessName}" ${industry}`,
  ];

  const seen = new Set<string>();
  const items: NewsItem[] = [];

  for (const query of queries) {
    try {
      const results = await fetchNews(query, key, 5);
      for (const item of results) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        items.push(item);
        if (items.length >= 5) break;
      }
    } catch (err: any) {
      console.warn(`[news-monitor] Query "${query}" failed:`, err.message);
    }
    if (items.length >= 5) break;
  }

  // Sort newest first
  items.sort(
    (a, b) =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return { items: items.slice(0, 5), queriesUsed: queries };
}
