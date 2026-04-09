/**
 * Prompt Recommendation Engine
 *
 * Analyzes scan data (search_records) for a business and produces ranked
 * recommendations across six categories:
 *   strength   – business already appears in 50%+ of results
 *   opportunity – low mention rate but frequently scanned
 *   trending   – mention rate increasing over the last 7 days
 *   question   – prompt contains how/what/why/when/where/which
 *   competitor – competitors dominate but business doesn't
 *   intent     – high-intent buying-signal keywords
 */

import { db } from "./storage";
import { searchRecords } from "@shared/schema";
import { sql } from "drizzle-orm";

export interface PromptRecommendation {
  prompt: string;
  category: "strength" | "opportunity" | "trending" | "question" | "competitor" | "intent";
  mentionRate: number;   // 0-100
  frequency: number;     // how many times scanned
  score: number;         // 0-100 (higher = more important to act on)
  reason: string;
  suggestedAction: string;
}

export interface RecommendationSummary {
  totalScanned: number;
  strengthCount: number;
  opportunityCount: number;
  trendingCount: number;
  questionCount: number;
  competitorCount: number;
  intentCount: number;
}

export interface AnalysisResult {
  recommendations: PromptRecommendation[];
  summary: RecommendationSummary;
}

// ── Keyword lists ────────────────────────────────────────────────────────────

const QUESTION_WORDS = ["how", "what", "why", "when", "where", "which", "who", "is ", "are ", "can ", "does ", "do "];
const INTENT_WORDS   = ["price", "pricing", "cost", "costs", "review", "reviews", "compare", "comparison", "best", "vs ", "versus", "buy", "hire", "near me", "affordable", "cheap", "top"];

function isQuestion(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return QUESTION_WORDS.some((w) => lower.startsWith(w) || lower.includes(` ${w}`));
}

function isHighIntent(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return INTENT_WORDS.some((w) => lower.includes(w));
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Composite score (0-100).
 *
 * For opportunity/competitor categories the score rewards LOW mention rate
 * combined with HIGH frequency (= big gap to fill).
 * For strength/trending the score rewards HIGH mention rate.
 */
function computeScore(opts: {
  mentionRate: number;
  frequency: number;
  maxFrequency: number;
  recencyBoost: number;   // 0-100
  isQuestion: boolean;
  isIntent: boolean;
  category: PromptRecommendation["category"];
}): number {
  const { mentionRate, frequency, maxFrequency, recencyBoost, isQuestion, isIntent, category } = opts;

  const freqNorm   = maxFrequency > 0 ? Math.min(100, Math.round((frequency / maxFrequency) * 100)) : 0;
  const intentBoost = (isQuestion ? 50 : 0) + (isIntent ? 50 : 0); // 0 | 50 | 100

  let opportunityBoost = 0;
  if (category === "opportunity" || category === "competitor") {
    // Low mention rate + high frequency = high opportunity
    opportunityBoost = Math.round(((100 - mentionRate) * 0.6) + (freqNorm * 0.4));
  }

  const raw =
    (mentionRate  * 0.30) +
    (freqNorm     * 0.20) +
    (recencyBoost * 0.20) +
    (intentBoost  * 0.15) +
    (opportunityBoost * 0.15);

  return Math.min(100, Math.max(0, Math.round(raw)));
}

// ── Main analysis function ───────────────────────────────────────────────────

export async function analyzePrompts(
  businessId: number,
  days = 30,
  limit = 100,
): Promise<AnalysisResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // ── 1. Aggregate per-query stats within the window ───────────────────────
  type QueryRow = {
    query: string;
    total: number;
    mentions: number;
    lastDate: string;
  };

  const rows = db
    .select({
      query:    searchRecords.query,
      total:    sql<number>`count(*)`,
      mentions: sql<number>`sum(${searchRecords.mentioned})`,
      lastDate: sql<string>`max(${searchRecords.date})`,
    })
    .from(searchRecords)
    .where(
      sql`${searchRecords.businessId} = ${businessId}
          AND ${searchRecords.date} >= ${cutoffStr}`,
    )
    .groupBy(searchRecords.query)
    .orderBy(sql`count(*) desc`)
    .limit(limit)
    .all() as QueryRow[];

  if (rows.length === 0) {
    return {
      recommendations: [],
      summary: {
        totalScanned: 0,
        strengthCount: 0,
        opportunityCount: 0,
        trendingCount: 0,
        questionCount: 0,
        competitorCount: 0,
        intentCount: 0,
      },
    };
  }

  const maxFrequency = Math.max(...rows.map((r) => r.total));

  // ── 2. Trending: compare last 7 days vs previous 7 days ─────────────────
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 7);
  const recentCutoffStr = recentCutoff.toISOString().split("T")[0];

  const prevCutoff = new Date();
  prevCutoff.setDate(prevCutoff.getDate() - 14);
  const prevCutoffStr = prevCutoff.toISOString().split("T")[0];

  type PeriodRow = { query: string; mentions: number; total: number };

  const recentRows = db
    .select({
      query:    searchRecords.query,
      mentions: sql<number>`sum(${searchRecords.mentioned})`,
      total:    sql<number>`count(*)`,
    })
    .from(searchRecords)
    .where(
      sql`${searchRecords.businessId} = ${businessId}
          AND ${searchRecords.date} >= ${recentCutoffStr}`,
    )
    .groupBy(searchRecords.query)
    .all() as PeriodRow[];

  const prevRows = db
    .select({
      query:    searchRecords.query,
      mentions: sql<number>`sum(${searchRecords.mentioned})`,
      total:    sql<number>`count(*)`,
    })
    .from(searchRecords)
    .where(
      sql`${searchRecords.businessId} = ${businessId}
          AND ${searchRecords.date} >= ${prevCutoffStr}
          AND ${searchRecords.date} < ${recentCutoffStr}`,
    )
    .groupBy(searchRecords.query)
    .all() as PeriodRow[];

  const recentMap = new Map(recentRows.map((r) => [r.query, r]));
  const prevMap   = new Map(prevRows.map((r) => [r.query, r]));

  const trendingQueries = new Set<string>();
  for (const [query, recent] of recentMap) {
    const recentRate = recent.total > 0 ? (recent.mentions / recent.total) * 100 : 0;
    const prev       = prevMap.get(query);
    const prevRate   = prev && prev.total > 0 ? (prev.mentions / prev.total) * 100 : 0;
    if (recentRate > prevRate + 10) {
      trendingQueries.add(query);
    }
  }

  // ── 3. Build recommendations ─────────────────────────────────────────────
  const recommendations: PromptRecommendation[] = [];
  const usedQueries = new Set<string>(); // each query gets at most one category

  // Helper: recency boost — how recently was this query last scanned?
  function recencyBoost(lastDate: string): number {
    const daysDiff = Math.floor(
      (Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysDiff <= 3)  return 100;
    if (daysDiff <= 7)  return 80;
    if (daysDiff <= 14) return 60;
    if (daysDiff <= 21) return 40;
    return 20;
  }

  for (const row of rows) {
    const mentionRate = row.total > 0 ? Math.round((row.mentions / row.total) * 100) : 0;
    const question    = isQuestion(row.query);
    const intent      = isHighIntent(row.query);
    const trending    = trendingQueries.has(row.query);
    const rb          = recencyBoost(row.lastDate);

    // Priority order: trending > intent > question > strength > opportunity > competitor
    let category: PromptRecommendation["category"] | null = null;

    if (trending && !usedQueries.has(row.query)) {
      category = "trending";
    } else if (intent && !usedQueries.has(row.query)) {
      category = "intent";
    } else if (question && !usedQueries.has(row.query)) {
      category = "question";
    } else if (mentionRate >= 50 && !usedQueries.has(row.query)) {
      category = "strength";
    } else if (mentionRate < 30 && row.total >= 3 && !usedQueries.has(row.query)) {
      category = "opportunity";
    } else if (mentionRate < 40 && !usedQueries.has(row.query)) {
      category = "competitor";
    }

    if (!category) continue;

    usedQueries.add(row.query);

    const score = computeScore({
      mentionRate,
      frequency: row.total,
      maxFrequency,
      recencyBoost: rb,
      isQuestion: question,
      isIntent: intent,
      category,
    });

    const { reason, suggestedAction } = buildReasonAndAction(category, mentionRate, row.total);

    recommendations.push({
      prompt: row.query,
      category,
      mentionRate,
      frequency: row.total,
      score,
      reason,
      suggestedAction,
    });
  }

  // Sort by score descending
  recommendations.sort((a, b) => b.score - a.score);

  const summary: RecommendationSummary = {
    totalScanned: rows.reduce((s, r) => s + r.total, 0),
    strengthCount:   recommendations.filter((r) => r.category === "strength").length,
    opportunityCount: recommendations.filter((r) => r.category === "opportunity").length,
    trendingCount:   recommendations.filter((r) => r.category === "trending").length,
    questionCount:   recommendations.filter((r) => r.category === "question").length,
    competitorCount: recommendations.filter((r) => r.category === "competitor").length,
    intentCount:     recommendations.filter((r) => r.category === "intent").length,
  };

  return { recommendations, summary };
}

// ── Reason / action copy ─────────────────────────────────────────────────────

function buildReasonAndAction(
  category: PromptRecommendation["category"],
  mentionRate: number,
  frequency: number,
): { reason: string; suggestedAction: string } {
  switch (category) {
    case "strength":
      return {
        reason: `You appear in ${mentionRate}% of AI results for this prompt — well above the 50% threshold. You're already winning here.`,
        suggestedAction: "Maintain your visibility. Consider expanding to related prompts or long-tail variations.",
      };

    case "opportunity":
      return {
        reason: `You only appear in ${mentionRate}% of results despite this prompt being scanned ${frequency} time${frequency !== 1 ? "s" : ""}. Competitors are likely filling this gap.`,
        suggestedAction: "Create targeted content for this prompt. Optimize your website copy and structured data to answer this query directly.",
      };

    case "trending":
      return {
        reason: `Your mention rate on this prompt has increased significantly in the last 7 days — momentum is building.`,
        suggestedAction: "Double down on this topic. Publish fresh content, update existing pages, and monitor closely.",
      };

    case "question":
      return {
        reason: `This is a question-format prompt — people are actively asking AI platforms for an answer. You appear in ${mentionRate}% of results.`,
        suggestedAction: "Create an FAQ page, how-to guide, or blog post that directly answers this question. Structured data (FAQ schema) helps AI platforms cite you.",
      };

    case "competitor":
      return {
        reason: `Your mention rate is only ${mentionRate}% on this prompt, suggesting competitors dominate the AI response for this query.`,
        suggestedAction: "Analyse what competitors publish for this topic. Create more authoritative, comprehensive content that AI platforms will prefer to cite.",
      };

    case "intent":
      return {
        reason: `This prompt contains high-intent buying signals (pricing, reviews, comparisons). You appear in ${mentionRate}% of results — every missed mention is a lost lead.`,
        suggestedAction: "Optimise your pricing page, add customer reviews, and create comparison content. Ensure your business details are accurate across all directories.",
      };
  }
}
