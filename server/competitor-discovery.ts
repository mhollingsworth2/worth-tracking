/**
 * Competitor Discovery — finds competitors via SerpAPI (Google Search).
 *
 * Requires a SERPAPI_KEY environment variable.  If the key is absent the
 * function returns an empty list with a descriptive message so the rest of
 * the app degrades gracefully.
 */

export interface DiscoveredCompetitor {
  name: string;
  website: string;
  snippet: string;
}

export interface DiscoveryResult {
  competitors: DiscoveredCompetitor[];
  queriesUsed: string[];
  error?: string;
}

// Domains that are clearly not business competitors (directories, social, etc.)
const EXCLUDED_DOMAINS = new Set([
  "yelp.com","yellowpages.com","bbb.org","angi.com","thumbtack.com",
  "houzz.com","homeadvisor.com","angieslist.com","google.com","facebook.com",
  "instagram.com","twitter.com","linkedin.com","youtube.com","wikipedia.org",
  "reddit.com","nextdoor.com","tripadvisor.com","indeed.com","glassdoor.com",
  "craigslist.org","amazon.com","bing.com","yahoo.com","mapquest.com",
]);

function isExcluded(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return EXCLUDED_DOMAINS.has(hostname);
  } catch {
    return false;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function serpSearch(
  query: string,
  apiKey: string
): Promise<Array<{ title: string; link: string; snippet: string }>> {
  const params = new URLSearchParams({
    q: query,
    api_key: apiKey,
    engine: "google",
    num: "10",
    gl: "us",
    hl: "en",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`https://serpapi.com/search?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`SerpAPI HTTP ${res.status}`);
    const data = (await res.json()) as any;
    return (data.organic_results ?? []).map((r: any) => ({
      title: r.title ?? "",
      link: r.link ?? "",
      snippet: r.snippet ?? "",
    }));
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverCompetitors(
  businessName: string,
  industry: string,
  location: string,
  serpApiKey?: string
): Promise<DiscoveryResult> {
  const key = serpApiKey ?? process.env.SERPAPI_KEY;
  if (!key) {
    return {
      competitors: [],
      queriesUsed: [],
      error:
        "SERPAPI_KEY not configured. Add it in API Keys or set the SERPAPI_KEY environment variable.",
    };
  }

  const queries = [
    `${industry} near ${location}`,
    `${industry} in ${location}`,
    `best ${industry} ${location}`,
  ];

  const seen = new Set<string>();
  const competitors: DiscoveredCompetitor[] = [];

  for (const query of queries) {
    try {
      const results = await serpSearch(query, key);
      for (const r of results) {
        if (!r.link || isExcluded(r.link)) continue;
        const domain = extractDomain(r.link);
        // Skip the business itself
        if (businessName && r.title.toLowerCase().includes(businessName.toLowerCase())) continue;
        if (seen.has(domain)) continue;
        seen.add(domain);
        competitors.push({
          name: r.title.split(" - ")[0].split(" | ")[0].trim(),
          website: r.link,
          snippet: r.snippet,
        });
        if (competitors.length >= 10) break;
      }
    } catch (err: any) {
      console.warn(`[competitor-discovery] Query "${query}" failed:`, err.message);
    }
    if (competitors.length >= 10) break;
  }

  return { competitors, queriesUsed: queries };
}
