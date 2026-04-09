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

// System instruction sent with every query to reduce hallucination.
// Models are told to explicitly decline rather than fabricate business details.
// System instruction: be helpful and natural — we WANT to see what AI actually says
// about businesses. The hallucination detector catches fabrications after the fact.
const SYSTEM_INSTRUCTION = "You are a helpful assistant answering questions about local businesses and services. Provide your best, most useful recommendations based on what you know. Include specific business names, locations, and details when you can. Be thorough and give actionable recommendations.";

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

const ANALYSIS_PROMPT = (businessName: string, query: string, responseText: string, businessContext?: { location?: string | null; website?: string | null; services?: string | null }) => `You are analyzing an AI response to determine if it genuinely mentions and recommends a specific business.

Business name: "${businessName}"
Original query: "${query}"
${businessContext?.location || businessContext?.website || businessContext?.services ? `
IMPORTANT — verify this is the CORRECT "${businessName}":
${businessContext.location ? `- Must be located in/near: ${businessContext.location}` : ""}
${businessContext.website ? `- Website should be: ${businessContext.website}` : ""}
${businessContext.services ? `- Offers these services: ${businessContext.services}` : ""}
If the response mentions a different "${businessName}" (wrong city, different services, different website), mark as NOT mentioned.` : ""}

AI Response to analyze:
"""
${responseText.slice(0, 2000)}
"""

Answer these questions about the response above:
1. Does the response genuinely mention the SPECIFIC "${businessName}" that matches the business details above (not a different business with the same or similar name)?
2. If mentioned, what position in a list does it appear? (1 = first mentioned, 2 = second, etc. null if not in a list)
3. What is the overall sentiment toward "${businessName}"? (positive = recommended/praised, neutral = just mentioned factually, negative = warned against/criticized)
4. How confident are you in this analysis? (high = clearly mentioned or clearly not, medium = somewhat ambiguous, low = very unclear)

Respond with ONLY valid JSON, no other text:
{"mentioned": true/false, "position": number or null, "sentiment": "positive"/"neutral"/"negative", "confidence": "high"/"medium"/"low"}`;

// Keys available for analysis calls (populated from active API keys)
let analysisKeys: { provider: string; apiKey: string }[] = [];

export function setAnalysisKeys(keys: { provider: string; apiKey: string }[]) {
  analysisKeys = keys;
}

async function analyzeWithAI(businessName: string, query: string, responseText: string, businessContext?: { location?: string | null; website?: string | null; services?: string | null }): Promise<AnalysisResult> {
  // Try to use the cheapest available model for analysis
  // Priority: Google (cheapest) > OpenAI > Anthropic > Perplexity
  const priority = ["google", "openai", "anthropic", "perplexity"];
  const sortedKeys = [...analysisKeys].sort((a, b) => {
    return priority.indexOf(a.provider) - priority.indexOf(b.provider);
  });

  const prompt = ANALYSIS_PROMPT(businessName, query, responseText, businessContext);

  for (const key of sortedKeys) {
    try {
      let analysisText = "";

      if (key.provider === "google") {
        const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are a precise JSON-only analysis tool. Respond with valid JSON only, no markdown, no explanation." }] },
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
              { role: "system", content: "You are a precise JSON-only analysis tool. Respond with valid JSON only, no markdown, no explanation." },
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
            system: "You are a precise JSON-only analysis tool. Respond with valid JSON only, no markdown, no explanation.",
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
              { role: "system", content: "You are a precise JSON-only analysis tool. Respond with valid JSON only, no markdown, no explanation." },
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

      return {
        mentioned: !!parsed.mentioned,
        sentiment: ["positive", "neutral", "negative"].includes(parsed.sentiment) ? parsed.sentiment : "neutral",
        confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
        position: typeof parsed.position === "number" ? parsed.position : null,
      };
    } catch (err: any) {
      console.error(`[AI Analysis] ${key.provider} failed:`, err.message);
      continue;
    }
  }

  // Fallback: if all AI analysis calls fail, use basic heuristic
  console.warn("[AI Analysis] All providers failed — using basic fallback");
  return fallbackAnalysis(businessName, responseText);
}

// Minimal fallback if no AI provider is available for analysis
function fallbackAnalysis(businessName: string, responseText: string): AnalysisResult {
  const lower = responseText.toLowerCase();
  const nameLower = businessName.toLowerCase();

  const noKnowledge = ["i don't have", "i do not have", "no verified information", "not familiar with", "no information"].some(p => lower.includes(p));
  const mentioned = !noKnowledge && lower.includes(nameLower);

  let position: number | null = null;
  if (mentioned) {
    const sentences = responseText.split(/[.!?\n]+/).filter(s => s.trim().length > 0);
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].toLowerCase().includes(nameLower)) { position = i + 1; break; }
    }
  }

  const posWords = ["recommend", "great", "excellent", "best", "quality", "trusted", "leading", "reliable"];
  const negWords = ["avoid", "poor", "issues", "complaints", "problems", "disappointing", "unreliable"];
  const pos = posWords.filter(w => lower.includes(w)).length;
  const neg = negWords.filter(w => lower.includes(w)).length;
  const sentiment = pos > neg ? "positive" : neg > pos ? "negative" : "neutral";

  return { mentioned, sentiment, confidence: "low", position };
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

async function queryOpenAI(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    const res = await fetchWithRetry("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_completion_tokens: 1024,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: query },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const responseText = data.choices?.[0]?.message?.content ?? "";
    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("openai", "success", Date.now() - startTime);
    return { platform: "ChatGPT", query, responseText, ...analysis, sourceType: "knowledge" as const, crossValidated: null };
  } catch (err: any) {
    healthCallback?.("openai", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryAnthropic(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        temperature: 0,
        system: SYSTEM_INSTRUCTION,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const responseText = Array.isArray(data.content)
      ? data.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n")
      : "";
    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("anthropic", "success", Date.now() - startTime);
    return { platform: "Claude", query, responseText, ...analysis, sourceType: "knowledge" as const, crossValidated: null };
  } catch (err: any) {
    healthCallback?.("anthropic", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryGemini(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { temperature: 0 },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("google", "success", Date.now() - startTime);
    return { platform: "Google Gemini", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
  } catch (err: any) {
    healthCallback?.("google", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

async function queryPerplexity(apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null }): Promise<AIQueryResult> {
  const startTime = Date.now();
  try {
    const res = await fetchWithRetry("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 1024,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
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
    const analysis = await analyzeWithAI(businessName, query, responseText, businessContext);

    healthCallback?.("perplexity", "success", Date.now() - startTime);
    return { platform: "Perplexity", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
  } catch (err: any) {
    healthCallback?.("perplexity", "error", Date.now() - startTime, err.message);
    throw err;
  }
}

const PROVIDER_FN: Record<string, (apiKey: string, query: string, businessName: string, extraTerms?: string[], businessContext?: { location?: string | null; website?: string | null; services?: string | null }) => Promise<AIQueryResult>> = {
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
  openai: 0.003,      // gpt-4o-mini: ~$0.15/1M input + $0.60/1M output
  anthropic: 0.004,   // claude-3-5-haiku: ~$0.25/1M input + $1.25/1M output
  google: 0.001,      // gemini-2.0-flash: ~$0.10/1M input + $0.40/1M output
  perplexity: 0.005,  // sonar: ~$1/1M input + $1/1M output
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
  businessContext?: { location?: string | null; website?: string | null; services?: string | null }
): AsyncGenerator<AIQueryResult> {
  const RUNS_PER_QUERY = 2; // Run each query 2x per platform for stability

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

      // Majority vote on mentioned
      const mentionedCount = results.filter(r => r.mentioned).length;
      const mentioned = mentionedCount > results.length / 2;

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
    for (const result of validated) {
      yield result;
    }
  }
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
        `What are the best ${ind} businesses in ${loc}?`,
        `Top rated ${ind} companies in ${loc} area`,
        `Which ${ind} provider should I choose in ${loc}?`,
        `Most recommended ${ind} options near ${loc}`,
      ]
    : [
        `What are the best ${ind} businesses?`,
        `Top rated ${ind} companies to consider this year`,
        `Which ${ind} provider should I choose?`,
        `Most recommended ${ind} options available right now`,
      ];

  // ── Service-specific queries ──────────────────────────────────────────────
  const serviceQueries: string[] = [];
  for (const svc of servicesList.slice(0, 4)) {
    serviceQueries.push(`best ${svc} services${loc ? ` in ${loc}` : ""}`);
    serviceQueries.push(`who offers ${svc}${loc ? ` near ${loc}` : ""}?`);
  }

  // ── Keyword-driven queries ────────────────────────────────────────────────
  const keywordQueries: string[] = [];
  for (const kw of keywordsList.slice(0, 4)) {
    keywordQueries.push(`${kw} ${ind}${loc ? ` in ${loc}` : ""}`);
  }

  // ── Audience-specific queries ─────────────────────────────────────────────
  const audienceQueries: string[] = [];
  for (const aud of audienceList.slice(0, 3)) {
    audienceQueries.push(`best ${ind} for ${aud}${loc ? ` in ${loc}` : ""}`);
  }

  // ── Competitor comparison queries ─────────────────────────────────────────
  const competitorQueries: string[] = loc
    ? [
        `Compare ${name} to other ${ind} options in ${loc}`,
        `${name} vs competitors in ${loc} — which is better?`,
      ]
    : [
        `Compare ${name} to other ${ind} options`,
        `${name} vs competitors — which is better?`,
      ];
  for (const comp of competitorsList.slice(0, 3)) {
    competitorQueries.push(`${name} vs ${comp}${loc ? ` in ${loc}` : ""} — which is better?`);
  }

  // ── Review / reputation queries (intent: validate trust) ─────────────────
  const review: string[] = [
    `${name} reviews and reputation`,
    `Is ${name} worth it?`,
    `What do customers say about ${name}?`,
    `Problems or complaints about ${name}`,
  ];

  // ── Local queries (intent: find nearby) ──────────────────────────────────
  const local: string[] = loc
    ? [
        `Best ${ind} near ${loc}`,
        `Top rated ${ind} in ${loc}`,
        `Highly reviewed ${ind} services in ${loc}`,
      ]
    : [
        `${ind} businesses near me`,
        `Local ${ind} providers with good reviews`,
      ];

  // ── Long-tail / intent queries ────────────────────────────────────────────
  const longTail: string[] = loc
    ? [
        `affordable ${ind} services in ${loc} with good customer support`,
        `how to choose a reliable ${ind} business in ${loc}`,
        `${ind} services in ${loc} that are worth the price`,
      ]
    : [
        `affordable ${ind} services with good customer support`,
        `how to choose a reliable ${ind} business`,
        `${ind} services that are worth the price`,
      ];

  // ── Seasonal / trending ───────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const seasonal: string[] = loc
    ? [
        `best ${ind} businesses in ${loc} in ${currentYear}`,
        `${name} — is it still a good choice in ${currentYear}?`,
      ]
    : [
        `best ${ind} businesses in ${currentYear}`,
        `${name} — is it still a good choice in ${currentYear}?`,
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
