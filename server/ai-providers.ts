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

function analyzeMention(responseText: string, businessName: string): { mentioned: boolean; position: number | null; sentiment: "positive" | "neutral" | "negative" } {
  const lowerResponse = responseText.toLowerCase();
  const lowerName = businessName.toLowerCase();

  // If the response explicitly says the model has no knowledge, treat as not mentioned
  // regardless of whether the business name appears (it was just echoed from the prompt).
  const hasNoKnowledge = NO_KNOWLEDGE_PHRASES.some(phrase => lowerResponse.includes(phrase));
  const mentioned = !hasNoKnowledge && lowerResponse.includes(lowerName);

  let position: number | null = null;
  if (mentioned) {
    const sentences = responseText.split(/[.!?]+/).filter(s => s.trim().length > 0);
    for (let i = 0; i < sentences.length; i++) {
      if (sentences[i].toLowerCase().includes(lowerName)) {
        position = i + 1;
        break;
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

async function queryOpenAI(apiKey: string, query: string, businessName: string): Promise<AIQueryResult> {
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
  const analysis = analyzeMention(responseText, businessName);

  return {
    platform: "ChatGPT",
    query,
    responseText,
    ...analysis,
  };
}

async function queryAnthropic(apiKey: string, query: string, businessName: string): Promise<AIQueryResult> {
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
  const analysis = analyzeMention(responseText, businessName);

  return {
    platform: "Claude",
    query,
    responseText,
    ...analysis,
  };
}

async function queryGemini(apiKey: string, query: string, businessName: string): Promise<AIQueryResult> {
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
  const analysis = analyzeMention(responseText, businessName);

  return {
    platform: "Google Gemini",
    query,
    responseText,
    ...analysis,
  };
}

async function queryPerplexity(apiKey: string, query: string, businessName: string): Promise<AIQueryResult> {
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
  const analysis = analyzeMention(responseText, businessName);

  return {
    platform: "Perplexity",
    query,
    responseText,
    ...analysis,
  };
}

const PROVIDER_FN: Record<string, (apiKey: string, query: string, businessName: string) => Promise<AIQueryResult>> = {
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
  keys: { provider: string; apiKey: string }[]
): AsyncGenerator<AIQueryResult> {
  for (const query of queries) {
    for (const key of keys) {
      const fn = PROVIDER_FN[key.provider];
      if (!fn) continue;
      try {
        const result = await fn(key.apiKey, query, businessName);
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

export function generateScanQueries(businessName: string, industry: string, location: string | null): string[] {
  const ind = industry.toLowerCase();
  const loc = location ?? null;

  // ── Discovery queries (intent: find options) ──────────────────────────────
  const discovery: string[] = [
    `What are the best ${ind} businesses${loc ? ` in ${loc}` : ""}?`,
    `Top rated ${ind} companies to consider this year`,
    `Which ${ind} provider should I choose?`,
    `Best ${ind} services for small businesses`,
    `Most recommended ${ind} options available right now`,
  ];

  // ── Comparison queries (intent: evaluate alternatives) ────────────────────
  const comparison: string[] = [
    `Compare ${businessName} to other ${ind} options`,
    `${businessName} vs competitors — which is better?`,
    `How does ${businessName} compare to alternatives in ${ind}?`,
    `${ind} provider comparison: pros and cons`,
  ];

  // ── Review / reputation queries (intent: validate trust) ─────────────────
  const review: string[] = [
    `${businessName} reviews and reputation`,
    `Is ${businessName} worth it?`,
    `What do customers say about ${businessName}?`,
    `${businessName} customer feedback and ratings`,
    `Problems or complaints about ${businessName}`,
  ];

  // ── Local queries (intent: find nearby) ──────────────────────────────────
  const local: string[] = loc
    ? [
        `Best ${ind} near ${loc}`,
        `Top rated ${ind} in ${loc}`,
        `${ind} businesses open now in ${loc}`,
        `Highly reviewed ${ind} services in ${loc}`,
      ]
    : [
        `${ind} businesses near me`,
        `Local ${ind} providers with good reviews`,
      ];

  // ── Long-tail queries (3+ words, specific intent) ─────────────────────────
  const longTail: string[] = [
    `affordable ${ind} services with good customer support`,
    `best value ${ind} provider for new customers`,
    `how to choose a reliable ${ind} business`,
    `what to look for when hiring a ${ind} company`,
    `${ind} services that are worth the price`,
  ];

  // ── Seasonal / trending variations ───────────────────────────────────────
  const currentYear = new Date().getFullYear();
  const seasonal: string[] = [
    `best ${ind} businesses in ${currentYear}`,
    `top ${ind} trends and recommendations`,
    `${businessName} — is it still a good choice in ${currentYear}?`,
  ];

  // Combine all categories, deduplicate, and cap at 20
  const all = [
    ...discovery,
    ...comparison,
    ...review,
    ...local,
    ...longTail,
    ...seasonal,
  ];

  // Simple deduplication by normalized string
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const q of all) {
    const key = q.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(q);
    }
  }

  return unique.slice(0, 20);
}
