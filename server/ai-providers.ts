export interface AIQueryResult {
  platform: string;
  query: string;
  responseText: string;
  mentioned: boolean;
  sentiment: "positive" | "neutral" | "negative";
  sentimentScore: number; // 0-100 granular sentiment (50=neutral, 100=very positive, 0=very negative)
  sentimentTopic: string; // topic category: "purchase_intent" | "comparison" | "reputation" | "general" | "local" | "educational"
  confidence: "high" | "medium" | "low";
  position: number | null;
  sourceType: "grounded" | "knowledge";
  crossValidated: boolean | null; // null = not yet validated (single-platform)
  citedUrls: string[]; // URLs cited by the AI platform as sources
  actualCost?: number; // real cost computed from token usage (when available)
}

// Retry wrapper for transient failures (rate limits & server errors)
const API_TIMEOUT_MS = 20_000; // 20s per API call — most calls finish in <10s

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 2): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(API_TIMEOUT_MS),
      });
      // Retry on rate limit (429) or server errors (500+)
      if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        console.warn(`[Retry] ${res.status} on attempt ${attempt + 1}, waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return res;
    } catch (err: any) {
      if (attempt < maxRetries && (err.name === 'TypeError' || err.name === 'TimeoutError' || err.name === 'AbortError' || err.message?.includes('fetch'))) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[Retry] ${err.name || 'Network error'} on attempt ${attempt + 1}, waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}

// Build a focused system instruction that constrains AI responses to the right industry
// NO system prompt for scan queries — this matches what real users see.
// Industry-standard AI visibility trackers (Peec, Profound, Otterly) all
// query platforms without system prompts because real users don't have them.
// Any system prompt biases the AI and produces results your customers never see.

// ── AI-Powered Response Analysis ──────────────────────────────────────────
// Instead of fragile string matching, we send a follow-up call to a cheap AI
// model asking it to analyze whether the response genuinely mentions the
// business. This catches echoed names, wrong-business matches, and gives
// accurate sentiment + confidence ratings.

interface AnalysisResult {
  mentioned: boolean;
  sentiment: "positive" | "neutral" | "negative";
  sentimentScore: number;
  sentimentTopic: string;
  confidence: "high" | "medium" | "low";
  position: number | null;
}

// Keys available for analysis calls (populated from active API keys)
let analysisKeys: { provider: string; apiKey: string }[] = [];

export function setAnalysisKeys(keys: { provider: string; apiKey: string }[]) {
  analysisKeys = keys;
}

// ── Topic classifier (deterministic, no AI needed) ────────────────────────
function classifyTopic(queryLower: string): string {
  if (queryLower.includes("buy") || queryLower.includes("purchase") || queryLower.includes("hire") ||
      queryLower.includes("cost") || queryLower.includes("price") || queryLower.includes("worth it") ||
      queryLower.includes("should i") || queryLower.includes("best") || queryLower.includes("top") ||
      queryLower.includes("recommend")) return "purchase_intent";
  if (queryLower.includes("vs ") || queryLower.includes("compare") || queryLower.includes("between") ||
      queryLower.includes("alternative") || queryLower.includes("better than")) return "comparison";
  if (queryLower.includes("review") || queryLower.includes("reputation") || queryLower.includes("rating") ||
      queryLower.includes("experience with")) return "reputation";
  if (queryLower.includes("near") || queryLower.includes(" in ") || queryLower.includes("local") ||
      queryLower.includes("city") || queryLower.includes("area")) return "local";
  if (queryLower.includes("how") || queryLower.includes("what is") || queryLower.includes("tips") ||
      queryLower.includes("guide") || queryLower.includes("explain")) return "educational";
  return "general";
}

// ── Negation detection ────────────────────────────────────────────────────
// Returns true if the word at `keywordStart` in `text` is preceded by a
// negation word within ~40 characters (roughly 5-7 words).
function isNegated(text: string, keywordStart: number): boolean {
  const negations = [
    "not ", "never ", "no ", "isn't ", "aren't ", "wasn't ", "weren't ",
    "doesn't ", "don't ", "didn't ", "won't ", "can't ", "cannot ", "hardly ",
    "barely ", "scarcely ", "without ", "lack of ", "far from ",
  ];
  const window = text.slice(Math.max(0, keywordStart - 45), keywordStart);
  return negations.some(neg => window.endsWith(neg) || window.includes(neg));
}

// ── AI-powered mention & sentiment analysis ────────────────────────────────
// Uses a cheap AI model (gpt-4o-mini or claude-haiku) to accurately classify
// mentions and sentiment — handles negation, sarcasm, and negative framing
// that pure keyword matching misses.
async function callAnalysisAI(businessName: string, query: string, responseText: string): Promise<AnalysisResult | null> {
  if (analysisKeys.length === 0) return null;

  // Prefer cheapest provider for analysis (no web search needed — just text classification)
  const preferenceOrder = ["openai", "google", "perplexity", "anthropic"];
  const key = preferenceOrder.map(p => analysisKeys.find(k => k.provider === p)).find(Boolean) ?? analysisKeys[0];
  if (!key) return null;

  // Truncate to ~750 tokens to keep cost minimal
  const truncated = responseText.length > 3000 ? responseText.substring(0, 3000) + "..." : responseText;

  const prompt = `Analyze this AI chatbot response to classify whether a business is mentioned and with what sentiment.

Business name: "${businessName}"
Query asked: "${query}"
Chatbot response:
---
${truncated}
---

Reply with JSON only (no markdown):
{
  "mentioned": true or false,
  "mentionContext": "positive_recommendation" | "negative_warning" | "neutral_mention" | "echo_only" | "not_mentioned",
  "sentiment": "positive" | "neutral" | "negative",
  "sentimentScore": 0-100,
  "confidence": "high" | "medium" | "low",
  "position": null or integer
}

Rules:
- mentioned=true: business is genuinely discussed (even negatively)
- mentioned=false: name only echoed from query without real discussion, OR not present
- echo_only → mentioned=false (AI just quoted the query without discussing the business)
- negative_warning: mentioned with complaints/warnings/avoid language → mentioned=true, sentiment=negative
- sentimentScore: 0=very negative, 50=neutral, 100=very positive
- position: integer list position if in a numbered/bulleted list, else null
- confidence=high: AI independently mentioned business; medium: business was in query; low: ambiguous`;

  try {
    let result: any;

    if (key.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`OpenAI analysis ${res.status}`);
      const data = await res.json();
      result = JSON.parse(data.choices?.[0]?.message?.content || "{}");

    } else if (key.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Anthropic analysis ${res.status}`);
      const data = await res.json();
      const text = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] || "{}");

    } else if (key.provider === "google") {
      const GEMINI_MODELS = ["gemini-2.5-flash-preview-04-17", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-flash"];
      let gRes: Response | null = null;
      for (const model of GEMINI_MODELS) {
        const attempt = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 200 },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (attempt.status === 404) { console.warn(`[Gemini analysis] ${model} not available, trying next...`); continue; }
        gRes = attempt;
        break;
      }
      if (!gRes) throw new Error("Google analysis: no available model");
      if (!gRes.ok) throw new Error(`Google analysis ${gRes.status}`);
      const data = await gRes.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
      result = JSON.parse(text);

    } else if (key.provider === "perplexity") {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar-pro",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Perplexity analysis ${res.status}`);
      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] || "{}");
    }

    if (!result || typeof result.mentioned !== "boolean") return null;

    const mentioned = result.mentioned;
    const sentiment: "positive" | "neutral" | "negative" =
      ["positive", "neutral", "negative"].includes(result.sentiment) ? result.sentiment : "neutral";
    const sentimentScore = typeof result.sentimentScore === "number"
      ? Math.max(0, Math.min(100, Math.round(result.sentimentScore))) : 50;
    const confidence: "high" | "medium" | "low" =
      ["high", "medium", "low"].includes(result.confidence) ? result.confidence : "medium";
    const position = typeof result.position === "number" && result.position > 0
      ? Math.round(result.position) : null;

    console.log(`[Analysis AI] "${businessName}" → mentioned:${mentioned} sentiment:${sentiment}(${sentimentScore}) confidence:${confidence} context:${result.mentionContext ?? "?"}`);
    return { mentioned, sentiment, sentimentScore, sentimentTopic: "general", confidence, position };

  } catch (err: any) {
    console.warn(`[Analysis AI] Failed (${key.provider}): ${err.message} — falling back to deterministic`);
    return null;
  }
}

// ── Deterministic fallback analysis ──────────────────────────────────────
// Used when AI analysis keys are unavailable or the AI call fails.
// Includes negation detection and negative-framing detection for better accuracy.
function deterministicAnalysis(
  businessName: string,
  lower: string,
  queryLower: string,
  queryContainsName: boolean,
  searchVariants: string[],
  sentimentTopic: string,
  responseLength: number,
): AnalysisResult {
  // ── Mention detection ──────────────────────────────────────────────────
  const nameFoundInResponse = searchVariants.some(v => lower.includes(v));
  let mentioned = false;
  if (nameFoundInResponse) {
    const pureRefusals = [
      "i don't have specific information",
      "i don't have any information",
      "no verified information available",
      "i'm not familiar with this business",
    ];
    const isPureRefusal = responseLength < 300 && pureRefusals.some(r => lower.includes(r));
    mentioned = !isPureRefusal;
  }

  // ── Position detection ──────────────────────────────────────────────────
  let position: number | null = null;
  if (mentioned) {
    // We need the original (non-lowered) text for line parsing; reconstruct from lower is fine for positions
    const lines = lower.split("\n");
    let listIndex = 0;
    for (const line of lines) {
      const listMatch = line.match(/^[\s]*(?:(\d+)[.\):\-]|\*|\-|•)\s/);
      if (listMatch) {
        listIndex++;
        if (searchVariants.some(v => line.includes(v))) {
          position = listMatch[1] ? parseInt(listMatch[1]) : listIndex;
          break;
        }
      }
    }
  }

  // ── Sentiment with negation detection ─────────────────────────────────
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  let sentimentScore = 50;

  if (mentioned) {
    const matchedVariant = searchVariants.find(v => lower.includes(v))!;
    const nameIndex = lower.indexOf(matchedVariant);
    const context = lower.slice(Math.max(0, nameIndex - 200), Math.min(lower.length, nameIndex + 500));

    // Explicit negative framing near the business name → force negative regardless of other words
    const negativeFraming = [
      "avoid", "beware", "warning:", "do not use", "don't use", "stay away",
      "would not recommend", "wouldn't recommend", "don't recommend",
      "not recommend", "terrible experience", "poor service", "worst",
    ];
    if (negativeFraming.some(f => context.includes(f))) {
      sentimentScore = 15;
      sentiment = "negative";
    } else {
      const strongPositive = ["highly recommend", "excellent", "outstanding", "exceptional", "best choice",
        "top-rated", "industry leader", "go-to", "first choice", "can't go wrong"];
      const mildPositive = ["recommend", "great", "good", "reliable", "professional", "quality",
        "reputable", "well-known", "popular", "trusted", "solid", "experienced", "strong",
        "impressive", "thorough", "praised", "favorable", "dependable"];
      const mildNegative = ["mixed reviews", "some complaints", "could improve", "not the cheapest",
        "limited hours", "slow response", "inconsistent", "varying quality", "hit or miss"];
      const strongNegative = ["avoid", "poor", "bad", "worst", "unreliable", "overpriced",
        "unprofessional", "disappointing", "beware", "scam", "terrible", "horrible", "do not recommend"];

      let score = 50;
      // Score each keyword, accounting for negation (negated positive → mild negative, negated negative → mild positive)
      for (const word of strongPositive) {
        const idx = context.indexOf(word);
        if (idx !== -1) score += isNegated(context, idx) ? -5 : 10;
      }
      for (const word of mildPositive) {
        const idx = context.indexOf(word);
        if (idx !== -1) score += isNegated(context, idx) ? -3 : 5;
      }
      for (const word of mildNegative) {
        const idx = context.indexOf(word);
        if (idx !== -1) score += isNegated(context, idx) ? 3 : -5;
      }
      for (const word of strongNegative) {
        const idx = context.indexOf(word);
        if (idx !== -1) score += isNegated(context, idx) ? 5 : -10;
      }
      sentimentScore = Math.max(0, Math.min(100, score));
      if (sentimentScore >= 65) sentiment = "positive";
      else if (sentimentScore <= 35) sentiment = "negative";
      else sentiment = "neutral";
    }
  }

  // ── Confidence ─────────────────────────────────────────────────────────
  let confidence: "high" | "medium" | "low" = "medium";
  if (mentioned && !queryContainsName) confidence = "high";
  else if (mentioned && queryContainsName) confidence = "medium";
  else {
    const isGeneric = ["i don't have", "i cannot", "search google", "check yelp",
      "i recommend checking", "you might want to search"].some(p => lower.includes(p));
    confidence = isGeneric ? "low" : "high";
  }

  console.log(`[Analysis] "${businessName}" DETERMINISTIC ${mentioned ? "✓" : "✗"} | sentiment:${sentiment}(${sentimentScore}) confidence:${confidence}`);
  return { mentioned, sentiment, sentimentScore, sentimentTopic, confidence, position };
}

// ── analyzeWithAI — main entry point ──────────────────────────────────────
// 1. Fast path: if the name isn't in the response at all, skip AI call (free).
// 2. Name found: use AI-powered analysis for accurate sentiment + mention classification.
// 3. Fallback: deterministic analysis with negation detection if AI is unavailable.
async function analyzeWithAI(businessName: string, query: string, responseText: string, _businessContext?: any): Promise<AnalysisResult> {
  const lower = responseText.toLowerCase();
  const nameLower = businessName.toLowerCase();
  const queryLower = query.toLowerCase();

  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
  const searchVariants: string[] = [nameLower];
  if (nameWords.length >= 2) {
    for (let len = nameWords.length; len >= 2; len--) {
      searchVariants.push(nameWords.slice(0, len).join(" "));
    }
  }

  const nameFoundInResponse = searchVariants.some(v => lower.includes(v));
  const queryContainsName = searchVariants.some(v => queryLower.includes(v));
  const sentimentTopic = classifyTopic(queryLower);

  // ── Fast path: name not in response → not mentioned, no AI call needed ──
  if (!nameFoundInResponse) {
    const isGeneric = ["i don't have", "i cannot", "search google", "check yelp",
      "i recommend checking", "you might want to search"].some(p => lower.includes(p));
    console.log(`[Analysis] "${businessName}" NOT FOUND ✗ | responseLen:${responseText.length} | confidence:${isGeneric ? "low" : "high"}`);
    return { mentioned: false, sentiment: "neutral", sentimentScore: 50, sentimentTopic, confidence: isGeneric ? "low" : "high", position: null };
  }

  // ── AI-powered analysis (accurate sentiment, negation, sarcasm, echo detection) ──
  if (analysisKeys.length > 0) {
    const aiResult = await callAnalysisAI(businessName, query, responseText);
    if (aiResult) {
      return { ...aiResult, sentimentTopic };
    }
  }

  // ── Deterministic fallback ────────────────────────────────────────────────
  return deterministicAnalysis(businessName, lower, queryLower, queryContainsName, searchVariants, sentimentTopic, responseText.length);
}

// ── Response Fingerprinting ──────────────────────────────────────────────
// Detect generic, template, or evasive responses that shouldn't count as
// reliable data points.

export function isGenericResponse(responseText: string): boolean {
  const lower = responseText.toLowerCase();
  const genericPatterns = [
    "i don't have specific information",
    "i don't have access to real-time",
    "i cannot provide specific recommendations",
    "i'm not able to verify",
    "i don't have current data",
    "as an ai, i don't have",
    "i cannot browse the internet",
    "i don't have the ability to",
    "my training data doesn't include",
    "i'm unable to confirm",
    "i don't have up-to-date",
    "without access to current",
    "i can't verify specific businesses",
    "i don't have information about businesses in your area",
    "i recommend checking google",
    "you might want to search",
    "i suggest looking at",
    "please verify this information",
  ];

  const matchCount = genericPatterns.filter(p => lower.includes(p)).length;
  // If 2+ patterns match, it's likely a template/evasive response
  if (matchCount >= 2) return true;

  // Also detect very short responses (likely "I don't know" variants)
  if (responseText.trim().length < 100) {
    const shortDismissals = ["i don't", "i cannot", "i'm not", "no information", "not available"];
    if (shortDismissals.some(p => lower.includes(p))) return true;
  }

  return false;
}

// ── Hallucination Detection ──────────────────────────────────────────────
// After confirming a business IS mentioned, check if the AI fabricated any
// facts about it (wrong location, made-up services, etc.)

// ── Hallucination Detection ────────────────────────────────────────────────
// Checks for direct contradictions with known business facts using text matching.
// Covers wrong location, wrong URL, identity confusion, and contradictory service claims.
export async function detectHallucinations(
  businessFacts: {
    name: string;
    location: string | null;
    website: string | null;
    services: string | null;
  },
  responseText: string,
  _platform: string,
): Promise<{ hasHallucinations: boolean; issues: string[] }> {
  const lower = responseText.toLowerCase();
  const nameLower = businessFacts.name.toLowerCase();
  const issues: string[] = [];

  // ── Check 1: Wrong location claim ─────────────────────────────────────
  if (businessFacts.location) {
    const locParts = businessFacts.location.toLowerCase().split(",").map(s => s.trim());
    const city = locParts[0]; // e.g., "elmhurst"

    // Broader set of location-claim verbs and prepositions (case-insensitive via `lower`)
    const locationClaims = lower.match(
      /(?:located|based|headquartered|operates|operating|office|clinic|store|shop|practice|branch|serving)\s+(?:in|at|out of|from|near)\s+([a-z][a-z\s]{2,30?})(?:[,.\n]|$)/g
    );
    if (locationClaims && city) {
      for (const claim of locationClaims) {
        if (!claim.includes(city) && !claim.includes("area") && !claim.includes("region") &&
            !claim.includes("nationwide") && !claim.includes("online")) {
          // Verify the claim is actually naming a specific place (starts with a city-like word)
          if (/[a-z]{3,}/.test(claim.replace(/(?:located|based|headquartered|operates|operating|office|clinic|store|shop|practice|branch|serving)\s+(?:in|at|out of|from|near)\s+/, ""))) {
            issues.push(`Location mismatch: response says "${claim.trim()}" but business is in ${businessFacts.location}`);
          }
        }
      }
    }
  }

  // ── Check 2: Wrong website URL ────────────────────────────────────────
  if (businessFacts.website) {
    const knownDomain = businessFacts.website.toLowerCase()
      .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
    const urlRegex = /https?:\/\/[^\s\)\]"'<>]+/g;
    const urls = responseText.match(urlRegex) || [];
    for (const url of urls) {
      const urlDomain = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
      if (urlDomain === knownDomain) continue; // correct URL — not a hallucination
      // Only flag if this URL is mentioned close to the business name
      const nameIdx = lower.indexOf(nameLower);
      const urlIdx = lower.indexOf(urlDomain);
      if (nameIdx !== -1 && urlIdx !== -1 && Math.abs(nameIdx - urlIdx) < 250) {
        issues.push(`URL mismatch: response links to ${urlDomain} but business website is ${knownDomain}`);
      }
    }
  }

  // ── Check 3: Identity confusion (renamed, "also known as") ────────────
  const escapedName = nameLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const confusionPatterns = [
    new RegExp(`${escapedName}[^.]{0,60}(?:also known as|formerly|now called|renamed to|rebranded as)\\s+([^,.]{3,40})`, "i"),
  ];
  for (const pattern of confusionPatterns) {
    const match = responseText.match(pattern);
    if (match) {
      issues.push(`Identity confusion: "${match[0].trim()}"`);
    }
  }

  // ── Check 4: Contradictory ownership/affiliation claims ────────────────
  // Flags statements like "owned by [different company]" or "subsidiary of X" near the name
  const affiliationPattern = new RegExp(
    `${escapedName}[^.]{0,80}(?:owned by|subsidiary of|division of|part of|acquired by)\\s+([^,.]{3,50})`,
    "i"
  );
  const affiliationMatch = responseText.match(affiliationPattern);
  if (affiliationMatch) {
    issues.push(`Affiliation claim: "${affiliationMatch[0].trim()}" — verify this is accurate`);
  }

  // ── Check 5: Wildly wrong hours/closure claims ────────────────────────
  // If response says "permanently closed" or "out of business" for a known active business
  const closurePatterns = [
    /permanently closed/i, /out of business/i, /no longer operating/i, /has closed/i, /went out of business/i,
  ];
  for (const pattern of closurePatterns) {
    if (pattern.test(responseText)) {
      const matchResult = responseText.match(pattern);
      // Only flag if this closure claim is near the business name
      if (matchResult) {
        const closureIdx = lower.indexOf(matchResult[0].toLowerCase());
        const nameIdx = lower.indexOf(nameLower);
        if (nameIdx !== -1 && closureIdx !== -1 && Math.abs(nameIdx - closureIdx) < 300) {
          issues.push(`Closure claim: response says "${matchResult[0]}" — verify business is still active`);
        }
      }
    }
  }

  // ── Check 6: AI-powered contradiction detection ───────────────────────
  // Send known facts + AI response to a cheap model to catch hallucinations
  // that regex can't catch (wrong phone, wrong services, invented awards, etc.)
  try {
    const aiIssues = await checkHallucinationsWithAI(businessFacts, responseText);
    for (const issue of aiIssues) {
      if (!issues.some(existing => existing.toLowerCase().includes(issue.toLowerCase().slice(0, 30)))) {
        issues.push(issue);
      }
    }
  } catch (err) {
    console.error(`[Hallucination] AI check failed, using regex results only:`, (err as Error).message);
  }

  console.log(`[Hallucination] "${businessFacts.name}": ${issues.length} issue(s) found`);
  return { hasHallucinations: issues.length > 0, issues };
}

async function checkHallucinationsWithAI(
  businessFacts: { name: string; location: string | null; website: string | null; services: string | null },
  responseText: string,
): Promise<string[]> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return [];

  // Only send a trimmed excerpt to keep costs low (first 1500 chars is usually enough)
  const excerpt = responseText.slice(0, 1500);

  const factSummary = [
    `Business name: ${businessFacts.name}`,
    businessFacts.location ? `Location: ${businessFacts.location}` : null,
    businessFacts.website ? `Website: ${businessFacts.website}` : null,
    businessFacts.services ? `Services/description: ${businessFacts.services}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `You are a fact-checker. Given the verified business facts below and an AI-generated response excerpt, identify any DIRECT CONTRADICTIONS — claims in the response that clearly conflict with the known facts. Do NOT flag speculation, opinions, or missing info — only clear contradictions.

Known facts:
${factSummary}

AI response excerpt:
${excerpt}

Reply with a JSON array of strings, each describing one contradiction. If none, reply with []. Example: ["Wrong city: response says Denver but business is in Chicago"].`;

  try {
    if (openaiKey) {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 300,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: Array<{ message: { content: string } }> };
        const raw = data.choices?.[0]?.message?.content ?? "[]";
        // Model may return {"contradictions": [...]} or just [...]
        const parsed = JSON.parse(raw);
        const arr: string[] = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.contradictions) ? parsed.contradictions : []);
        return arr.filter((s: unknown) => typeof s === "string" && s.length > 0);
      }
    } else if (anthropicKey) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json() as { content: Array<{ text: string }> };
        const raw = data.content?.[0]?.text ?? "[]";
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const arr = JSON.parse(jsonMatch[0]);
          return Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === "string" && s.length > 0) : [];
        }
      }
    }
  } catch (err) {
    console.error(`[checkHallucinationsWithAI] error:`, (err as Error).message);
  }
  return [];
}

// ── Citation Verification ──────────────────────────────────────────────────
// For grounded platforms (Perplexity, Gemini), verify cited URLs exist AND mention the business.
export async function verifyCitations(responseText: string, businessName: string): Promise<{
  verified: number;
  failed: number;
  irrelevant: number;
  urls: { url: string; valid: boolean; mentionsBusiness: boolean }[];
}> {
  // Domains that are AI infrastructure, not real external citations
  const BLOCKED_CITATION_DOMAINS = [
    "vertexaisearch.cloud.google.com",
    "grounding-api.google.com",
    "openai.com",
    "anthropic.com",
    "perplexity.ai",
  ];

  const urlRegex = /https?:\/\/[^\s\)\]"'<>]+/g;
  const allUrls = [...new Set(responseText.match(urlRegex) || [])];
  const urls = allUrls
    .filter(u => !BLOCKED_CITATION_DOMAINS.some(d => u.includes(d)))
    .slice(0, 5);
  if (urls.length === 0) return { verified: 0, failed: 0, irrelevant: 0, urls: [] };

  const nameLower = businessName.toLowerCase();
  // Also check short name variants (first word, last word) in case the page uses a shortened name
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 3);

  // Fetch all URLs in parallel instead of sequentially
  const results = await Promise.all(urls.map(async (url): Promise<{ url: string; valid: boolean; mentionsBusiness: boolean }> => {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0)" },
        signal: AbortSignal.timeout(8000),
        redirect: "follow",
      });
      if (res.status >= 400) return { url, valid: false, mentionsBusiness: false };

      // Read page text, strip HTML tags, check for business name
      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .toLowerCase();

      const mentionsBusiness = text.includes(nameLower) ||
        (nameWords.length >= 2 && nameWords.every(w => text.includes(w)));

      return { url, valid: true, mentionsBusiness };
    } catch {
      return { url, valid: false, mentionsBusiness: false };
    }
  }));

  return {
    verified: results.filter(r => r.valid && r.mentionsBusiness).length,
    failed: results.filter(r => !r.valid).length,
    irrelevant: results.filter(r => r.valid && !r.mentionsBusiness).length,
    urls: results,
  };
}

// ── Platform Health Tracking ────────────────────────────────────────────────
let healthCallback: ((provider: string, status: "success" | "error", responseTimeMs: number, errorMessage?: string) => void) | null = null;

export function setHealthCallback(cb: typeof healthCallback) {
  healthCallback = cb;
}

async function queryOpenAI(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    // Use OpenAI Responses API with web search tool for real-world results
    const res = await fetchWithRetry("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        tools: [{ type: "web_search_preview" }],
        input: query,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // Responses API returns output array — extract text from message items
    let responseText = "";
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === "output_text") responseText += block.text;
          }
        }
      }
    }
    if (!responseText) responseText = data.output_text ?? "";

    // Extract citations from OpenAI Responses API (url_citation annotations)
    const citedUrls: string[] = [];
    if (Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const block of item.content) {
            if (block.type === "output_text" && Array.isArray(block.annotations)) {
              for (const ann of block.annotations) {
                if (ann.type === "url_citation" && ann.url) citedUrls.push(ann.url);
              }
            }
          }
        }
      }
    }
    // Fallback: extract URLs from text
    if (citedUrls.length === 0) {
      const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
      citedUrls.push(...(responseText.match(urlRegex) || []));
    }

    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    // Compute actual cost from real token counts
    const usage = data.usage ?? {};
    const inputTokens: number = usage.input_tokens ?? usage.prompt_tokens ?? 0;
    const outputTokens: number = usage.output_tokens ?? usage.completion_tokens ?? 0;
    const pricing = TOKEN_PRICING["openai"];
    const actualCost = (inputTokens * pricing.input) + (outputTokens * pricing.output) + pricing.toolCost;

    healthCallback?.("openai", "success", Date.now() - startTime);
    return { platform: "ChatGPT", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null, citedUrls: [...new Set(citedUrls)], actualCost };
  } catch (err: any) {
    healthCallback?.("openai", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryAnthropic(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    // Use Claude's web search tool — matches what real users see on claude.ai
    // No system prompt — real users don't have one
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "web-search-2025-03-05",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // Extract text blocks and citations from response
    const responseText = Array.isArray(data.content)
      ? data.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n")
      : "";

    // Extract cited URLs from Claude's web_search_tool_result blocks
    const citedUrls: string[] = [];
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
          for (const result of block.content) {
            if (result.url) citedUrls.push(result.url);
          }
        }
        // Also check for citations in text block annotations
        if (block.type === "text" && Array.isArray(block.citations)) {
          for (const cit of block.citations) {
            if (cit.url) citedUrls.push(cit.url);
          }
        }
      }
    }
    // Fallback: extract URLs from text
    if (citedUrls.length === 0) {
      const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
      citedUrls.push(...(responseText.match(urlRegex) || []));
    }

    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    const usage = data.usage ?? {};
    const inputTokens: number = usage.input_tokens ?? 0;
    const outputTokens: number = usage.output_tokens ?? 0;
    const pricing = TOKEN_PRICING["anthropic"];
    const actualCost = (inputTokens * pricing.input) + (outputTokens * pricing.output) + pricing.toolCost;

    healthCallback?.("anthropic", "success", Date.now() - startTime);
    return { platform: "Claude", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null, citedUrls: [...new Set(citedUrls)], actualCost };
  } catch (err: any) {
    healthCallback?.("anthropic", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryGemini(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    // Try models in order — Google deprecates models frequently for new API keys
    const GEMINI_MODELS = [
      "gemini-2.5-flash-preview-04-17",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
    ];

    let res: Response | null = null;
    let lastError = "";
    for (const model of GEMINI_MODELS) {
      const attempt = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (attempt.status === 404) {
        lastError = `${model} not available`;
        console.warn(`[Gemini] Model ${model} not available, trying next...`);
        continue;
      }
      res = attempt;
      break;
    }

    if (!res) throw new Error(`Gemini API error: no available model found. Last error: ${lastError}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // Gemini may return multiple parts when grounded; concatenate all text parts
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const responseText = parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n") || "";

    // Extract grounding citations from Gemini's groundingMetadata
    const citedUrls: string[] = [];
    const groundingMeta = data.candidates?.[0]?.groundingMetadata;
    if (groundingMeta?.groundingChunks) {
      for (const chunk of groundingMeta.groundingChunks) {
        if (chunk.web?.uri) citedUrls.push(chunk.web.uri);
      }
    }
    // Also extract from groundingSupports
    if (groundingMeta?.webSearchQueries) {
      console.log(`[Gemini] Grounding used ${groundingMeta.webSearchQueries.length} search queries, found ${citedUrls.length} source URLs`);
    }
    // Fallback: extract URLs from response text
    if (citedUrls.length === 0) {
      const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
      citedUrls.push(...(responseText.match(urlRegex) || []));
    }

    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    const usageMeta = data.usageMetadata ?? {};
    const inputTokens: number = usageMeta.promptTokenCount ?? 0;
    const outputTokens: number = usageMeta.candidatesTokenCount ?? 0;
    const pricing = TOKEN_PRICING["google"];
    const actualCost = (inputTokens * pricing.input) + (outputTokens * pricing.output) + pricing.toolCost;

    healthCallback?.("google", "success", Date.now() - startTime);
    return { platform: "Google Gemini", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null, citedUrls: [...new Set(citedUrls)], actualCost };
  } catch (err: any) {
    healthCallback?.("google", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryPerplexity(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    // Perplexity Sonar — web search is built-in, matches real Perplexity UI
    // No system prompt — real users don't have one
    const res = await fetchWithRetry("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        max_tokens: 1024,
        messages: [
          { role: "user", content: query },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Perplexity API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const responseText = data.choices?.[0]?.message?.content ?? "";

    // Perplexity returns citations in the response body
    const citedUrls: string[] = [];
    if (Array.isArray(data.citations)) {
      citedUrls.push(...data.citations);
    }
    // Fallback: extract URLs from response text
    if (citedUrls.length === 0) {
      const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
      citedUrls.push(...(responseText.match(urlRegex) || []));
    }

    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    const usage = data.usage ?? {};
    const inputTokens: number = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens: number = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const pricing = TOKEN_PRICING["perplexity"];
    const actualCost = (inputTokens * pricing.input) + (outputTokens * pricing.output) + pricing.toolCost;

    healthCallback?.("perplexity", "success", Date.now() - startTime);
    return { platform: "Perplexity", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null, citedUrls: [...new Set(citedUrls)], actualCost };
  } catch (err: any) {
    healthCallback?.("perplexity", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

const PROVIDER_FN: Record<string, (apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }) => Promise<AIQueryResult>> = {
  openai: queryOpenAI,
  anthropic: queryAnthropic,
  google: queryGemini,
  perplexity: queryPerplexity,
};

const PROVIDER_PLATFORM: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Google Gemini",
  perplexity: "Perplexity",
};

// Per-token pricing (input + output) plus fixed per-call tool costs (2026 rates).
// Used to compute actual cost from real token counts returned by each API.
const TOKEN_PRICING: Record<string, { input: number; output: number; toolCost: number }> = {
  openai: {
    input: 0.15 / 1_000_000,   // gpt-4o-mini: $0.15/1M input tokens
    output: 0.60 / 1_000_000,  // gpt-4o-mini: $0.60/1M output tokens
    toolCost: 0.025,            // web_search_preview: ~$25/1000 calls
  },
  anthropic: {
    input: 3.0 / 1_000_000,    // claude-sonnet-4: $3/1M input tokens
    output: 15.0 / 1_000_000,  // claude-sonnet-4: $15/1M output tokens
    toolCost: 0.002,            // web_search tool overhead (estimated per use)
  },
  google: {
    input: 0.10 / 1_000_000,   // gemini-2.0-flash-lite: $0.10/1M input tokens
    output: 0.40 / 1_000_000,  // gemini-2.0-flash-lite: $0.40/1M output tokens
    toolCost: 0.035,            // Google Search grounding: $35/1000 grounded queries
  },
  perplexity: {
    input: 3.0 / 1_000_000,    // sonar-pro: $3/1M input tokens
    output: 15.0 / 1_000_000,  // sonar-pro: $15/1M output tokens
    toolCost: 0.0,              // web search included in per-token price
  },
};

// Fallback flat-rate estimates used when token counts are unavailable.
export const PROVIDER_COST_PER_CALL: Record<string, number> = {
  openai: 0.025,
  anthropic: 0.008,
  google: 0.004,
  perplexity: 0.005,
};

// ── Cross-Platform Validation ──────────────────────────────────────────────
// After collecting results for a single query across all platforms, compare
// them. If the majority agree on mention/no-mention, results that align get
// crossValidated = true (boosted confidence). Outliers get crossValidated = false
// and their confidence is downgraded.
function crossValidateResults(results: AIQueryResult[]): AIQueryResult[] {
  // Need at least 3 platforms for meaningful cross-validation — with only 2, a
  // 50/50 split produces no majority and any "consensus" is misleading.
  if (results.length < 3) {
    return results.map(r => ({ ...r, crossValidated: null }));
  }

  const mentionCount = results.filter(r => r.mentioned).length;
  const noMentionCount = results.length - mentionCount;
  const majorityMentioned = mentionCount > noMentionCount;

  // Strong consensus = supermajority (>= 75% agree)
  const majoritySize = Math.max(mentionCount, noMentionCount);
  const consensusStrength = majoritySize / results.length;
  const strongConsensus = consensusStrength >= 0.75;

  return results.map(r => {
    const agreesWithMajority = r.mentioned === majorityMentioned;

    let adjustedConfidence = r.confidence;
    if (strongConsensus && agreesWithMajority) {
      // Strong consensus + agrees → boost confidence
      if (r.confidence === "low") adjustedConfidence = "medium";
      else if (r.confidence === "medium") adjustedConfidence = "high";
    } else if (strongConsensus && !agreesWithMajority) {
      // Strong consensus + disagrees → downgrade confidence
      if (r.confidence === "high") adjustedConfidence = "medium";
      else if (r.confidence === "medium") adjustedConfidence = "low";
    }

    return {
      ...r,
      crossValidated: agreesWithMajority,
      confidence: adjustedConfidence,
    };
  });
}

// Max time to wait for all platforms to respond to a single query.
// If exceeded, the query is skipped entirely so the scan keeps moving.
// Set to 2× the single-call timeout + buffer for the analysis sub-call.
const QUERY_TIMEOUT_MS = 75_000; // 75s per query

export async function* runScan(
  businessName: string,
  queries: string[],
  keys: { provider: string; apiKey: string }[],
  extraTerms?: string[],
  businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }
): AsyncGenerator<AIQueryResult> {
  // Process queries in batches of 2 concurrently — halves wall-clock time
  // without hammering APIs the way a full parallel blast would.
  const CONCURRENT_QUERIES = 2;

  async function runOneQuery(query: string): Promise<AIQueryResult[]> {
    const platformPromises = keys.map(async (key) => {
      const fn = PROVIDER_FN[key.provider];
      if (!fn) return null;
      try {
        const result = await fn(key.apiKey, query, businessName, extraTerms, businessContext);
        if (isGenericResponse(result.responseText)) {
          console.log(`[Scan] Generic response detected from ${result.platform} for "${query}"`);
          result.confidence = "low";
        }
        return result;
      } catch (err: any) {
        console.error(`[AI Scan] ${key.provider} failed for query "${query}":`, err.message);
        return null;
      }
    });

    const raw = await Promise.race([
      Promise.all(platformPromises),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Query timed out after ${QUERY_TIMEOUT_MS / 1000}s`)), QUERY_TIMEOUT_MS)
      ),
    ]);

    const results = raw.filter((r): r is AIQueryResult => r !== null);
    const validated = crossValidateResults(results);
    const mentionedInQuery = validated.filter(r => r.mentioned).length;
    console.log(`[Scan] Query "${query.substring(0, 60)}..." → ${mentionedInQuery}/${validated.length} platforms mentioned`);
    return validated;
  }

  // Slide a window of CONCURRENT_QUERIES over the query list
  for (let i = 0; i < queries.length; i += CONCURRENT_QUERIES) {
    const batch = queries.slice(i, i + CONCURRENT_QUERIES);
    const batchResults = await Promise.allSettled(batch.map(q => runOneQuery(q)));

    for (const outcome of batchResults) {
      if (outcome.status === "rejected") {
        console.warn(`[Scan] Skipping query (${outcome.reason?.message ?? "timeout"})`);
        continue;
      }
      for (const result of outcome.value) {
        yield result;
      }
    }
  }
}

// Diagnostic: run a single query against all platforms and return full details
export async function diagnosticQuery(
  businessName: string,
  query: string,
  keys: { provider: string; apiKey: string }[],
  businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }
): Promise<{ platform: string; mentioned: boolean; nameFoundInResponse: boolean; responsePreview: string; responseLength: number; searchVariantsUsed: string[] }[]> {
  const nameLower = businessName.toLowerCase();
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
  const searchVariants: string[] = [nameLower];
  if (nameWords.length >= 2) {
    for (let len = nameWords.length; len >= 2; len--) {
      searchVariants.push(nameWords.slice(0, len).join(" "));
    }
  }

  const results = await Promise.all(keys.map(async (key) => {
    const fn = PROVIDER_FN[key.provider];
    if (!fn) return null;
    try {
      const result = await fn(key.apiKey, query, businessName, [], businessContext);
      const lower = result.responseText.toLowerCase();
      const nameFoundInResponse = searchVariants.some(v => lower.includes(v));
      return {
        platform: result.platform,
        mentioned: result.mentioned,
        nameFoundInResponse,
        responsePreview: result.responseText.substring(0, 500),
        responseLength: result.responseText.length,
        searchVariantsUsed: searchVariants,
      };
    } catch (err: any) {
      return { platform: key.provider, mentioned: false, nameFoundInResponse: false, responsePreview: `ERROR: ${err.message}`, responseLength: 0, searchVariantsUsed: searchVariants };
    }
  }));
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export async function testApiKey(provider: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
  const fn = PROVIDER_FN[provider];
  if (!fn) return { success: false, error: `Unknown provider: ${provider}` };

  try {
    await fn(apiKey, "Hello, respond with one short sentence.", "TestBusiness");
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Ask an AI to identify real competitors for a business
export async function detectCompetitors(
  businessName: string,
  industry: string,
  location: string | null,
  keys: { provider: string; apiKey: string }[]
): Promise<string[]> {
  const locStr = location ? ` within 25 miles of ${location}` : "";
  const prompt = `List the top 5 real, local competitors to "${businessName}" in the ${industry} industry${locStr}. These MUST be real businesses that physically operate${location ? ` within a 25-mile radius of ${location}` : " in the same local area"}. Do NOT list national chains or businesses from other cities/regions unless they have a location nearby. Return ONLY a comma-separated list of business names, nothing else. Example format: "Company A, Company B, Company C, Company D, Company E"`;

  // Try each provider until one works
  for (const key of keys) {
    const fn = PROVIDER_FN[key.provider];
    if (!fn) continue;
    try {
      const result = await fn(key.apiKey, prompt, "__no_match__"); // dummy name so it doesn't affect mention detection
      const text = result.responseText.trim();
      // Parse the comma-separated response, clean up any numbering or quotes
      const names = text
        .replace(/^\d+[\.\)]\s*/gm, "") // remove "1. ", "2) " etc
        .split(/[,\n]+/)
        .map(s => s.replace(/["""']/g, "").replace(/^\s*-\s*/, "").trim())
        .filter(s => s.length > 1 && s.length < 80 && !s.toLowerCase().includes("here"))
        .slice(0, 5);
      if (names.length > 0) return names;
    } catch (err: any) {
      console.error(`[Competitors] ${key.provider} failed:`, err.message);
    }
  }
  return [];
}

export interface BusinessContext {
  name: string;
  industry: string;
  location: string | null;
  services: string | null;
  keywords: string | null;
  targetAudience: string | null;
  uniqueSellingPoints: string | null;
  competitors: string | null;
  customQueries: string | null;
}

// Parse comma-separated field into trimmed non-empty strings
function parseList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map(s => s.trim()).filter(Boolean);
}

export function generateScanQueries(ctx: BusinessContext): string[] {
  const { name } = ctx;
  const ind = ctx.industry.toLowerCase();
  const loc = ctx.location ?? null;
  const servicesList = parseList(ctx.services);
  const keywordsList = parseList(ctx.keywords);
  const audienceList = parseList(ctx.targetAudience);
  const competitorsList = parseList(ctx.competitors);

  // ── Discovery queries (intent: find options) ──────────────────────────────
  const discovery: string[] = loc
    ? [
        `I need a good ${ind} company in ${loc}. Who do you recommend?`,
        `What are the best ${ind} businesses in the ${loc} area? Give me your top picks.`,
        `I'm looking for a reliable ${ind} provider near ${loc}. Who should I call?`,
        `Which ${ind} companies in ${loc} have the best reputation?`,
      ]
    : [
        `I need a good ${ind} company. Who do you recommend?`,
        `What are the best ${ind} businesses right now? Give me your top picks.`,
        `I'm looking for a reliable ${ind} provider. Who should I call?`,
        `Which ${ind} companies have the best reputation?`,
      ];

  // ── Service-specific queries ──────────────────────────────────────────────
  const serviceQueries: string[] = [];
  for (const svc of servicesList.slice(0, 4)) {
    serviceQueries.push(`I need ${svc} services${loc ? ` in ${loc}` : ""}. Who's the best?`);
    serviceQueries.push(`Who offers the best ${svc}${loc ? ` near ${loc}` : ""}? Give me specific names.`);
  }

  // ── Keyword-driven queries ────────────────────────────────────────────────
  const keywordQueries: string[] = [];
  for (const kw of keywordsList.slice(0, 4)) {
    keywordQueries.push(`I'm looking for ${kw} ${ind}${loc ? ` in ${loc}` : ""}. Who do you recommend?`);
  }

  // ── Audience-specific queries ─────────────────────────────────────────────
  const audienceQueries: string[] = [];
  for (const aud of audienceList.slice(0, 3)) {
    audienceQueries.push(`What's the best ${ind} for ${aud}${loc ? ` in ${loc}` : ""}?`);
  }

  // ── Competitor comparison queries ─────────────────────────────────────────
  const competitorQueries: string[] = loc
    ? [
        `How does ${name} compare to other ${ind} companies in ${loc}?`,
        `I'm deciding between ${name} and other ${ind} options in ${loc}. Which one should I pick?`,
      ]
    : [
        `How does ${name} compare to other ${ind} companies?`,
        `I'm deciding between ${name} and other ${ind} options. Which one should I pick?`,
      ];
  for (const comp of competitorsList.slice(0, 3)) {
    competitorQueries.push(`I'm choosing between ${name} and ${comp}${loc ? ` in ${loc}` : ""}. Which one is better and why?`);
  }

  // ── Review / reputation queries (intent: validate trust) ─────────────────
  const review: string[] = loc
    ? [
        `I'm thinking about hiring ${name} in ${loc}. What do you know about them? Are they any good?`,
        `Is ${name} in ${loc} worth the money? What's their reputation like?`,
        `Tell me about ${name} in ${loc} — are they reliable? What are they known for?`,
        `Have there been any complaints about ${name} in ${loc}? Should I be worried about anything?`,
      ]
    : [
        `I'm thinking about hiring ${name}. What do you know about them? Are they any good?`,
        `Is ${name} worth the money? What's their reputation like?`,
        `Tell me about ${name} — are they reliable?`,
        `Have there been any complaints about ${name}?`,
      ];

  // ── Local queries (intent: find nearby) ──────────────────────────────────
  const local: string[] = loc
    ? [
        `Who's the best ${ind} company near ${loc}? I need someone local.`,
        `Can you recommend a top-rated ${ind} service in ${loc}?`,
        `I live in ${loc} and need ${ind} services. Who do people recommend?`,
      ]
    : [
        `I need a local ${ind} company. Who's good in my area?`,
        `Can you recommend a ${ind} provider with great reviews near me?`,
      ];

  // ── Long-tail / intent queries ────────────────────────────────────────────
  const longTail: string[] = loc
    ? [
        `I want an affordable but good ${ind} service in ${loc}. Any suggestions?`,
        `What should I look for when hiring a ${ind} company in ${loc}? Who do you recommend?`,
        `Which ${ind} services in ${loc} give you the best value for money?`,
      ]
    : [
        `I want an affordable but good ${ind} service. Any suggestions?`,
        `What should I look for when hiring a ${ind} company? Who do you recommend?`,
        `Which ${ind} services give you the best value for money?`,
      ];

  // ── Seasonal / trending ───────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const seasonal: string[] = loc
    ? [
        `What are the best ${ind} companies in ${loc} for ${currentYear}?`,
        `Is ${name} in ${loc} still good in ${currentYear}? Or are there better options now?`,
      ]
    : [
        `What are the best ${ind} companies for ${currentYear}?`,
        `Is ${name} still good in ${currentYear}? Or are there better options now?`,
      ];

  // ── Custom queries (user-provided, highest priority) ───────────────────────
  const custom: string[] = [];
  if (ctx.customQueries) {
    const lines = ctx.customQueries.split("\n").map(s => s.trim()).filter(Boolean);
    custom.push(...lines);
  }

  // Custom queries first (they're the user's priority), then auto-generated
  const all = [
    ...custom,
    ...discovery,
    ...serviceQueries,
    ...keywordQueries,
    ...audienceQueries,
    ...competitorQueries,
    ...review,
    ...local,
    ...longTail,
    ...seasonal,
  ];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of all) {
    const key = q.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(q);
    }
  }

  // Higher cap when custom queries are provided
  const cap = custom.length > 0 ? Math.max(25, custom.length + 10) : 25;
  return unique.slice(0, cap);
}
