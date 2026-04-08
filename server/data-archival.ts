/**
 * Data Archival Module
 *
 * Implements a retention policy for old records:
 *  - Archives search_records, referrals, and ai_snapshots older than N days
 *    into dedicated archive tables.
 *  - Cleans up completed/failed scan jobs older than N days.
 *  - Provides configurable retention periods.
 */

import { db } from "./storage";
import { sql } from "drizzle-orm";

function archivalLog(message: string): void {
  const time = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  console.log(`${time} [archival] ${message}`);
}

// ─── Retention Configuration ──────────────────────────────────────────────────

export interface RetentionPolicy {
  /** Days after which search records are archived (default: 90) */
  searchRecordsDays: number;
  /** Days after which referrals are archived (default: 90) */
  referralsDays: number;
  /** Days after which AI snapshots are archived (default: 90) */
  aiSnapshotsDays: number;
  /** Days after which completed/failed scan jobs are deleted (default: 30) */
  scanJobsDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  searchRecordsDays: 90,
  referralsDays: 90,
  aiSnapshotsDays: 90,
  scanJobsDays: 30,
};

// ─── Archive Table Bootstrap ──────────────────────────────────────────────────

/**
 * Ensure archive tables exist. Called once at startup.
 * Archive tables mirror the source tables with an additional `archived_at` column.
 */
export function ensureArchiveTables(): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS archived_search_records (
    id INTEGER PRIMARY KEY,
    business_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    mentioned INTEGER NOT NULL DEFAULT 0,
    position INTEGER,
    date TEXT NOT NULL,
    archived_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS archived_referrals (
    id INTEGER PRIMARY KEY,
    business_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    search_record_id INTEGER,
    query TEXT NOT NULL,
    landing_page TEXT NOT NULL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    converted INTEGER NOT NULL DEFAULT 0,
    conversion_type TEXT,
    session_duration INTEGER,
    pages_viewed INTEGER NOT NULL DEFAULT 1,
    device_type TEXT NOT NULL DEFAULT 'desktop',
    date TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    archived_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS archived_ai_snapshots (
    id INTEGER PRIMARY KEY,
    business_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    response_text TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    mentioned_accurate INTEGER NOT NULL DEFAULT 1,
    flagged_issues TEXT,
    date TEXT NOT NULL,
    archived_at TEXT NOT NULL
  )`);
}

// ─── Archive Helpers ──────────────────────────────────────────────────────────

function cutoffDate(daysOld: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysOld);
  return d.toISOString().split("T")[0];
}

// ─── Archive Operations ───────────────────────────────────────────────────────

export interface ArchivalResult {
  table: string;
  archivedCount: number;
  deletedCount: number;
  cutoffDate: string;
}

/**
 * Archive search_records older than `daysOld` days for a specific business
 * (or all businesses if businessId is omitted).
 */
export function archiveSearchRecords(
  daysOld: number,
  businessId?: number
): ArchivalResult {
  const cutoff = cutoffDate(daysOld);
  const archivedAt = new Date().toISOString();

  const whereClause = businessId
    ? sql`date < ${cutoff} AND business_id = ${businessId}`
    : sql`date < ${cutoff}`;

  // Copy to archive table
  db.run(sql`
    INSERT OR IGNORE INTO archived_search_records
      (id, business_id, platform_id, query, mentioned, position, date, archived_at)
    SELECT id, business_id, platform_id, query, mentioned, position, date, ${archivedAt}
    FROM search_records
    WHERE ${whereClause}
  `);

  const archivedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  // Delete from live table
  db.run(sql`DELETE FROM search_records WHERE ${whereClause}`);
  const deletedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  return { table: "search_records", archivedCount, deletedCount, cutoffDate: cutoff };
}

/**
 * Archive referrals older than `daysOld` days.
 */
export function archiveReferrals(
  daysOld: number,
  businessId?: number
): ArchivalResult {
  const cutoff = cutoffDate(daysOld);
  const archivedAt = new Date().toISOString();

  const whereClause = businessId
    ? sql`date < ${cutoff} AND business_id = ${businessId}`
    : sql`date < ${cutoff}`;

  db.run(sql`
    INSERT OR IGNORE INTO archived_referrals
      (id, business_id, platform_id, search_record_id, query, landing_page,
       utm_source, utm_medium, utm_campaign, converted, conversion_type,
       session_duration, pages_viewed, device_type, date, timestamp, archived_at)
    SELECT id, business_id, platform_id, search_record_id, query, landing_page,
           utm_source, utm_medium, utm_campaign, converted, conversion_type,
           session_duration, pages_viewed, device_type, date, timestamp, ${archivedAt}
    FROM referrals
    WHERE ${whereClause}
  `);

  const archivedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  db.run(sql`DELETE FROM referrals WHERE ${whereClause}`);
  const deletedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  return { table: "referrals", archivedCount, deletedCount, cutoffDate: cutoff };
}

/**
 * Archive ai_snapshots older than `daysOld` days.
 */
export function archiveAiSnapshots(
  daysOld: number,
  businessId?: number
): ArchivalResult {
  const cutoff = cutoffDate(daysOld);
  const archivedAt = new Date().toISOString();

  const whereClause = businessId
    ? sql`date < ${cutoff} AND business_id = ${businessId}`
    : sql`date < ${cutoff}`;

  db.run(sql`
    INSERT OR IGNORE INTO archived_ai_snapshots
      (id, business_id, platform_id, query, response_text, sentiment,
       mentioned_accurate, flagged_issues, date, archived_at)
    SELECT id, business_id, platform_id, query, response_text, sentiment,
           mentioned_accurate, flagged_issues, date, ${archivedAt}
    FROM ai_snapshots
    WHERE ${whereClause}
  `);

  const archivedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  db.run(sql`DELETE FROM ai_snapshots WHERE ${whereClause}`);
  const deletedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  return { table: "ai_snapshots", archivedCount, deletedCount, cutoffDate: cutoff };
}

/**
 * Delete completed/failed scan jobs older than `daysOld` days.
 */
export function cleanupScanJobs(daysOld: number): { deletedCount: number } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const cutoffIso = cutoff.toISOString();

  db.run(sql`
    DELETE FROM scan_jobs
    WHERE status IN ('completed', 'failed')
      AND completed_at IS NOT NULL
      AND completed_at < ${cutoffIso}
  `);

  const deletedCount: number =
    (db.get(sql`SELECT changes() as c`) as any)?.c ?? 0;

  return { deletedCount };
}

// ─── Full Archival Run ────────────────────────────────────────────────────────

export interface ArchivalRunResult {
  ranAt: string;
  results: ArchivalResult[];
  scanJobsDeleted: number;
  totalArchived: number;
  totalDeleted: number;
}

/**
 * Run a full archival pass using the provided (or default) retention policy.
 * Safe to call on a schedule (e.g., nightly).
 */
export function runArchival(policy: RetentionPolicy = DEFAULT_RETENTION): ArchivalRunResult {
  const ranAt = new Date().toISOString();

  archivalLog(`Starting archival run with policy: ${JSON.stringify(policy)}`);

  const results: ArchivalResult[] = [
    archiveSearchRecords(policy.searchRecordsDays),
    archiveReferrals(policy.referralsDays),
    archiveAiSnapshots(policy.aiSnapshotsDays),
  ];

  const { deletedCount: scanJobsDeleted } = cleanupScanJobs(policy.scanJobsDays);

  const totalArchived = results.reduce((s, r) => s + r.archivedCount, 0);
  const totalDeleted = results.reduce((s, r) => s + r.deletedCount, 0);

  archivalLog(
    `Complete — archived ${totalArchived} records, deleted ${totalDeleted} live records, removed ${scanJobsDeleted} old scan jobs`
  );

  return { ranAt, results, scanJobsDeleted, totalArchived, totalDeleted };
}
