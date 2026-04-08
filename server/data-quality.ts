/**
 * Data Quality Metrics Module
 *
 * Tracks data freshness, completeness, duplicates, outliers, and generates
 * per-business quality reports.
 */

import { db } from "./storage";
import {
  searchRecords, referrals, aiSnapshots,
} from "@shared/schema";
import { eq, sql, and } from "drizzle-orm";
import { detectOutliers, jaccardSimilarity, normalizeQuery } from "./data-validation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FreshnessStats {
  businessId: number;
  lastSearchRecord: string | null;
  lastReferral: string | null;
  lastAiSnapshot: string | null;
  overallLastUpdate: string | null;
  staleDays: number | null; // days since last update
  isStale: boolean;         // true if no update in >7 days
}

export interface CompletenessScore {
  table: string;
  totalRecords: number;
  nonNullFields: number;
  totalFields: number;
  score: number; // 0–100
}

export interface DuplicateReport {
  table: string;
  totalRecords: number;
  duplicateGroups: number;
  duplicateRecords: number;
  examples: Array<{ query: string; count: number }>;
}

export interface QualityReport {
  businessId: number;
  generatedAt: string;
  freshness: FreshnessStats;
  completeness: CompletenessScore[];
  duplicates: DuplicateReport[];
  outliers: Array<{ field: string; value: unknown; reason: string }>;
  overallScore: number; // 0–100
  recommendations: string[];
}

// ─── Freshness ────────────────────────────────────────────────────────────────

export function getDataFreshness(businessId: number): FreshnessStats {
  const lastSearch = db
    .select({ date: sql<string>`max(date)` })
    .from(searchRecords)
    .where(eq(searchRecords.businessId, businessId))
    .get();

  const lastReferral = db
    .select({ date: sql<string>`max(date)` })
    .from(referrals)
    .where(eq(referrals.businessId, businessId))
    .get();

  const lastSnapshot = db
    .select({ date: sql<string>`max(date)` })
    .from(aiSnapshots)
    .where(eq(aiSnapshots.businessId, businessId))
    .get();

  const dates = [
    lastSearch?.date,
    lastReferral?.date,
    lastSnapshot?.date,
  ].filter(Boolean) as string[];

  const overallLastUpdate = dates.length > 0 ? dates.sort().reverse()[0] : null;

  let staleDays: number | null = null;
  let isStale = true;
  if (overallLastUpdate) {
    staleDays = Math.floor(
      (Date.now() - new Date(overallLastUpdate).getTime()) / (1000 * 60 * 60 * 24)
    );
    isStale = staleDays > 7;
  }

  return {
    businessId,
    lastSearchRecord: lastSearch?.date ?? null,
    lastReferral: lastReferral?.date ?? null,
    lastAiSnapshot: lastSnapshot?.date ?? null,
    overallLastUpdate,
    staleDays,
    isStale,
  };
}

// ─── Completeness ─────────────────────────────────────────────────────────────

export function getCompletenessScores(businessId: number): CompletenessScore[] {
  const scores: CompletenessScore[] = [];

  // search_records: optional fields = position
  const srTotal = db
    .select({ count: sql<number>`count(*)` })
    .from(searchRecords)
    .where(eq(searchRecords.businessId, businessId))
    .get()?.count ?? 0;

  const srWithPosition = db
    .select({ count: sql<number>`count(*)` })
    .from(searchRecords)
    .where(
      and(
        eq(searchRecords.businessId, businessId),
        sql`${searchRecords.position} IS NOT NULL`
      )
    )
    .get()?.count ?? 0;

  // Required fields always present (businessId, platformId, query, mentioned, date) = 5
  // Optional: position = 1 → total tracked = 6 per record
  const srNonNull = srTotal * 5 + srWithPosition;
  const srTotalFields = srTotal * 6;
  scores.push({
    table: "search_records",
    totalRecords: srTotal,
    nonNullFields: srNonNull,
    totalFields: srTotalFields,
    score: srTotalFields > 0 ? Math.round((srNonNull / srTotalFields) * 100) : 100,
  });

  // referrals: optional fields = searchRecordId, utmSource, utmMedium, utmCampaign,
  //            conversionType, sessionDuration (6 optional, 8 required)
  const refTotal = db
    .select({ count: sql<number>`count(*)` })
    .from(referrals)
    .where(eq(referrals.businessId, businessId))
    .get()?.count ?? 0;

  const refOptionalFilled = db
    .select({
      withSearchRecordId: sql<number>`sum(case when search_record_id is not null then 1 else 0 end)`,
      withUtmSource: sql<number>`sum(case when utm_source is not null then 1 else 0 end)`,
      withUtmMedium: sql<number>`sum(case when utm_medium is not null then 1 else 0 end)`,
      withUtmCampaign: sql<number>`sum(case when utm_campaign is not null then 1 else 0 end)`,
      withConversionType: sql<number>`sum(case when conversion_type is not null then 1 else 0 end)`,
      withSessionDuration: sql<number>`sum(case when session_duration is not null then 1 else 0 end)`,
    })
    .from(referrals)
    .where(eq(referrals.businessId, businessId))
    .get();

  const refOptional =
    (refOptionalFilled?.withSearchRecordId ?? 0) +
    (refOptionalFilled?.withUtmSource ?? 0) +
    (refOptionalFilled?.withUtmMedium ?? 0) +
    (refOptionalFilled?.withUtmCampaign ?? 0) +
    (refOptionalFilled?.withConversionType ?? 0) +
    (refOptionalFilled?.withSessionDuration ?? 0);

  const refNonNull = refTotal * 8 + refOptional;
  const refTotalFields = refTotal * 14;
  scores.push({
    table: "referrals",
    totalRecords: refTotal,
    nonNullFields: refNonNull,
    totalFields: refTotalFields,
    score: refTotalFields > 0 ? Math.round((refNonNull / refTotalFields) * 100) : 100,
  });

  // ai_snapshots: optional = flaggedIssues (1 optional, 7 required)
  const snapTotal = db
    .select({ count: sql<number>`count(*)` })
    .from(aiSnapshots)
    .where(eq(aiSnapshots.businessId, businessId))
    .get()?.count ?? 0;

  const snapWithFlags = db
    .select({ count: sql<number>`count(*)` })
    .from(aiSnapshots)
    .where(
      and(
        eq(aiSnapshots.businessId, businessId),
        sql`${aiSnapshots.flaggedIssues} IS NOT NULL`
      )
    )
    .get()?.count ?? 0;

  const snapNonNull = snapTotal * 7 + snapWithFlags;
  const snapTotalFields = snapTotal * 8;
  scores.push({
    table: "ai_snapshots",
    totalRecords: snapTotal,
    nonNullFields: snapNonNull,
    totalFields: snapTotalFields,
    score: snapTotalFields > 0 ? Math.round((snapNonNull / snapTotalFields) * 100) : 100,
  });

  return scores;
}

// ─── Duplicate Detection ──────────────────────────────────────────────────────

export function getDuplicateReport(businessId: number): DuplicateReport[] {
  const reports: DuplicateReport[] = [];

  // search_records: exact duplicate = same businessId + platformId + query + date
  const srTotal = db
    .select({ count: sql<number>`count(*)` })
    .from(searchRecords)
    .where(eq(searchRecords.businessId, businessId))
    .get()?.count ?? 0;

  const srDuplicates = db
    .select({
      query: searchRecords.query,
      count: sql<number>`count(*)`,
    })
    .from(searchRecords)
    .where(eq(searchRecords.businessId, businessId))
    .groupBy(searchRecords.query, searchRecords.platformId, searchRecords.date)
    .having(sql`count(*) > 1`)
    .all();

  const srDupRecords = srDuplicates.reduce((sum, r) => sum + r.count, 0);
  reports.push({
    table: "search_records",
    totalRecords: srTotal,
    duplicateGroups: srDuplicates.length,
    duplicateRecords: srDupRecords,
    examples: srDuplicates.slice(0, 5).map((r) => ({ query: r.query, count: r.count })),
  });

  // referrals: exact duplicate = same businessId + platformId + query + timestamp
  const refTotal = db
    .select({ count: sql<number>`count(*)` })
    .from(referrals)
    .where(eq(referrals.businessId, businessId))
    .get()?.count ?? 0;

  const refDuplicates = db
    .select({
      query: referrals.query,
      count: sql<number>`count(*)`,
    })
    .from(referrals)
    .where(eq(referrals.businessId, businessId))
    .groupBy(referrals.query, referrals.platformId, referrals.timestamp)
    .having(sql`count(*) > 1`)
    .all();

  const refDupRecords = refDuplicates.reduce((sum, r) => sum + r.count, 0);
  reports.push({
    table: "referrals",
    totalRecords: refTotal,
    duplicateGroups: refDuplicates.length,
    duplicateRecords: refDupRecords,
    examples: refDuplicates.slice(0, 5).map((r) => ({ query: r.query, count: r.count })),
  });

  return reports;
}

// ─── Full Quality Report ──────────────────────────────────────────────────────

export function generateQualityReport(businessId: number): QualityReport {
  const generatedAt = new Date().toISOString();
  const freshness = getDataFreshness(businessId);
  const completeness = getCompletenessScores(businessId);
  const duplicates = getDuplicateReport(businessId);

  // Outlier detection on search records
  const rawRecords = db
    .select({ platformId: searchRecords.platformId, mentioned: searchRecords.mentioned })
    .from(searchRecords)
    .where(eq(searchRecords.businessId, businessId))
    .all();
  const outliers = detectOutliers(rawRecords);

  // Build recommendations
  const recommendations: string[] = [];

  if (freshness.isStale) {
    recommendations.push(
      `Data is stale (last update ${freshness.staleDays} days ago). Run a new scan to refresh.`
    );
  }

  for (const c of completeness) {
    if (c.score < 80) {
      recommendations.push(
        `${c.table} completeness is ${c.score}% — ensure optional fields are populated where possible.`
      );
    }
  }

  for (const d of duplicates) {
    if (d.duplicateGroups > 0) {
      recommendations.push(
        `${d.table} has ${d.duplicateGroups} duplicate group(s) (${d.duplicateRecords} records). Run deduplication.`
      );
    }
  }

  for (const o of outliers) {
    recommendations.push(`Outlier detected: ${o.reason}`);
  }

  // Overall score: weighted average of freshness, completeness, and duplicate penalty
  const freshnessScore = freshness.isStale
    ? Math.max(0, 100 - (freshness.staleDays ?? 0) * 5)
    : 100;

  const avgCompleteness =
    completeness.length > 0
      ? completeness.reduce((s, c) => s + c.score, 0) / completeness.length
      : 100;

  const totalRecords = duplicates.reduce((s, d) => s + d.totalRecords, 0);
  const totalDuplicates = duplicates.reduce((s, d) => s + d.duplicateRecords, 0);
  const duplicatePenalty =
    totalRecords > 0 ? Math.round((totalDuplicates / totalRecords) * 100) : 0;
  const duplicateScore = Math.max(0, 100 - duplicatePenalty);

  const overallScore = Math.round(
    freshnessScore * 0.3 + avgCompleteness * 0.4 + duplicateScore * 0.3
  );

  return {
    businessId,
    generatedAt,
    freshness,
    completeness,
    duplicates,
    outliers,
    overallScore,
    recommendations,
  };
}
