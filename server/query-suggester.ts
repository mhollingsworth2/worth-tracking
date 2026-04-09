/**
 * Query Suggester — generates high-value custom queries for a business.
 *
 * Combines website keywords, scan result patterns, and competitor visibility
 * data to surface the most relevant queries to track.
 */

import type { SearchRecord } from "@shared/schema";

export interface QuerySuggestion {
  query: string;
  reason: string;
  category: "service" | "location" | "question" | "competitor" | "trending";
  score: number; // 0-100
}

export interface SuggestResult {
  suggestions: QuerySuggestion[];
}

// ── Template banks ────────────────────────────────────────────────────────────

const QUESTION_TEMPLATES = [
  "best {service} near me",
  "top {service} in {location}",
  "affordable {service} {location}",
  "{service} company {location}",
  "how to choose a {service} provider",
  "what does {service} cost",
  "is {service} worth it",
  "{service} reviews {location}",
  "local {service} experts",
  "trusted {service} {location}",
  "professional {service} services",
  "{service} specialists near me",
  "compare {service} companies",
  "best {service} for small business",
  "enterprise {service} solutions",
];

const HOW_TO_TEMPLATES = [
  "how to improve {keyword}",
  "how to find a good {keyword} company",
  "what is {keyword}",
  "why is {keyword} important",
  "benefits of {keyword}",
  "{keyword} tips and best practices",
  "common {keyword} mistakes to avoid",
];

function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? key);
}

// ── Analyse existing scan records ─────────────────────────────────────────────

interface QueryStats {
  query: string;
  runs: number;
  mentions: number;
  mentionRate: number;
}

function analyseRecords(records: SearchRecord[]): {
  highMention: QueryStats[];
  lowMention: QueryStats[];
  competitorQueries: string[];
} {
  const map = new Map<string, { runs: number; mentions: number }>();
  for (const r of records) {
    const s = map.get(r.query) ?? { runs: 0, mentions: 0 };
    s.runs++;
    if (r.mentioned) s.mentions++;
    map.set(r.query, s);
  }

  const stats: QueryStats[] = [...map.entries()].map(([query, s]) => ({
    query,
    runs: s.runs,
    mentions: s.mentions,
    mentionRate: s.runs > 0 ? Math.round((s.mentions / s.runs) * 100) : 0,
  }));

  const highMention = stats
    .filter((s) => s.mentionRate >= 50)
    .sort((a, b) => b.mentionRate - a.mentionRate)
    .slice(0, 5);

  const lowMention = stats
    .filter((s) => s.mentionRate < 30 && s.runs >= 2)
    .sort((a, b) => a.mentionRate - b.mentionRate)
    .slice(0, 5);

  // Queries where competitors are likely mentioned (low mention rate = opportunity)
  const competitorQueries = lowMention.map((s) => s.query);

  return { highMention, lowMention, competitorQueries };
}

// ── Main suggester ────────────────────────────────────────────────────────────

export function suggestQueries(
  businessData: {
    name: string;
    industry: string;
    location?: string | null;
    description?: string;
  },
  websiteKeywords: string[],
  scanRecords: SearchRecord[]
): SuggestResult {
  const suggestions: QuerySuggestion[] = [];
  const seen = new Set<string>();

  const industry = businessData.industry ?? "";
  const location = businessData.location ?? "";
  const name = businessData.name ?? "";

  function add(
    query: string,
    reason: string,
    category: QuerySuggestion["category"],
    score: number
  ) {
    const normalised = query.toLowerCase().trim();
    if (seen.has(normalised) || normalised.length < 5) return;
    seen.add(normalised);
    suggestions.push({ query: query.trim(), reason, category, score });
  }

  // 1. Service + location templates using industry
  for (const tpl of QUESTION_TEMPLATES.slice(0, 8)) {
    const q = fillTemplate(tpl, { service: industry, location });
    add(q, "Industry + location combination", "service", 80);
  }

  // 2. Website keyword-driven queries
  for (const kw of websiteKeywords.slice(0, 10)) {
    add(
      `best ${kw} services`,
      `Keyword "${kw}" found on your website`,
      "service",
      70
    );
    for (const tpl of HOW_TO_TEMPLATES.slice(0, 3)) {
      const q = fillTemplate(tpl, { keyword: kw });
      add(q, `How-to query for "${kw}"`, "question", 65);
    }
  }

  // 3. Business name queries
  add(`${name} reviews`, "Brand reputation query", "service", 90);
  add(`${name} vs competitors`, "Competitive comparison", "competitor", 85);
  add(`alternatives to ${name}`, "Competitor discovery", "competitor", 75);

  // 4. High-performing existing queries → suggest variations
  const { highMention, lowMention, competitorQueries } = analyseRecords(scanRecords);

  for (const s of highMention) {
    add(
      `${s.query} near me`,
      `Variation of high-performing query (${s.mentionRate}% mention rate)`,
      "location",
      88
    );
  }

  // 5. Low-mention queries → suggest content to fill gaps
  for (const s of lowMention) {
    add(
      `how to choose ${industry} services`,
      `You're missing on "${s.query}" — content gap opportunity`,
      "question",
      72
    );
  }

  // 6. Competitor-focused queries
  for (const q of competitorQueries.slice(0, 3)) {
    add(
      `${industry} company ${location}`,
      `Competitors appear on "${q}" — track this`,
      "competitor",
      78
    );
  }

  // 7. Question-format queries
  add(`what is the best ${industry} company`, "Common AI question format", "question", 76);
  add(`who are the top ${industry} providers`, "AI list-style query", "question", 74);
  add(`${industry} cost ${location}`, "Pricing intent query", "service", 73);
  add(`${industry} services for small business`, "SMB segment query", "service", 71);

  // Sort by score descending, return top 20
  suggestions.sort((a, b) => b.score - a.score);

  return { suggestions: suggestions.slice(0, 20) };
}
