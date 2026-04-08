import {
  type Business, type InsertBusiness, businesses,
  type Platform, type InsertPlatform, platforms,
  type SearchRecord, type InsertSearchRecord, searchRecords,
  type OptimizedPrompt, type InsertOptimizedPrompt, optimizedPrompts,
  type Referral, type InsertReferral, referrals,
  type Competitor, type InsertCompetitor, competitors,
  type AiSnapshot, type InsertAiSnapshot, aiSnapshots,
  type Alert, type InsertAlert, alerts,
  type ContentGap, type InsertContentGap, contentGaps,
  type Location, type InsertLocation, locations,
  type ApiKey, type InsertApiKey, apiKeys,
  type ScanJob, type InsertScanJob, scanJobs,
  type User, type SafeUser, users,
  type UserBusiness, userBusinesses,
} from "@shared/schema";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, sql, desc, and } from "drizzle-orm";

import path from "path";
const dataDir = process.env.DATA_DIR || ".";
const dbPath = path.join(dataDir, "data.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

export interface IStorage {
  // Businesses
  getBusinesses(): Promise<Business[]>;
  getBusiness(id: number): Promise<Business | undefined>;
  createBusiness(business: InsertBusiness): Promise<Business>;
  updateBusiness(id: number, data: Partial<InsertBusiness>): Promise<Business | undefined>;
  deleteBusiness(id: number): Promise<void>;

  // Platforms
  getPlatforms(): Promise<Platform[]>;

  // Search Records
  getSearchRecords(businessId: number): Promise<SearchRecord[]>;
  createSearchRecord(record: InsertSearchRecord): Promise<SearchRecord>;
  getSearchStats(businessId: number): Promise<any>;
  getSearchTrend(businessId: number): Promise<any[]>;
  getPlatformBreakdown(businessId: number): Promise<any[]>;

  // Optimized Prompts
  getOptimizedPrompts(businessId: number): Promise<OptimizedPrompt[]>;
  createOptimizedPrompt(prompt: InsertOptimizedPrompt): Promise<OptimizedPrompt>;

  // Referrals
  getReferrals(businessId: number): Promise<Referral[]>;
  createReferral(referral: InsertReferral): Promise<Referral>;
  getReferralStats(businessId: number): Promise<any>;
  getReferralTrend(businessId: number): Promise<any[]>;
  getReferralsByPlatform(businessId: number): Promise<any[]>;
  getConversionsByType(businessId: number): Promise<any[]>;
  getTopReferralQueries(businessId: number): Promise<any[]>;

  // Competitors
  getCompetitors(businessId: number): Promise<Competitor[]>;
  getCompetitor(id: number): Promise<Competitor | undefined>;
  createCompetitor(competitor: InsertCompetitor): Promise<Competitor>;
  updateCompetitor(id: number, data: Partial<InsertCompetitor>): Promise<Competitor | undefined>;
  deleteCompetitor(id: number): Promise<void>;

  // AI Snapshots
  getAiSnapshots(businessId: number): Promise<AiSnapshot[]>;
  createAiSnapshot(snapshot: InsertAiSnapshot): Promise<AiSnapshot>;

  // Alerts
  getAlerts(): Promise<Alert[]>;
  getAlertsByBusiness(businessId: number): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertRead(id: number): Promise<void>;
  getUnreadAlertCount(): Promise<number>;

  // Content Gaps
  getContentGaps(businessId: number): Promise<ContentGap[]>;
  createContentGap(gap: InsertContentGap): Promise<ContentGap>;
  deleteContentGap(id: number): Promise<void>;

  // Locations
  getLocations(businessId: number): Promise<Location[]>;
  createLocation(location: InsertLocation): Promise<Location>;
  deleteLocation(id: number): Promise<void>;

  // API Keys
  getApiKeys(): Promise<ApiKey[]>;
  getApiKey(provider: string): Promise<ApiKey | undefined>;
  upsertApiKey(provider: string, apiKey: string): Promise<ApiKey>;
  deleteApiKey(provider: string): Promise<void>;

  // Scan Jobs
  createScanJob(job: InsertScanJob): Promise<ScanJob>;
  updateScanJob(id: number, updates: Partial<ScanJob>): Promise<void>;
  getScanJobs(businessId: number): Promise<ScanJob[]>;

  // Users
  createUser(data: { username: string; password: string; displayName: string; role?: string }): Promise<User>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  getUsers(): Promise<SafeUser[]>;
  updateUser(id: number, updates: Partial<{ displayName: string; isActive: number; passwordHash: string }>): Promise<void>;
  deleteUser(id: number): Promise<void>;
  assignBusiness(userId: number, businessId: number): Promise<void>;
  unassignBusiness(userId: number, businessId: number): Promise<void>;
  getUserBusinessIds(userId: number): Promise<number[]>;
  getBusinessUsers(businessId: number): Promise<SafeUser[]>;
}

export class DatabaseStorage implements IStorage {
  // === BUSINESSES ===
  async getBusinesses(): Promise<Business[]> {
    return db.select().from(businesses).all();
  }

  async getBusiness(id: number): Promise<Business | undefined> {
    return db.select().from(businesses).where(eq(businesses.id, id)).get();
  }

  async createBusiness(business: InsertBusiness): Promise<Business> {
    return db.insert(businesses).values(business).returning().get();
  }

  async updateBusiness(id: number, data: Partial<InsertBusiness>): Promise<Business | undefined> {
    const updates: any = {};
    if (data.ga4Id !== undefined) updates.ga4Id = data.ga4Id;
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.industry !== undefined) updates.industry = data.industry;
    if (data.website !== undefined) updates.website = data.website;
    if (data.location !== undefined) updates.location = data.location;

    if (Object.keys(updates).length === 0) {
      return this.getBusiness(id);
    }

    return db.update(businesses).set(updates).where(eq(businesses.id, id)).returning().get();
  }

  async deleteBusiness(id: number): Promise<void> {
    db.delete(businesses).where(eq(businesses.id, id)).run();
    db.delete(searchRecords).where(eq(searchRecords.businessId, id)).run();
    db.delete(optimizedPrompts).where(eq(optimizedPrompts.businessId, id)).run();
    db.delete(referrals).where(eq(referrals.businessId, id)).run();
    db.delete(competitors).where(eq(competitors.businessId, id)).run();
    db.delete(aiSnapshots).where(eq(aiSnapshots.businessId, id)).run();
    db.delete(alerts).where(eq(alerts.businessId, id)).run();
    db.delete(contentGaps).where(eq(contentGaps.businessId, id)).run();
    db.delete(locations).where(eq(locations.businessId, id)).run();
  }

  async getPlatforms(): Promise<Platform[]> {
    return db.select().from(platforms).all();
  }

  // === SEARCH RECORDS ===
  async getSearchRecords(businessId: number): Promise<SearchRecord[]> {
    return db.select().from(searchRecords)
      .where(eq(searchRecords.businessId, businessId))
      .orderBy(desc(searchRecords.date))
      .all();
  }

  async createSearchRecord(record: InsertSearchRecord): Promise<SearchRecord> {
    return db.insert(searchRecords).values(record).returning().get();
  }

  async getSearchStats(businessId: number): Promise<any> {
    const totalSearches = db.select({ count: sql<number>`count(*)` })
      .from(searchRecords)
      .where(eq(searchRecords.businessId, businessId))
      .get();

    const totalMentions = db.select({ count: sql<number>`count(*)` })
      .from(searchRecords)
      .where(and(eq(searchRecords.businessId, businessId), eq(searchRecords.mentioned, 1)))
      .get();

    const avgPosition = db.select({ avg: sql<number>`avg(position)` })
      .from(searchRecords)
      .where(and(eq(searchRecords.businessId, businessId), eq(searchRecords.mentioned, 1)))
      .get();

    const platformCount = db.select({ count: sql<number>`count(distinct platform_id)` })
      .from(searchRecords)
      .where(eq(searchRecords.businessId, businessId))
      .get();

    return {
      totalSearches: totalSearches?.count ?? 0,
      totalMentions: totalMentions?.count ?? 0,
      mentionRate: totalSearches?.count ? Math.round(((totalMentions?.count ?? 0) / totalSearches.count) * 100) : 0,
      avgPosition: avgPosition?.avg ? Math.round(avgPosition.avg * 10) / 10 : null,
      platformCount: platformCount?.count ?? 0,
    };
  }

  async getSearchTrend(businessId: number): Promise<any[]> {
    return db.select({
      date: searchRecords.date,
      total: sql<number>`count(*)`,
      mentions: sql<number>`sum(case when mentioned = 1 then 1 else 0 end)`,
    })
      .from(searchRecords)
      .where(eq(searchRecords.businessId, businessId))
      .groupBy(searchRecords.date)
      .orderBy(searchRecords.date)
      .all();
  }

  async getPlatformBreakdown(businessId: number): Promise<any[]> {
    return db.select({
      platformId: searchRecords.platformId,
      platformName: platforms.name,
      color: platforms.color,
      total: sql<number>`count(*)`,
      mentions: sql<number>`sum(case when ${searchRecords.mentioned} = 1 then 1 else 0 end)`,
    })
      .from(searchRecords)
      .innerJoin(platforms, eq(searchRecords.platformId, platforms.id))
      .where(eq(searchRecords.businessId, businessId))
      .groupBy(searchRecords.platformId)
      .all();
  }

  // === OPTIMIZED PROMPTS ===
  async getOptimizedPrompts(businessId: number): Promise<OptimizedPrompt[]> {
    return db.select().from(optimizedPrompts)
      .where(eq(optimizedPrompts.businessId, businessId))
      .orderBy(desc(optimizedPrompts.score))
      .all();
  }

  async createOptimizedPrompt(prompt: InsertOptimizedPrompt): Promise<OptimizedPrompt> {
    return db.insert(optimizedPrompts).values(prompt).returning().get();
  }

  // === REFERRALS ===
  async getReferrals(businessId: number): Promise<Referral[]> {
    return db.select().from(referrals)
      .where(eq(referrals.businessId, businessId))
      .orderBy(desc(referrals.timestamp))
      .all();
  }

  async createReferral(referral: InsertReferral): Promise<Referral> {
    return db.insert(referrals).values(referral).returning().get();
  }

  async getReferralStats(businessId: number): Promise<any> {
    const totalReferrals = db.select({ count: sql<number>`count(*)` })
      .from(referrals)
      .where(eq(referrals.businessId, businessId))
      .get();

    const totalConversions = db.select({ count: sql<number>`count(*)` })
      .from(referrals)
      .where(and(eq(referrals.businessId, businessId), eq(referrals.converted, 1)))
      .get();

    const avgSessionDuration = db.select({ avg: sql<number>`avg(session_duration)` })
      .from(referrals)
      .where(eq(referrals.businessId, businessId))
      .get();

    const avgPagesViewed = db.select({ avg: sql<number>`avg(pages_viewed)` })
      .from(referrals)
      .where(eq(referrals.businessId, businessId))
      .get();

    const totalMentions = db.select({ count: sql<number>`count(*)` })
      .from(searchRecords)
      .where(and(eq(searchRecords.businessId, businessId), eq(searchRecords.mentioned, 1)))
      .get();

    const referralCount = totalReferrals?.count ?? 0;
    const conversionCount = totalConversions?.count ?? 0;
    const mentionCount = totalMentions?.count ?? 0;

    return {
      totalReferrals: referralCount,
      totalConversions: conversionCount,
      conversionRate: referralCount > 0 ? Math.round((conversionCount / referralCount) * 100) : 0,
      clickThroughRate: mentionCount > 0 ? Math.round((referralCount / mentionCount) * 100) : 0,
      avgSessionDuration: avgSessionDuration?.avg ? Math.round(avgSessionDuration.avg) : 0,
      avgPagesViewed: avgPagesViewed?.avg ? Math.round(avgPagesViewed.avg * 10) / 10 : 0,
    };
  }

  async getReferralTrend(businessId: number): Promise<any[]> {
    return db.select({
      date: referrals.date,
      visits: sql<number>`count(*)`,
      conversions: sql<number>`sum(case when converted = 1 then 1 else 0 end)`,
    })
      .from(referrals)
      .where(eq(referrals.businessId, businessId))
      .groupBy(referrals.date)
      .orderBy(referrals.date)
      .all();
  }

  async getReferralsByPlatform(businessId: number): Promise<any[]> {
    return db.select({
      platformId: referrals.platformId,
      platformName: platforms.name,
      color: platforms.color,
      visits: sql<number>`count(*)`,
      conversions: sql<number>`sum(case when ${referrals.converted} = 1 then 1 else 0 end)`,
      avgDuration: sql<number>`avg(${referrals.sessionDuration})`,
    })
      .from(referrals)
      .innerJoin(platforms, eq(referrals.platformId, platforms.id))
      .where(eq(referrals.businessId, businessId))
      .groupBy(referrals.platformId)
      .all();
  }

  async getConversionsByType(businessId: number): Promise<any[]> {
    return db.select({
      conversionType: referrals.conversionType,
      count: sql<number>`count(*)`,
    })
      .from(referrals)
      .where(and(eq(referrals.businessId, businessId), eq(referrals.converted, 1)))
      .groupBy(referrals.conversionType)
      .all();
  }

  async getTopReferralQueries(businessId: number): Promise<any[]> {
    return db.select({
      query: referrals.query,
      visits: sql<number>`count(*)`,
      conversions: sql<number>`sum(case when converted = 1 then 1 else 0 end)`,
    })
      .from(referrals)
      .where(eq(referrals.businessId, businessId))
      .groupBy(referrals.query)
      .orderBy(sql`count(*) desc`)
      .limit(10)
      .all();
  }

  // === COMPETITORS ===
  async getCompetitors(businessId: number): Promise<Competitor[]> {
    return db.select().from(competitors)
      .where(eq(competitors.businessId, businessId))
      .all();
  }

  async getCompetitor(id: number): Promise<Competitor | undefined> {
    return db.select().from(competitors).where(eq(competitors.id, id)).get();
  }

  async createCompetitor(competitor: InsertCompetitor): Promise<Competitor> {
    return db.insert(competitors).values(competitor).returning().get();
  }

  async updateCompetitor(id: number, data: Partial<InsertCompetitor>): Promise<Competitor | undefined> {
    return db.update(competitors).set(data).where(eq(competitors.id, id)).returning().get();
  }

  async deleteCompetitor(id: number): Promise<void> {
    db.delete(competitors).where(eq(competitors.id, id)).run();
  }

  // === AI SNAPSHOTS ===
  async getAiSnapshots(businessId: number): Promise<AiSnapshot[]> {
    return db.select().from(aiSnapshots)
      .where(eq(aiSnapshots.businessId, businessId))
      .orderBy(desc(aiSnapshots.date))
      .all();
  }

  async createAiSnapshot(snapshot: InsertAiSnapshot): Promise<AiSnapshot> {
    return db.insert(aiSnapshots).values(snapshot).returning().get();
  }

  // === ALERTS ===
  async getAlerts(): Promise<Alert[]> {
    return db.select().from(alerts)
      .orderBy(desc(alerts.date))
      .all();
  }

  async getAlertsByBusiness(businessId: number): Promise<Alert[]> {
    return db.select().from(alerts)
      .where(eq(alerts.businessId, businessId))
      .orderBy(desc(alerts.date))
      .all();
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    return db.insert(alerts).values(alert).returning().get();
  }

  async markAlertRead(id: number): Promise<void> {
    db.update(alerts).set({ isRead: 1 }).where(eq(alerts.id, id)).run();
  }

  async getUnreadAlertCount(): Promise<number> {
    const result = db.select({ count: sql<number>`count(*)` })
      .from(alerts)
      .where(eq(alerts.isRead, 0))
      .get();
    return result?.count ?? 0;
  }

  // === CONTENT GAPS ===
  async getContentGaps(businessId: number): Promise<ContentGap[]> {
    return db.select().from(contentGaps)
      .where(eq(contentGaps.businessId, businessId))
      .all();
  }

  async createContentGap(gap: InsertContentGap): Promise<ContentGap> {
    return db.insert(contentGaps).values(gap).returning().get();
  }

  async deleteContentGap(id: number): Promise<void> {
    db.delete(contentGaps).where(eq(contentGaps.id, id)).run();
  }

  // === LOCATIONS ===
  async getLocations(businessId: number): Promise<Location[]> {
    return db.select().from(locations)
      .where(eq(locations.businessId, businessId))
      .all();
  }

  async createLocation(location: InsertLocation): Promise<Location> {
    return db.insert(locations).values(location).returning().get();
  }

  async deleteLocation(id: number): Promise<void> {
    db.delete(locations).where(eq(locations.id, id)).run();
  }

  // === API KEYS ===
  async getApiKeys(): Promise<ApiKey[]> {
    return db.select().from(apiKeys).all();
  }

  async getApiKey(provider: string): Promise<ApiKey | undefined> {
    return db.select().from(apiKeys).where(eq(apiKeys.provider, provider)).get();
  }

  async upsertApiKey(provider: string, key: string): Promise<ApiKey> {
    const existing = await this.getApiKey(provider);
    if (existing) {
      return db.update(apiKeys)
        .set({ apiKey: key, isActive: 1, lastUsed: null })
        .where(eq(apiKeys.provider, provider))
        .returning().get();
    }
    return db.insert(apiKeys).values({ provider, apiKey: key, isActive: 1 }).returning().get();
  }

  async deleteApiKey(provider: string): Promise<void> {
    db.delete(apiKeys).where(eq(apiKeys.provider, provider)).run();
  }

  // === SCAN JOBS ===
  async createScanJob(job: InsertScanJob): Promise<ScanJob> {
    return db.insert(scanJobs).values(job).returning().get();
  }

  async updateScanJob(id: number, updates: Partial<ScanJob>): Promise<void> {
    db.update(scanJobs).set(updates).where(eq(scanJobs.id, id)).run();
  }

  async getScanJobs(businessId: number): Promise<ScanJob[]> {
    return db.select().from(scanJobs)
      .where(eq(scanJobs.businessId, businessId))
      .orderBy(desc(scanJobs.id))
      .all();
  }

  // === USERS ===
  async createUser(data: { username: string; password: string; displayName: string; role?: string }): Promise<User> {
    const passwordHash = bcrypt.hashSync(data.password, 10);
    return db.insert(users).values({
      username: data.username,
      passwordHash,
      displayName: data.displayName,
      role: data.role ?? "customer",
      isActive: 1,
      createdAt: new Date().toISOString(),
    }).returning().get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async getUserById(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUsers(): Promise<SafeUser[]> {
    const allUsers = db.select().from(users).all();
    return allUsers.map(({ passwordHash, ...rest }) => rest);
  }

  async updateUser(id: number, updates: Partial<{ displayName: string; isActive: number; passwordHash: string }>): Promise<void> {
    db.update(users).set(updates).where(eq(users.id, id)).run();
  }

  async deleteUser(id: number): Promise<void> {
    db.delete(userBusinesses).where(eq(userBusinesses.userId, id)).run();
    db.delete(users).where(eq(users.id, id)).run();
  }

  async assignBusiness(userId: number, businessId: number): Promise<void> {
    const existing = db.select().from(userBusinesses)
      .where(and(eq(userBusinesses.userId, userId), eq(userBusinesses.businessId, businessId)))
      .get();
    if (!existing) {
      db.insert(userBusinesses).values({ userId, businessId }).run();
    }
  }

  async unassignBusiness(userId: number, businessId: number): Promise<void> {
    db.delete(userBusinesses)
      .where(and(eq(userBusinesses.userId, userId), eq(userBusinesses.businessId, businessId)))
      .run();
  }

  async getUserBusinessIds(userId: number): Promise<number[]> {
    const rows = db.select().from(userBusinesses).where(eq(userBusinesses.userId, userId)).all();
    return rows.map((r) => r.businessId);
  }

  async getBusinessUsers(businessId: number): Promise<SafeUser[]> {
    const assignments = db.select().from(userBusinesses).where(eq(userBusinesses.businessId, businessId)).all();
    const result: SafeUser[] = [];
    for (const a of assignments) {
      const user = db.select().from(users).where(eq(users.id, a.userId)).get();
      if (user) {
        const { passwordHash, ...safe } = user;
        result.push(safe);
      }
    }
    return result;
  }
}

export const storage = new DatabaseStorage();
