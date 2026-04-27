// Citation authority scoring.
//
// Assigns every citation a tier + 0-100 score based on domain signals:
//   - Known authority lists (major pubs, gov/edu, review aggregators)
//   - TLD signals (.gov, .edu, .org vs .xyz/.info)
//   - Heuristic patterns (subdomain depth, free-hosting tells)
//
// This is heuristic, not a domain-rating API. Directionally correct,
// not precise — a mention on forbes.com ranks higher than one on a
// WordPress subdomain. Future work could plug in a paid DA/DR API.

export type AuthorityTier = "authority" | "reputable" | "standard" | "low";

// Tier 1: Widely recognized authorities — news, major reference sites
const AUTHORITY_DOMAINS = new Set<string>([
  // News / media (international)
  "nytimes.com", "washingtonpost.com", "wsj.com", "bloomberg.com", "reuters.com",
  "apnews.com", "ft.com", "economist.com", "theguardian.com", "bbc.com", "bbc.co.uk",
  "cnn.com", "nbcnews.com", "abcnews.go.com", "cbsnews.com", "npr.org", "axios.com",
  "politico.com", "thehill.com", "usnews.com", "time.com", "newsweek.com",
  // Business / tech press
  "forbes.com", "fortune.com", "businessinsider.com", "cnbc.com", "marketwatch.com",
  "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com", "engadget.com",
  "inc.com", "entrepreneur.com", "fastcompany.com", "harvard.edu", "hbr.org",
  // Reference / reviews
  "wikipedia.org", "britannica.com", "nih.gov", "cdc.gov", "mayoclinic.org",
  "webmd.com", "healthline.com", "consumerreports.org", "bbb.org",
  "trustpilot.com", "yelp.com", "tripadvisor.com", "angieslist.com", "angi.com",
  "google.com", "maps.google.com",
]);

// Tier 2: Reputable industry publications, directories, and knowledge bases
const REPUTABLE_DOMAINS = new Set<string>([
  // Directories / listings
  "yellowpages.com", "manta.com", "superpages.com", "foursquare.com",
  "opentable.com", "zocdoc.com", "healthgrades.com", "avvo.com",
  // Trade press (broad)
  "adweek.com", "prnewswire.com", "businesswire.com", "prweb.com",
  "medium.com", "substack.com",
  // Tech / dev reference
  "github.com", "stackoverflow.com", "hackernews.com", "news.ycombinator.com",
  // Review & community platforms
  "reddit.com", "quora.com", "glassdoor.com", "indeed.com",
  "capterra.com", "g2.com", "producthunt.com", "softwareadvice.com",
  // Pro networks
  "linkedin.com", "crunchbase.com",
]);

// Tier 4: Known low-authority / user-generated / parked-domain patterns
const LOW_QUALITY_DOMAIN_SUFFIXES = [
  ".blogspot.com", ".wordpress.com", ".weebly.com", ".wixsite.com",
  ".godaddysites.com", ".webs.com", ".tumblr.com", ".livejournal.com",
];

const LOW_QUALITY_TLDS = new Set<string>([
  "xyz", "top", "click", "site", "online", "store", "icu", "work", "tk", "gq",
  "cf", "ml", "ga", "pw", "loan", "bid",
]);

// Extract registered domain (strip subdomains). Simple heuristic — handles
// common two-part TLDs (.co.uk, .com.au) but not comprehensively.
export function normalizeDomain(urlOrDomain: string): string {
  let d = urlOrDomain.toLowerCase().trim();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").replace(/:.*$/, "");
  return d;
}

function registeredDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  // Handle .co.uk, .com.au, .co.jp etc.
  const twoPartTLDs = new Set(["co.uk", "com.au", "co.jp", "co.nz", "com.br", "com.mx", "co.in", "ac.uk", "gov.uk"]);
  const last2 = parts.slice(-2).join(".");
  if (twoPartTLDs.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export interface AuthorityRating {
  tier: AuthorityTier;
  score: number; // 0-100
  reason: string;
}

export function scoreDomainAuthority(urlOrDomain: string): AuthorityRating {
  const full = normalizeDomain(urlOrDomain);
  if (!full) return { tier: "low", score: 10, reason: "empty domain" };

  const reg = registeredDomain(full);
  const tld = reg.split(".").pop() ?? "";

  // Tier 1 — known authority domain (exact or subdomain match)
  if (AUTHORITY_DOMAINS.has(reg) || AUTHORITY_DOMAINS.has(full)) {
    return { tier: "authority", score: 95, reason: `known authority: ${reg}` };
  }

  // .gov / .edu / .mil — strong authority signal
  if (tld === "gov" || tld === "edu" || tld === "mil" || reg.endsWith(".gov.uk") || reg.endsWith(".ac.uk")) {
    return { tier: "authority", score: 90, reason: `government/education TLD (.${tld})` };
  }

  // Tier 2 — reputable industry/directory
  if (REPUTABLE_DOMAINS.has(reg) || REPUTABLE_DOMAINS.has(full)) {
    return { tier: "reputable", score: 70, reason: `reputable publication/directory: ${reg}` };
  }

  // Low-quality free-host patterns — someone's WordPress.com blog
  for (const suffix of LOW_QUALITY_DOMAIN_SUFFIXES) {
    if (full.endsWith(suffix)) {
      return { tier: "low", score: 20, reason: `free-hosted subdomain (${suffix})` };
    }
  }

  // Low-quality TLDs (spam-heavy namespaces)
  if (LOW_QUALITY_TLDS.has(tld)) {
    return { tier: "low", score: 25, reason: `low-trust TLD (.${tld})` };
  }

  // .org gets a small nudge — often nonprofits, industry bodies
  if (tld === "org") {
    return { tier: "reputable", score: 60, reason: `.org domain` };
  }

  // Default: unknown commercial domain — middle of the pack
  return { tier: "standard", score: 50, reason: `unknown domain (neutral)` };
}

export function tierLabel(tier: AuthorityTier): string {
  switch (tier) {
    case "authority": return "Authority";
    case "reputable": return "Reputable";
    case "standard": return "Standard";
    case "low": return "Low";
  }
}
