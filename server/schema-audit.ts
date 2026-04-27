// Schema markup audit for a business's public website.
//
// Fetches the homepage, extracts JSON-LD <script type="application/ld+json">
// blocks and Microdata/RDFa hints, and scores the coverage against the
// schema types that matter most for AI-SEO discoverability:
//
//   - LocalBusiness / Organization  → entity grounding
//   - FAQPage                        → lifts LLMs extracting direct answers
//   - Review / AggregateRating       → sentiment + trust signals
//   - Service / Offer                → enumerates what the business sells
//   - BreadcrumbList                 → site navigation context
//   - WebSite / SearchAction         → canonical identity
//
// This is informational — it tells the business WHAT structured data is
// missing, not whether the markup is syntactically valid. Deeper linting
// (e.g., Schema.org validator) would be a follow-on.

export interface SchemaAuditResult {
  score: number;                  // 0-100
  foundTypes: string[];           // distinct schema @type values found
  missingRecommended: string[];   // types we recommend they add
  jsonLdCount: number;            // how many <script type="application/ld+json"> blocks
  microdataHints: number;         // rough count of itemtype="..." attributes
  error?: string;                 // fetch/parse error if any
  lastAuditAt: string;            // ISO timestamp
}

// Types we actively recommend every local service business have.
// LocalBusiness or Organization is required; the rest are lifts.
const REQUIRED_TYPES = ["LocalBusiness", "Organization"];
const RECOMMENDED_TYPES = [
  "FAQPage",
  "Review",
  "AggregateRating",
  "Service",
  "BreadcrumbList",
  "WebSite",
];

// Walk a JSON-LD value recursively and collect every @type string seen.
function collectTypes(node: any, out: Set<string>): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out);
    return;
  }
  if (typeof node !== "object") return;

  const t = node["@type"];
  if (typeof t === "string") out.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") out.add(x);

  // Recurse into @graph and other nested objects
  if (node["@graph"]) collectTypes(node["@graph"], out);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (v && typeof v === "object") collectTypes(v, out);
  }
}

export async function auditSchemaMarkup(websiteUrl: string): Promise<SchemaAuditResult> {
  const now = new Date().toISOString();
  const empty: SchemaAuditResult = {
    score: 0,
    foundTypes: [],
    missingRecommended: [...REQUIRED_TYPES.slice(0, 1), ...RECOMMENDED_TYPES],
    jsonLdCount: 0,
    microdataHints: 0,
    lastAuditAt: now,
  };
  if (!websiteUrl || !/^https?:\/\//i.test(websiteUrl)) {
    return { ...empty, error: "no website configured" };
  }

  let html = "";
  try {
    const res = await fetch(websiteUrl, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking-SchemaAudit/1.0)" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
    if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
    html = await res.text();
  } catch (err: any) {
    return { ...empty, error: err?.message ?? "fetch failed" };
  }

  // Extract JSON-LD blocks
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const jsonLdBlocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    jsonLdBlocks.push(m[1].trim());
  }

  const foundSet = new Set<string>();
  for (const block of jsonLdBlocks) {
    try {
      const parsed = JSON.parse(block);
      collectTypes(parsed, foundSet);
    } catch {
      // Some sites embed slightly-malformed JSON-LD; try a trailing-comma cleanup
      try {
        const cleaned = block.replace(/,\s*([\]}])/g, "$1");
        const parsed = JSON.parse(cleaned);
        collectTypes(parsed, foundSet);
      } catch {
        /* skip malformed block */
      }
    }
  }

  // Microdata/RDFa hint count — we don't parse these, just flag presence
  const itemtypeMatches = html.match(/itemtype\s*=\s*["']https?:\/\/schema\.org\/[A-Za-z]+["']/gi) ?? [];
  const microdataHints = itemtypeMatches.length;

  // Merge microdata types into foundSet too
  for (const match of itemtypeMatches) {
    const typeMatch = match.match(/schema\.org\/([A-Za-z]+)/);
    if (typeMatch) foundSet.add(typeMatch[1]);
  }

  const foundTypes = Array.from(foundSet).sort();

  // Scoring: weighted by importance.
  //   - LocalBusiness/Organization: 40 pts (foundational)
  //   - Each recommended type: 10 pts (max 60)
  const hasEntity = foundSet.has("LocalBusiness") || foundSet.has("Organization");
  let score = hasEntity ? 40 : 0;

  const missingRecommended: string[] = [];
  if (!hasEntity) missingRecommended.push("LocalBusiness");
  for (const t of RECOMMENDED_TYPES) {
    if (foundSet.has(t)) {
      score += 10;
    } else {
      missingRecommended.push(t);
    }
  }

  return {
    score: Math.min(100, score),
    foundTypes,
    missingRecommended,
    jsonLdCount: jsonLdBlocks.length,
    microdataHints,
    lastAuditAt: now,
  };
}
