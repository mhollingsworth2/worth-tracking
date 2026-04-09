/**
 * Website Scraper — extracts business profile data from a public website.
 *
 * Uses the built-in fetch API + lightweight regex/string parsing so we don't
 * need a headless browser.  Results are cached in-memory for 24 hours to
 * avoid hammering the same site on repeated calls.
 */

export interface ContentItem {
  title: string;
  url: string;
  publishDate?: string;
}

export interface ScrapeResult {
  serviceCategories: string[];
  targetAudience: string[];
  keyDifferentiators: string[];
  websiteContentSummary: string;
  contentInventory: ContentItem[];
  keywords: string[];
  serviceAreas: string[];
  error?: string;
}

// ── In-memory cache ──────────────────────────────────────────────────────────
interface CacheEntry {
  result: ScrapeResult;
  cachedAt: number; // epoch ms
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const scrapeCache = new Map<string, CacheEntry>();

function getCached(url: string): ScrapeResult | null {
  const entry = scrapeCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    scrapeCache.delete(url);
    return null;
  }
  return entry.result;
}

function setCache(url: string, result: ScrapeResult): void {
  scrapeCache.set(url, { result, cachedAt: Date.now() });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

/** Strip all HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Extract all values of a given attribute from matching tags. */
function extractAttr(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/** Extract inner text of all matching tags. */
function extractTagText(html: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].trim();
    if (text.length > 1) results.push(text);
  }
  return results;
}

/** Extract href + anchor text from <a> tags. */
function extractLinks(html: string): Array<{ href: string; text: string }> {
  const re = /<a[^>]+href=["']([^"'#?][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results: Array<{ href: string; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1].trim();
    const text = stripHtml(m[2]).trim();
    if (href && text.length > 1 && text.length < 120) {
      results.push({ href, text });
    }
  }
  return results;
}

/** Resolve a relative URL against a base. */
function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// ── Fetch with timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WorthTrackingBot/1.0; +https://worthtracking.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ── Keyword extraction ───────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","shall","can",
  "not","no","nor","so","yet","both","either","neither","each","few","more",
  "most","other","some","such","than","then","that","this","these","those",
  "we","our","us","you","your","they","their","it","its","he","she","him",
  "her","i","me","my","who","which","what","when","where","how","why","all",
  "any","every","just","also","about","up","out","if","as","into","through",
  "during","before","after","above","below","between","same","different",
]);

function extractKeywords(text: string, topN = 30): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

// ── Service area detection ───────────────────────────────────────────────────

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
];

function detectServiceAreas(text: string): string[] {
  const areas: Set<string> = new Set();

  // Look for explicit "service area" / "we serve" sections
  const serviceAreaMatch = text.match(
    /(?:service\s+area|areas?\s+(?:we\s+)?serve|serving|coverage\s+area)[:\s]+([^.!?\n]{10,200})/gi
  );
  if (serviceAreaMatch) {
    for (const m of serviceAreaMatch) {
      const parts = m.split(/[,;|•·\n]+/);
      for (const p of parts) {
        const clean = p.replace(/service\s+area[s]?[:\s]*/i, "").trim();
        if (clean.length > 2 && clean.length < 60) areas.add(clean);
      }
    }
  }

  // Match US state names
  for (const state of US_STATES) {
    if (new RegExp(`\\b${state}\\b`, "i").test(text)) {
      areas.add(state);
    }
  }

  // Match "City, ST" patterns
  const cityStateRe = /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*),\s*([A-Z]{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = cityStateRe.exec(text)) !== null) {
    areas.add(`${m[1]}, ${m[2]}`);
  }

  return [...areas].slice(0, 20);
}

// ── Blog / content inventory ─────────────────────────────────────────────────

const BLOG_PATH_PATTERNS = [
  /\/blog\//i, /\/news\//i, /\/articles?\//i, /\/insights?\//i,
  /\/resources?\//i, /\/case-studies?\//i, /\/whitepapers?\//i,
  /\/guides?\//i, /\/posts?\//i, /\/updates?\//i,
];

function isBlogLink(href: string): boolean {
  return BLOG_PATH_PATTERNS.some((re) => re.test(href));
}

function extractDateFromUrl(url: string): string | undefined {
  const m = url.match(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return undefined;
}

// ── Main scraper ─────────────────────────────────────────────────────────────

export async function scrapeWebsite(rawUrl: string): Promise<ScrapeResult> {
  // Normalise URL
  let url = rawUrl.trim();
  if (!url.startsWith("http")) url = `https://${url}`;

  const cached = getCached(url);
  if (cached) return cached;

  try {
    const html = await fetchWithTimeout(url);
    const text = stripHtml(html);

    // ── Meta keywords ──────────────────────────────────────────────────────
    const metaKeywords: string[] = [];
    const metaKwMatch = html.match(
      /<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i
    );
    if (metaKwMatch) {
      metaKeywords.push(...metaKwMatch[1].split(",").map((k) => k.trim()).filter(Boolean));
    }

    // ── Headings ───────────────────────────────────────────────────────────
    const h1s = extractTagText(html, "h1");
    const h2s = extractTagText(html, "h2");
    const h3s = extractTagText(html, "h3");
    const allHeadings = [...h1s, ...h2s, ...h3s];

    // ── Nav links → service categories ────────────────────────────────────
    const navMatch = html.match(/<nav[\s\S]*?<\/nav>/gi) ?? [];
    const navText = navMatch.map(stripHtml).join(" ");
    const navLinks = extractLinks(navMatch.join(""));

    const SERVICE_KEYWORDS = [
      "service","solution","product","offering","package","plan","feature",
      "capability","expertise","specialt","consult","support","manage",
    ];
    const serviceCategories = navLinks
      .filter((l) =>
        SERVICE_KEYWORDS.some((kw) => l.text.toLowerCase().includes(kw)) ||
        /\/services?\//i.test(l.href)
      )
      .map((l) => l.text)
      .filter((t) => t.length < 60);

    // Also pull from h2/h3 that look like service names
    for (const h of [...h2s, ...h3s]) {
      if (SERVICE_KEYWORDS.some((kw) => h.toLowerCase().includes(kw))) {
        serviceCategories.push(h);
      }
    }

    // ── Target audience ────────────────────────────────────────────────────
    const AUDIENCE_PATTERNS = [
      /(?:for|serving|designed for|built for|ideal for|perfect for)\s+([^.!?\n]{5,80})/gi,
      /(?:our\s+(?:clients?|customers?|partners?|audience))[:\s]+([^.!?\n]{5,80})/gi,
      /(?:who\s+we\s+(?:serve|help|work\s+with))[:\s]+([^.!?\n]{5,80})/gi,
    ];
    const targetAudience: string[] = [];
    for (const re of AUDIENCE_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const val = m[1].trim();
        if (val.length > 4 && val.length < 80) targetAudience.push(val);
      }
    }

    // ── Key differentiators ────────────────────────────────────────────────
    const DIFF_PATTERNS = [
      /(?:why\s+choose\s+us|what\s+sets\s+us\s+apart|our\s+(?:advantage|difference|unique|mission|promise|commitment))[:\s]+([^.!?\n]{10,120})/gi,
      /(?:trusted\s+by|award[- ]winning|#1|number\s+one|leading|top-rated)[^.!?\n]{0,80}/gi,
    ];
    const keyDifferentiators: string[] = [];
    for (const re of DIFF_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const val = m[0].trim();
        if (val.length > 8 && val.length < 120) keyDifferentiators.push(val);
      }
    }

    // ── Content inventory (blog posts, case studies, etc.) ─────────────────
    const allLinks = extractLinks(html);
    const contentInventory: ContentItem[] = allLinks
      .filter((l) => isBlogLink(resolveUrl(url, l.href)))
      .map((l) => ({
        title: l.text,
        url: resolveUrl(url, l.href),
        publishDate: extractDateFromUrl(l.href),
      }))
      .filter((item, idx, arr) => arr.findIndex((x) => x.url === item.url) === idx) // dedupe
      .slice(0, 30);

    // ── Service areas ──────────────────────────────────────────────────────
    const serviceAreas = detectServiceAreas(text);

    // ── Keywords ──────────────────────────────────────────────────────────
    const bodyKeywords = extractKeywords(text);
    const headingKeywords = extractKeywords(allHeadings.join(" "), 15);
    const keywords = [
      ...new Set([...metaKeywords, ...headingKeywords, ...bodyKeywords]),
    ].slice(0, 40);

    // ── Summary ───────────────────────────────────────────────────────────
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const metaDescMatch = html.match(
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    );
    const websiteContentSummary = [
      titleMatch ? `Title: ${titleMatch[1].trim()}` : "",
      metaDescMatch ? `Description: ${metaDescMatch[1].trim()}` : "",
      h1s.length ? `H1: ${h1s.slice(0, 3).join(" | ")}` : "",
      `Pages found: ${allLinks.length} links`,
      contentInventory.length ? `Content items: ${contentInventory.length}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const result: ScrapeResult = {
      serviceCategories: [...new Set(serviceCategories)].slice(0, 15),
      targetAudience: [...new Set(targetAudience)].slice(0, 10),
      keyDifferentiators: [...new Set(keyDifferentiators)].slice(0, 10),
      websiteContentSummary,
      contentInventory,
      keywords,
      serviceAreas,
    };

    setCache(url, result);
    return result;
  } catch (err: any) {
    const result: ScrapeResult = {
      serviceCategories: [],
      targetAudience: [],
      keyDifferentiators: [],
      websiteContentSummary: "",
      contentInventory: [],
      keywords: [],
      serviceAreas: [],
      error: err.message ?? "Unknown scrape error",
    };
    return result;
  }
}
