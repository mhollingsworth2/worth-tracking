/**
 * Pricing Monitor — scrapes competitor websites for pricing information.
 *
 * Uses the same lightweight fetch + regex approach as the website scraper.
 * Results are cached per URL for 24 hours.
 */

export interface PricingTier {
  name: string;
  price: string;
  period: string; // "month", "year", "one-time", "hour", etc.
  features: string[];
}

export interface CompetitorPricingResult {
  competitorName: string;
  website: string;
  pricingPageUrl: string | null;
  tiers: PricingTier[];
  rawPrices: string[];
  scrapedAt: string;
  error?: string;
}

// ── Cache ─────────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const pricingCache = new Map<string, { result: CompetitorPricingResult; cachedAt: number }>();

function getCached(url: string): CompetitorPricingResult | null {
  const entry = pricingCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    pricingCache.delete(url);
    return null;
  }
  return entry.result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WorthTrackingBot/1.0; +https://worthtracking.com)",
        Accept: "text/html",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Find a pricing page URL from the homepage HTML. */
function findPricingPageUrl(baseUrl: string, html: string): string | null {
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2]).toLowerCase();
    if (
      /pric(e|ing)|plans?|packages?|cost|rates?/i.test(href) ||
      /pric(e|ing)|plans?|packages?|cost|rates?/i.test(text)
    ) {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/** Extract price strings like $99, $1,299/mo, £49/month, €199/year */
const PRICE_RE =
  /(?:[$£€¥])\s*[\d,]+(?:\.\d{1,2})?(?:\s*\/\s*(?:mo(?:nth)?|yr|year|week|hour|hr|project|one[- ]time))?/gi;

function extractRawPrices(text: string): string[] {
  const matches = text.match(PRICE_RE) ?? [];
  return [...new Set(matches.map((p) => p.trim()))].slice(0, 20);
}

/** Very simple tier extraction: look for pricing card-like patterns. */
function extractTiers(html: string): PricingTier[] {
  const tiers: PricingTier[] = [];

  // Look for common pricing card patterns: heading + price in close proximity
  const cardRe =
    /<(?:div|section|article|li)[^>]*class=["'][^"']*(?:pric|plan|tier|package)[^"']*["'][^>]*>([\s\S]{20,800}?)<\/(?:div|section|article|li)>/gi;

  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null && tiers.length < 6) {
    const block = m[1];
    const text = stripHtml(block);

    const prices = text.match(PRICE_RE);
    if (!prices) continue;

    // Try to extract a tier name from the first heading-like text
    const nameMatch = block.match(/<h[1-6][^>]*>([^<]{2,40})<\/h[1-6]>/i);
    const name = nameMatch ? stripHtml(nameMatch[1]).trim() : `Plan ${tiers.length + 1}`;

    // Period detection
    let period = "month";
    if (/year|annual|yr/i.test(text)) period = "year";
    else if (/one[- ]time|once|lifetime/i.test(text)) period = "one-time";
    else if (/hour|hr/i.test(text)) period = "hour";
    else if (/week/i.test(text)) period = "week";

    // Feature bullets
    const featureRe = /<li[^>]*>([^<]{5,100})<\/li>/gi;
    const features: string[] = [];
    let fm: RegExpExecArray | null;
    while ((fm = featureRe.exec(block)) !== null && features.length < 6) {
      features.push(stripHtml(fm[1]).trim());
    }

    tiers.push({ name, price: prices[0], period, features });
  }

  return tiers;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function monitorCompetitorPricing(
  competitors: Array<{ name: string; website: string }>
): Promise<CompetitorPricingResult[]> {
  const results: CompetitorPricingResult[] = [];

  for (const comp of competitors) {
    if (!comp.website) {
      results.push({
        competitorName: comp.name,
        website: comp.website,
        pricingPageUrl: null,
        tiers: [],
        rawPrices: [],
        scrapedAt: new Date().toISOString(),
        error: "No website URL provided",
      });
      continue;
    }

    let url = comp.website.trim();
    if (!url.startsWith("http")) url = `https://${url}`;

    const cached = getCached(url);
    if (cached) {
      results.push(cached);
      continue;
    }

    try {
      // 1. Fetch homepage to find pricing page link
      const homeHtml = await fetchWithTimeout(url);
      const pricingUrl = findPricingPageUrl(url, homeHtml);

      // 2. Fetch pricing page (or fall back to homepage)
      const targetUrl = pricingUrl ?? url;
      const pricingHtml = pricingUrl ? await fetchWithTimeout(pricingUrl) : homeHtml;
      const pricingText = stripHtml(pricingHtml);

      const rawPrices = extractRawPrices(pricingText);
      const tiers = extractTiers(pricingHtml);

      const result: CompetitorPricingResult = {
        competitorName: comp.name,
        website: url,
        pricingPageUrl: pricingUrl,
        tiers,
        rawPrices,
        scrapedAt: new Date().toISOString(),
      };

      pricingCache.set(url, { result, cachedAt: Date.now() });
      results.push(result);
    } catch (err: any) {
      results.push({
        competitorName: comp.name,
        website: url,
        pricingPageUrl: null,
        tiers: [],
        rawPrices: [],
        scrapedAt: new Date().toISOString(),
        error: err.message ?? "Scrape failed",
      });
    }
  }

  return results;
}
