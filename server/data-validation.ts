/**
 * Data Validation & Cleaning Module
 *
 * Provides query normalization, deduplication, per-type validation,
 * data quality scoring, and outlier detection for all ingested records.
 */

import type { InsertSearchRecord, InsertReferral, InsertAiSnapshot } from "@shared/schema";

// ─── Query Normalization ──────────────────────────────────────────────────────

/**
 * Normalize a raw query string:
 *  - Lowercase and trim
 *  - Collapse multiple whitespace characters into a single space
 *  - Standardize punctuation (remove trailing punctuation, normalize apostrophes)
 *  - Remove leading/trailing special characters
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    // Normalize curly/smart apostrophes and quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    // Collapse whitespace
    .replace(/\s+/g, " ")
    // Remove trailing punctuation (periods, commas, semicolons, colons)
    .replace(/[.,;:!?]+$/, "")
    // Remove leading non-alphanumeric characters
    .replace(/^[^a-z0-9]+/, "");
}

// ─── Fuzzy Deduplication ──────────────────────────────────────────────────────

/**
 * Compute a simple Jaccard similarity between two strings based on word sets.
 * Returns a value between 0 (no overlap) and 1 (identical word sets).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter((w) => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Given a list of normalized queries, return only the unique ones by removing
 * near-duplicates whose Jaccard similarity exceeds `threshold` (default 0.85).
 */
export function deduplicateQueries(queries: string[], threshold = 0.85): string[] {
  const unique: string[] = [];
  for (const q of queries) {
    const isDuplicate = unique.some((u) => jaccardSimilarity(u, q) >= threshold);
    if (!isDuplicate) unique.push(q);
  }
  return unique;
}

// ─── Validation Results ───────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedData?: Record<string, unknown>;
}

// ─── SearchRecord Validation ──────────────────────────────────────────────────

export function validateSearchRecord(record: Partial<InsertSearchRecord>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!record.businessId || record.businessId <= 0) {
    errors.push("businessId must be a positive integer");
  }
  if (!record.platformId || record.platformId <= 0) {
    errors.push("platformId must be a positive integer");
  }
  if (!record.query || record.query.trim().length === 0) {
    errors.push("query must not be empty");
  } else if (record.query.trim().length < 3) {
    errors.push("query is too short (minimum 3 characters)");
  } else if (record.query.length > 500) {
    errors.push("query exceeds maximum length of 500 characters");
  }
  if (record.mentioned !== 0 && record.mentioned !== 1) {
    errors.push("mentioned must be 0 or 1");
  }
  if (record.position !== undefined && record.position !== null) {
    if (!Number.isInteger(record.position) || record.position < 1 || record.position > 100) {
      errors.push("position must be an integer between 1 and 100");
    }
  }
  if (!record.date || !/^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    errors.push("date must be in YYYY-MM-DD format");
  } else {
    const d = new Date(record.date);
    const now = new Date();
    if (isNaN(d.getTime())) {
      errors.push("date is not a valid calendar date");
    } else if (d > now) {
      warnings.push("date is in the future");
    } else {
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      if (d < ninetyDaysAgo) {
        warnings.push("date is older than 90 days — consider archiving");
      }
    }
  }

  const normalizedData =
    errors.length === 0
      ? {
          ...record,
          query: normalizeQuery(record.query!),
        }
      : undefined;

  return { valid: errors.length === 0, errors, warnings, normalizedData };
}

// ─── Referral Validation ──────────────────────────────────────────────────────

export function validateReferral(referral: Partial<InsertReferral>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!referral.businessId || referral.businessId <= 0) {
    errors.push("businessId must be a positive integer");
  }
  if (!referral.platformId || referral.platformId <= 0) {
    errors.push("platformId must be a positive integer");
  }
  if (!referral.query || referral.query.trim().length === 0) {
    errors.push("query must not be empty");
  }
  if (!referral.landingPage || referral.landingPage.trim().length === 0) {
    errors.push("landingPage must not be empty");
  } else if (!referral.landingPage.startsWith("/") && !referral.landingPage.startsWith("http")) {
    warnings.push("landingPage should start with '/' or 'http'");
  }
  if (referral.converted !== 0 && referral.converted !== 1) {
    errors.push("converted must be 0 or 1");
  }
  if (referral.sessionDuration !== undefined && referral.sessionDuration !== null) {
    if (referral.sessionDuration < 0) {
      errors.push("sessionDuration must be non-negative");
    } else if (referral.sessionDuration > 86400) {
      warnings.push("sessionDuration exceeds 24 hours — possible data error");
    }
  }
  if (referral.pagesViewed !== undefined && referral.pagesViewed !== null) {
    if (referral.pagesViewed < 1) {
      errors.push("pagesViewed must be at least 1");
    } else if (referral.pagesViewed > 200) {
      warnings.push("pagesViewed is unusually high (>200)");
    }
  }
  if (!referral.date || !/^\d{4}-\d{2}-\d{2}$/.test(referral.date)) {
    errors.push("date must be in YYYY-MM-DD format");
  }
  if (!referral.timestamp) {
    errors.push("timestamp is required");
  }

  const normalizedData =
    errors.length === 0
      ? {
          ...referral,
          query: normalizeQuery(referral.query!),
          landingPage: referral.landingPage?.trim(),
        }
      : undefined;

  return { valid: errors.length === 0, errors, warnings, normalizedData };
}

// ─── AiSnapshot Validation ────────────────────────────────────────────────────

const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative"]);

export function validateAiSnapshot(snapshot: Partial<InsertAiSnapshot>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!snapshot.businessId || snapshot.businessId <= 0) {
    errors.push("businessId must be a positive integer");
  }
  if (!snapshot.platformId || snapshot.platformId <= 0) {
    errors.push("platformId must be a positive integer");
  }
  if (!snapshot.query || snapshot.query.trim().length === 0) {
    errors.push("query must not be empty");
  }
  if (!snapshot.responseText || snapshot.responseText.trim().length === 0) {
    errors.push("responseText must not be empty");
  } else if (snapshot.responseText.length > 50000) {
    warnings.push("responseText is very long (>50 000 chars) — consider truncating");
  }
  if (!snapshot.sentiment || !VALID_SENTIMENTS.has(snapshot.sentiment)) {
    errors.push("sentiment must be one of: positive, neutral, negative");
  }
  if (snapshot.mentionedAccurate !== 0 && snapshot.mentionedAccurate !== 1) {
    errors.push("mentionedAccurate must be 0 or 1");
  }
  if (!snapshot.date || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date)) {
    errors.push("date must be in YYYY-MM-DD format");
  }

  const normalizedData =
    errors.length === 0
      ? {
          ...snapshot,
          query: normalizeQuery(snapshot.query!),
          responseText: snapshot.responseText?.trim(),
        }
      : undefined;

  return { valid: errors.length === 0, errors, warnings, normalizedData };
}

// ─── Data Quality Scoring ─────────────────────────────────────────────────────

export interface QualityScore {
  score: number; // 0–100
  breakdown: {
    completeness: number;
    validity: number;
    freshness: number;
  };
  issues: string[];
}

/**
 * Score a single search record on a 0–100 scale.
 * Completeness: non-null optional fields (position).
 * Validity: passes validateSearchRecord with no errors.
 * Freshness: record is within the last 30 days.
 */
export function scoreSearchRecord(record: Partial<InsertSearchRecord>): QualityScore {
  const issues: string[] = [];

  // Completeness (0–100): position is the only optional field
  const completeness = record.position !== null && record.position !== undefined ? 100 : 70;
  if (record.position === null || record.position === undefined) {
    issues.push("position is missing");
  }

  // Validity
  const validation = validateSearchRecord(record);
  const validity = validation.valid ? 100 : Math.max(0, 100 - validation.errors.length * 25);
  issues.push(...validation.errors);
  issues.push(...validation.warnings);

  // Freshness
  let freshness = 100;
  if (record.date) {
    const daysOld = (Date.now() - new Date(record.date).getTime()) / (1000 * 60 * 60 * 24);
    if (daysOld > 30) freshness = Math.max(0, 100 - Math.floor((daysOld - 30) * 2));
    if (daysOld > 30) issues.push(`record is ${Math.floor(daysOld)} days old`);
  }

  const score = Math.round((completeness * 0.3 + validity * 0.5 + freshness * 0.2));
  return { score, breakdown: { completeness, validity, freshness }, issues };
}

// ─── Outlier Detection ────────────────────────────────────────────────────────

export interface OutlierFlag {
  field: string;
  value: unknown;
  reason: string;
}

/**
 * Detect statistical outliers in a batch of search records.
 * Flags records where the mention rate per platform is 100% or 0% (if ≥5 records).
 */
export function detectOutliers(
  records: Array<{ platformId: number; mentioned: number }>
): OutlierFlag[] {
  const flags: OutlierFlag[] = [];
  const byPlatform: Record<number, { total: number; mentions: number }> = {};

  for (const r of records) {
    if (!byPlatform[r.platformId]) byPlatform[r.platformId] = { total: 0, mentions: 0 };
    byPlatform[r.platformId].total++;
    if (r.mentioned) byPlatform[r.platformId].mentions++;
  }

  for (const [platformId, stats] of Object.entries(byPlatform)) {
    if (stats.total < 5) continue;
    const rate = stats.mentions / stats.total;
    if (rate === 1.0) {
      flags.push({
        field: "mentioned",
        value: rate,
        reason: `Platform ${platformId} has a 100% mention rate across ${stats.total} records — possible data quality issue`,
      });
    }
    if (rate === 0.0) {
      flags.push({
        field: "mentioned",
        value: rate,
        reason: `Platform ${platformId} has a 0% mention rate across ${stats.total} records — business may be invisible on this platform`,
      });
    }
  }

  return flags;
}
