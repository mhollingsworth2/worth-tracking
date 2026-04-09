export interface AIQueryResult {
  platform: string;
  query: string;
  responseText: string;
  mentioned: boolean;
  sentiment: "positive" | "neutral" | "negative";
  position: number | null;
}

const POSITIVE_WORDS = ["recommend", "great", "excellent", "top", "best", "quality", "trusted", "outstanding", "popular", "leading", "reliable", "impressive"];
const NEGATIVE_WORDS = ["avoid", "poor", "issues", "complaints", "problems", "concerns", "disappointing", "unreliable", "worst", "negative"];

// Phrases that indicate the model doesn't actually have information about the business.
// If any of these appear, don't count the response as a real "mention" even if the
// business name was echoed from the prompt itself.
const NO_KNOWLEDGE_PHRASES = [
  "i don't have",
  "i do not have",
  "i'm not aware",
  "i am not aware",
  "no information",
  "not in my training",
  "not familiar with",
  "cannot find",
  "can't find",
  "no verified information",
  "unable to find",
  "don't have reliable",
  "no reliable information",
  "i'm not sure",
  "i cannot confirm",
  "no specific information",
];

// System instruction sent with every query to reduce hallucination.
// Models are told to explicitly decline rather than fabricate business details.
const SYSTEM_INSTRUCTION = "You are answering questions about real-world businesses. Base your answer only on verified, factual information. If you do not have reliable, specific information about a business being asked about, respond with 'No verified information available' and briefly explain what you do and don't know. Do not guess, fabricate details, or invent reviews, ratings, addresses, or services. It is better to say you don't know than to make something up.";

function analyzeMention(responseText: string, businessName: string, extraTerms?: string[]): { mentioned: boolean; position: number | null; sentiment: "positive" | "neutral" | "negative" } {
  const lowerResponse = responseText.toLowerCase();
  const lowerName = businessName.toLowerCase();

  // If the response explicitly says the model has no knowledge, treat as not mentioned
  // regardless of whether the business name appears (it was just echoed from the prompt).
  const hasNoKnowledge = NO_KNOWLEDGE_PHRASES.some(phrase => lowerResponse.includes(phrase));

  // Primary match: business name. Secondary: services/keywords with 2+ word overlap.
  let nameMentioned = !hasNoKnowledge && lowerResponse.includes(lowerName);

  // Also check extra terms (services, keywords) — but only multi-word ones to avoid
  // false positives from generic single words like "cleaning".
  if (!nameMentioned && !hasNoKnowledge && extraTerms) {
    for (const term of extraTerms) {
      const lower = term.toLowerCase().trim();
      if (lower.split(/\s+/).length >= 2 && lowerResponse.includes(lower)) {
        nameMentioned = true;
        break;
      }
    }
  }

  const mentioned = nameMentioned;

  let position: number | null = null;
  if (mentioned) {
    const sentences = responseText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i].toLowerCase();
      if (s.includes(lowerName)) {
        position = i + 1;
        break;
      }
      // Check multi-word extra terms for position too
      if (extraTerms) {
        for (const term of extraTerms) {
          const lower = term.toLowerCase().trim();
          if (lower.split(/\s+/).length >= 2 && s.includes(lower)) {
            position = i + 1;
            break;
          }
        }
        if (position !== null) break;
      }
    }
  }

  const positiveCount = POSITIVE_WORDS.filter(w => lowerResponse.includes(w)).length;
  const negativeCount = NEGATIVE_WORDS.filter(w => lowerResponse.includes(w)).length;
  let sentiment: "positive" | "neutral" | "negative" = "neutral";
  if (positiveCount > negativeCount) sentiment = "positive";
  else if (negativeCount > positiveCount) sentiment = "negative";

  return { mentioned, position, sentiment };
}

async function queryOpenAI(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  // Note: gpt-5-mini on chat/completions does not include built-in web search.
  // Live-web answers come from Claude/Gemini/Perplexity; here we rely on the
  // system instruction to discourage hallucination.
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
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
  const analysis = analyzeMention(responseText, businessName, extraTerms);

  return {
    platform: "ChatGPT",
    query,
    responseText,
    ...analysis,
  };
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
  // Concatenate all text blocks (content is an array).
  const responseText = Array.isArray(data.content)
    ? data.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("\n")
    : "";
  const analysis = analyzeMention(responseText, businessName, extraTerms);

  return {
    platform: "Claude",
    query,
    responseText,
    ...analysis,
  };
}

async function queryGemini(apiKey: string, query: string, businessName: string, extraTerms?: string[]): Promise<AIQueryResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
      contents: [{ parts: [{ text: query }] }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const analysis = analyzeMention(responseText, businessName, extraTerms);

  return {
    platform: "Google Gemini",
    query,
    responseText,
    ...analysis,
  };
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
  const analysis = analyzeMention(responseText, businessName, extraTerms);

  return {
    platform: "Perplexity",
    query,
    responseText,
    ...analysis,
  };
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

export async function* runScan(
  businessName: string,
  queries: string[],
  keys: { provider: string; apiKey: string }[],
  extraTerms?: string[]
): AsyncGenerator<AIQueryResult> {
  for (const query of queries) {
    for (const key of keys) {
      const fn = PROVIDER_FN[key.provider];
      if (!fn) continue;
      try {
        const result = await fn(key.apiKey, query, businessName, extraTerms);
        yield result;
      } catch (err: any) {
        console.error(`[AI Scan] ${key.provider} failed for query "${query}":`, err.message);
      }
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

  // Combine all categories, deduplicate, and cap at 25
  const all = [
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

  return unique.slice(0, 25);
}
