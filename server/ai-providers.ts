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

function analyzeMention(responseText: string, businessName: string): { mentioned: boolean; position: number | null; sentiment: "positive" | "neutral" | "negative" } {
  const lowerResponse = responseText.toLowerCase();
  const lowerName = businessName.toLowerCase();
  const mentioned = lowerResponse.includes(lowerName);

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
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content: query }],
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
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: query }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const responseText = data.content?.[0]?.text ?? "";
  const analysis = analyzeMention(responseText, businessName);

  return {
    platform: "Claude",
    query,
    responseText,
    ...analysis,
  };
}

async function queryGemini(apiKey: string, query: string, businessName: string): Promise<AIQueryResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
      messages: [{ role: "user", content: query }],
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
  const queries: string[] = [
    `What are the best ${industry.toLowerCase()} businesses${location ? ` in ${location}` : ""}?`,
    `Can you recommend ${businessName}?`,
    `${businessName} reviews and reputation`,
    `Compare ${businessName} to other ${industry.toLowerCase()} options`,
    `Is ${businessName} worth it?`,
  ];

  if (location) {
    queries.push(`Best ${industry.toLowerCase()} near ${location}`);
    queries.push(`Top rated ${industry.toLowerCase()} in ${location}`);
  } else {
    queries.push(`Top ${industry.toLowerCase()} companies to consider`);
  }

  return queries;
}
