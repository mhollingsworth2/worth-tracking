export interface AIQueryResult {
  platform: string;
  query: string;
  responseText: string;
  mentioned: boolean;
  sentiment: "positive" | "neutral" | "negative";
  confidence: "high" | "medium" | "low";
  position: number | null;
  sourceType: "grounded" | "knowledge";
  crossValidated: boolean | null; // null = not yet validated (single-platform)
}

// Retry wrapper for transient failures (rate limits & server errors)
const API_TIMEOUT_MS = 30_000; // 30s per API call — prevents hanging forever

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
  confidence: "high" | "medium" | "low";
  position: number | null;
}

// Keys available for analysis calls (populated from active API keys)
let analysisKeys: { provider: string; apiKey: string }[] = [];

export function setAnalysisKeys(keys: { provider: string; apiKey: string }[]) {
  analysisKeys = keys;
}

// ── Deterministic text-based analysis ──────────────────────────────────────
// Simple and reliable: if the business name is in the response, it's mentioned.
// Only exception: pure refusal responses where the AI says nothing useful.
function analyzeWithAI(businessName: string, query: string, responseText: string, _businessContext?: any): AnalysisResult {
  const lower = responseText.toLowerCase();
  const nameLower = businessName.toLowerCase();
  const queryLower = query.toLowerCase();

  // Build search variants: full name, and partial names (2+ word combos)
  const nameWords = nameLower.split(/\s+/).filter(w => w.length > 2);
  const searchVariants: string[] = [nameLower];
  if (nameWords.length >= 2) {
    for (let len = nameWords.length; len >= 2; len--) {
      searchVariants.push(nameWords.slice(0, len).join(" "));
    }
  }

  // Does the business name appear in the response text?
  const nameFoundInResponse = searchVariants.some(v => lower.includes(v));
  const queryContainsName = searchVariants.some(v => queryLower.includes(v));

  // ── Mention detection — simple rule ─────────────────────────────────────
  // If the name is in the response → mentioned.
  // ONLY exception: the entire response is a short refusal with no substance.
  let mentioned = false;

  if (nameFoundInResponse) {
    // Only reject if the response is PURELY a refusal — short and says nothing useful
    const pureRefusals = [
      "i don't have specific information",
      "i don't have any information",
      "no verified information available",
      "i'm not familiar with this business",
    ];
    const isPureRefusal = responseText.length < 300 && pureRefusals.some(r => lower.includes(r));
    mentioned = !isPureRefusal;
  }

  // ── Position detection ──────────────────────────────────────────────────
  let position: number | null = null;
  if (mentioned) {
    const lines = responseText.split("\n");
    let listIndex = 0;
    for (const line of lines) {
      const listMatch = line.match(/^[\s]*(?:(\d+)[.\):\-]|\*|\-|•)\s/);
      if (listMatch) {
        listIndex++;
        const lineLower = line.toLowerCase();
        if (searchVariants.some(v => lineLower.includes(v))) {
          position = listMatch[1] ? parseInt(listMatch[1]) : listIndex;
          break;
        }
      }
    }
  }

  // ── Sentiment analysis ──────────────────────────────────────────────────
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  if (mentioned) {
    const positiveWords = ["recommend", "excellent", "great", "best", "top", "outstanding", "highly rated",
      "trusted", "reliable", "professional", "quality", "reputable", "well-known", "popular",
      "favorite", "praised", "strong", "exceptional", "impressive", "thorough", "highly recommend"];
    const negativeWords = ["complaint", "avoid", "poor", "bad", "worst", "unreliable", "overpriced",
      "unprofessional", "disappointing", "warning", "beware", "issues", "problem", "negative reviews"];

    const matchedVariant = searchVariants.find(v => lower.includes(v))!;
    const nameIndex = lower.indexOf(matchedVariant);
    const context = lower.slice(Math.max(0, nameIndex - 200), Math.min(lower.length, nameIndex + 500));

    const posCount = positiveWords.filter(w => context.includes(w)).length;
    const negCount = negativeWords.filter(w => context.includes(w)).length;

    if (posCount > negCount && posCount >= 2) sentiment = "positive";
    else if (negCount > posCount && negCount >= 2) sentiment = "negative";
    else if (posCount > 0) sentiment = "positive";
    else if (negCount > 0) sentiment = "negative";
  }

  // ── Confidence ──────────────────────────────────────────────────────────
  let confidence: "high" | "medium" | "low" = "medium";
  if (mentioned && !queryContainsName) {
    confidence = "high"; // AI independently brought up the business
  } else if (mentioned && queryContainsName) {
    confidence = "medium"; // Business was in query, so mention is less surprising
  } else {
    const isGeneric = ["i don't have", "i cannot", "search google", "check yelp",
      "i recommend checking", "you might want to search"].some(p => lower.includes(p));
    confidence = isGeneric ? "low" : "high";
  }

  console.log(`[Analysis] "${businessName}" ${mentioned ? "FOUND ✓" : "NOT FOUND ✗"} | queryHadName: ${queryContainsName} | nameInResponse: ${nameFoundInResponse} | responseLen: ${responseText.length} | position: ${position} | sentiment: ${sentiment} | confidence: ${confidence}`);
  if (!mentioned && !nameFoundInResponse) {
    console.log(`[Analysis] Response preview (first 200 chars): ${responseText.substring(0, 200).replace(/\n/g, " ")}`);
  }

  return { mentioned, sentiment, confidence, position };
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

const HALLUCINATION_PROMPT = (
  businessName: string,
  facts: { location: string | null; website: string | null; services: string | null },
  responseText: string,
  platform: string,
) => {
  const knownFacts: string[] = [];
  if (facts.location) knownFacts.push(`Location: ${facts.location}`);
  if (facts.website) knownFacts.push(`Website: ${facts.website}`);
  if (facts.services) knownFacts.push(`Services offered: ${facts.services}`);
  const factsBlock = knownFacts.length > 0 ? knownFacts.join("\n") : "No verified facts available";

  return `Check this ${platform} AI response about "${businessName}" for hallucinated or incorrect facts.

Known facts about the business:
${factsBlock}

AI Response:
"""
${responseText.slice(0, 1500)}
"""

List ONLY concrete factual errors (wrong address/location, fabricated services not offered, made-up reviews/ratings, wrong website URL, confused with a different business). Ignore subjective claims or opinions.

Respond with ONLY valid JSON:
{"issues": ["issue 1", "issue 2"]}
If no issues found: {"issues": []}`;
};

export async function detectHallucinations(
  businessFacts: {
    name: string;
    location: string | null;
    website: string | null;
    services: string | null;
  },
  responseText: string,
  platform: string,
): Promise<{ hasHallucinations: boolean; issues: string[] }> {
  const priority = ["google", "openai", "anthropic", "perplexity"];
  const sortedKeys = [...analysisKeys].sort((a, b) => {
    return priority.indexOf(a.provider) - priority.indexOf(b.provider);
  });

  const prompt = HALLUCINATION_PROMPT(businessFacts.name, businessFacts, responseText, platform);

  for (const key of sortedKeys) {
    try {
      let analysisText = "";

      if (key.provider === "google") {
        const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are a precise JSON-only fact-checking tool. Respond with valid JSON only, no markdown, no explanation." }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0 },
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      } else if (key.provider === "openai") {
        const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_completion_tokens: 256,
            temperature: 0,
            messages: [
              { role: "system", content: "You are a precise JSON-only fact-checking tool. Respond with valid JSON only, no markdown, no explanation." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = data.choices?.[0]?.message?.content ?? "";
      } else if (key.provider === "anthropic") {
        const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
            temperature: 0,
            system: "You are a precise JSON-only fact-checking tool. Respond with valid JSON only, no markdown, no explanation.",
            messages: [{ role: "user", content: prompt }],
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = Array.isArray(data.content)
          ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
          : "";
      } else if (key.provider === "perplexity") {
        const res = await fetchWithRetry("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sonar",
            max_tokens: 256,
            temperature: 0,
            messages: [
              { role: "system", content: "You are a precise JSON-only fact-checking tool. Respond with valid JSON only, no markdown, no explanation." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = data.choices?.[0]?.message?.content ?? "";
      }

      // Parse JSON from response (strip markdown code fences if present)
      const cleaned = analysisText.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      const issues: string[] = Array.isArray(parsed.issues)
        ? parsed.issues.filter((i: unknown) => typeof i === "string" && i.length > 0)
        : [];

      return { hasHallucinations: issues.length > 0, issues };
    } catch (err: any) {
      console.error(`[Hallucination Detection] ${key.provider} failed:`, err.message);
      continue;
    }
  }

  // Fallback: if all providers fail, assume no hallucinations
  console.warn("[Hallucination Detection] All providers failed — returning clean");
  return { hasHallucinations: false, issues: [] };
}

// ── Citation Verification ──────────────────────────────────────────────────
// For grounded platforms (Perplexity, Gemini), verify that cited URLs actually exist.
export async function verifyCitations(responseText: string, businessName: string): Promise<{ verified: number; failed: number; urls: { url: string; valid: boolean }[] }> {
  const urlRegex = /https?:\/\/[^\s\)\]"'<>]+/g;
  const urls = [...new Set(responseText.match(urlRegex) || [])].slice(0, 5);
  if (urls.length === 0) return { verified: 0, failed: 0, urls: [] };

  const results: { url: string; valid: boolean }[] = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0)" },
        signal: AbortSignal.timeout(5000),
        redirect: "follow",
      });
      results.push({ url, valid: res.status < 400 });
    } catch {
      results.push({ url, valid: false });
    }
  }
  return { verified: results.filter(r => r.valid).length, failed: results.filter(r => !r.valid).length, urls: results };
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
    const analysis = analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("openai", "success", Date.now() - startTime);
    return { platform: "ChatGPT", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
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
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
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
    // Extract text blocks from response (may contain tool_use and text blocks)
    const responseText = Array.isArray(data.content)
      ? data.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n")
      : "";
    const analysis = analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("anthropic", "success", Date.now() - startTime);
    return { platform: "Claude", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
  } catch (err: any) {
    healthCallback?.("anthropic", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryGemini(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    // Google Search grounding — matches what real Gemini users see
    // No system instruction — real users don't have one
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // Gemini may return multiple parts when grounded; concatenate all text parts
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const responseText = parts.filter((p: any) => p.text).map((p: any) => p.text).join("\n") || "";
    const analysis = analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("google", "success", Date.now() - startTime);
    return { platform: "Google Gemini", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
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
    const analysis = analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("perplexity", "success", Date.now() - startTime);
    return { platform: "Perplexity", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
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

// Estimated cost per API call (input + output for ~1024 tokens)
// These are conservative estimates based on 2026 pricing
export const PROVIDER_COST_PER_CALL: Record<string, number> = {
  openai: 0.025,      // gpt-4o-mini + web_search_preview ($25/1K calls)
  anthropic: 0.008,   // claude-sonnet-4 + web_search tool
  google: 0.004,      // gemini-2.0-flash + google_search grounding (~$14-35/1K)
  perplexity: 0.005,  // sonar-pro (web search built-in)
};

// ── Cross-Platform Validation ──────────────────────────────────────────────
// After collecting results for a single query across all platforms, compare
// them. If the majority agree on mention/no-mention, results that align get
// crossValidated = true (boosted confidence). Outliers get crossValidated = false
// and their confidence is downgraded.
function crossValidateResults(results: AIQueryResult[]): AIQueryResult[] {
  if (results.length < 2) return results; // can't validate with <2 platforms

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

export async function* runScan(
  businessName: string,
  queries: string[],
  keys: { provider: string; apiKey: string }[],
  extraTerms?: string[],
  businessContext?: { location?: string | null; website?: string | null; services?: string | null; industry?: string | null }
): AsyncGenerator<AIQueryResult> {
  const RUNS_PER_QUERY = 1; // Single run — deterministic text matching doesn't need averaging

  for (const query of queries) {
    // Run all platforms × all runs in parallel for speed
    const runPromises = Array.from({ length: RUNS_PER_QUERY }, (_, run) => {
      const platformPromises = keys.map(async (key) => {
        const fn = PROVIDER_FN[key.provider];
        if (!fn) return null;
        try {
          const result = await fn(key.apiKey, query, businessName, extraTerms, businessContext);
          if (isGenericResponse(result.responseText)) {
            console.log(`[Scan] Generic response detected from ${result.platform} for "${query}" (run ${run + 1})`);
            result.confidence = "low";
          }
          return result;
        } catch (err: any) {
          console.error(`[AI Scan] ${key.provider} run ${run + 1} failed for query "${query}":`, err.message);
          return null;
        }
      });
      return Promise.all(platformPromises).then(results => results.filter((r): r is AIQueryResult => r !== null));
    });

    const allRuns = await Promise.all(runPromises);

    // Average results per platform across runs
    const platformResults = new Map<string, AIQueryResult[]>();
    for (const runResults of allRuns) {
      for (const result of runResults) {
        if (!platformResults.has(result.platform)) platformResults.set(result.platform, []);
        platformResults.get(result.platform)!.push(result);
      }
    }

    const averaged: AIQueryResult[] = [];
    for (const [platform, results] of platformResults) {
      if (results.length === 0) continue;

      // Mentioned if ANY run detected the name (avoids false negatives from even-count majority vote)
      const mentionedCount = results.filter(r => r.mentioned).length;
      const mentioned = mentionedCount >= 1;

      // Average position (only from runs where mentioned)
      const positions = results.filter(r => r.mentioned && r.position !== null).map(r => r.position!);
      const avgPosition = positions.length > 0 ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : null;

      // Majority vote on sentiment
      const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
      for (const r of results) sentimentCounts[r.sentiment]++;
      const sentiment = (Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0][0]) as "positive" | "neutral" | "negative";

      // If runs disagree on mentioned, lower confidence
      const allAgree = results.every(r => r.mentioned === mentioned);
      let confidence = results[0].confidence;
      if (!allAgree) confidence = confidence === "high" ? "medium" : "low";

      // Use the longest response text (most informative)
      const bestResponse = [...results].sort((a, b) => b.responseText.length - a.responseText.length)[0];

      averaged.push({
        platform, query,
        responseText: bestResponse.responseText,
        mentioned, sentiment, confidence,
        position: avgPosition,
        sourceType: results[0].sourceType,
        crossValidated: null,
      });
    }

    // Cross-validate the averaged batch, then yield
    const validated = crossValidateResults(averaged);
    const mentionedInQuery = validated.filter(r => r.mentioned).length;
    console.log(`[Scan] Query "${query.substring(0, 60)}..." → ${mentionedInQuery}/${validated.length} platforms mentioned`);
    for (const result of validated) {
      yield result;
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
