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

// System instruction sent with every query to reduce hallucination.
// Models are told to explicitly decline rather than fabricate business details.
const SYSTEM_INSTRUCTION = "You are answering questions about real-world businesses. Base your answer only on verified, factual information. If you do not have reliable, specific information about a business being asked about, respond with 'No verified information available' and briefly explain what you do and don't know. Do not guess, fabricate details, or invent reviews, ratings, addresses, or services. It is better to say you don't know than to make something up.";

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

const ANALYSIS_PROMPT = (businessName: string, query: string, responseText: string) => `You are analyzing an AI response to determine if it genuinely mentions and recommends a specific business.

Business name: "${businessName}"
Original query: "${query}"

AI Response to analyze:
"""
${responseText.slice(0, 2000)}
"""

Answer these questions about the response above:
1. Does the response genuinely mention "${businessName}" as a real recommendation (not just echoing the question, saying "I don't know about them", or confusing it with a different business)?
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

async function analyzeWithAI(businessName: string, query: string, responseText: string): Promise<AnalysisResult> {
  // Try to use the cheapest available model for analysis
  // Priority: Google (cheapest) > OpenAI > Anthropic > Perplexity
  const priority = ["google", "openai", "anthropic", "perplexity"];
  const sortedKeys = [...analysisKeys].sort((a, b) => {
    return priority.indexOf(a.provider) - priority.indexOf(b.provider);
  });

  const prompt = ANALYSIS_PROMPT(businessName, query, responseText);

  for (const key of sortedKeys) {
    try {
      let analysisText = "";

      if (key.provider === "google") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are a precise JSON-only analysis tool. Respond with valid JSON only, no markdown, no explanation." }] },
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      } else if (key.provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_completion_tokens: 256,
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
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
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
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sonar",
            max_tokens: 256,
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
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: "You are a precise JSON-only fact-checking tool. Respond with valid JSON only, no markdown, no explanation." }] },
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });
        if (!res.ok) continue;
        const data = await res.json();
        analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      } else if (key.provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            max_completion_tokens: 256,
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
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 256,
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
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "sonar",
            max_tokens: 256,
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

async function queryOpenAI(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_completion_tokens: 1024,
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
  const analysis = await analyzeWithAI(businessName, query, responseText);

  return { platform: "ChatGPT", query, responseText, ...analysis, sourceType: "knowledge" as const, crossValidated: null };
}

async function queryAnthropic(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
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
  const analysis = await analyzeWithAI(businessName, query, responseText);

  return { platform: "Claude", query, responseText, ...analysis, sourceType: "knowledge" as const, crossValidated: null };
}

async function queryGemini(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{ parts: [{ text: query }] }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const analysis = await analyzeWithAI(businessName, query, responseText);

  // Gemini has access to web search / grounding by default
  return { platform: "Google Gemini", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
}

async function queryPerplexity(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      max_tokens: 1024,
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
  const analysis = await analyzeWithAI(businessName, query, responseText);

  // Perplexity always searches the web in real-time
  return { platform: "Perplexity", query, responseText, ...analysis, sourceType: "grounded" as const, crossValidated: null };
}

const PROVIDER_FN: Record<string, (apiKey: string, query: string, businessName: string, extraTerms?: string[]) => Promise<AIQueryResult>> = {
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
  extraTerms?: string[]
): AsyncGenerator<AIQueryResult> {
  for (const query of queries) {
    // Collect all platform results for this query before yielding
    const batchResults: AIQueryResult[] = [];

    for (const key of keys) {
      const fn = PROVIDER_FN[key.provider];
      if (!fn) continue;
      try {
        const result = await fn(key.apiKey, query, businessName, extraTerms);
        batchResults.push(result);
      } catch (err: any) {
        console.error(`[AI Scan] ${key.provider} failed for query "${query}":`, err.message);
      }
    }

    // Cross-validate the batch, then yield each validated result
    const validated = crossValidateResults(batchResults);
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
  const locStr = location ? ` in ${location}` : "";
  const prompt = `List the top 5 real, well-known competitors to "${businessName}" in the ${industry} industry${locStr}. Return ONLY a comma-separated list of business names, nothing else. If you don't know the specific business, list the top 5 well-known ${industry} businesses${locStr} instead. Example format: "Company A, Company B, Company C, Company D, Company E"`;

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
  const discovery: string[] = [
    `What are the best ${ind} businesses${loc ? ` in ${loc}` : ""}?`,
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
  const competitorQueries: string[] = [
    `Compare ${name} to other ${ind} options`,
    `${name} vs competitors — which is better?`,
  ];
  for (const comp of competitorsList.slice(0, 3)) {
    competitorQueries.push(`${name} vs ${comp} — which is better?`);
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
  const longTail: string[] = [
    `affordable ${ind} services with good customer support`,
    `how to choose a reliable ${ind} business`,
    `${ind} services that are worth the price`,
  ];

  // ── Seasonal / trending ───────────────────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const seasonal: string[] = [
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
