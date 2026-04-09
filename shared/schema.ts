import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Businesses being tracked
export const businesses = sqliteTable("businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  industry: text("industry").notNull(),
  website: text("website"),
  location: text("location"),
  ga4Id: text("ga4_id"),
  // Rich context fields for better AI scan results
  keywords: text("keywords"),           // comma-separated terms the business wants to rank for
  services: text("services"),           // comma-separated list of services/products offered
  targetAudience: text("target_audience"), // who the business serves
  uniqueSellingPoints: text("unique_selling_points"), // what makes them different
  competitors: text("known_competitors"), // comma-separated competitor names
  customQueries: text("custom_queries"), // newline-separated custom search queries to track
});

export const insertBusinessSchema = createInsertSchema(businesses).omit({ id: true });
export type InsertBusiness = z.infer<typeof insertBusinessSchema>;
export type Business = typeof businesses.$inferSelect;

// AI Platforms we track
export const platforms = sqliteTable("platforms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  icon: text("icon").notNull(),
  color: text("color").notNull(),
});

export const insertPlatformSchema = createInsertSchema(platforms).omit({ id: true });
export type InsertPlatform = z.infer<typeof insertPlatformSchema>;
export type Platform = typeof platforms.$inferSelect;

// Search tracking records
export const searchRecords = sqliteTable("search_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  platformId: integer("platform_id").notNull(),
  query: text("query").notNull(),
  mentioned: integer("mentioned").notNull().default(0),
  position: integer("position"),
  date: text("date").notNull(),
});

export const insertSearchRecordSchema = createInsertSchema(searchRecords).omit({ id: true });
export type InsertSearchRecord = z.infer<typeof insertSearchRecordSchema>;
export type SearchRecord = typeof searchRecords.$inferSelect;

// Optimized prompts for AI SEO
export const optimizedPrompts = sqliteTable("optimized_prompts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  prompt: text("prompt").notNull(),
  category: text("category").notNull(),
  score: integer("score").notNull().default(0),
  tip: text("tip").notNull(),
});

export const insertOptimizedPromptSchema = createInsertSchema(optimizedPrompts).omit({ id: true });
export type InsertOptimizedPrompt = z.infer<typeof insertOptimizedPromptSchema>;
export type OptimizedPrompt = typeof optimizedPrompts.$inferSelect;

// Referral tracking
export const referrals = sqliteTable("referrals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  platformId: integer("platform_id").notNull(),
  searchRecordId: integer("search_record_id"),
  query: text("query").notNull(),
  landingPage: text("landing_page").notNull(),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  converted: integer("converted").notNull().default(0),
  conversionType: text("conversion_type"),
  sessionDuration: integer("session_duration"),
  pagesViewed: integer("pages_viewed").notNull().default(1),
  deviceType: text("device_type").notNull().default("desktop"),
  date: text("date").notNull(),
  timestamp: text("timestamp").notNull(),
});

export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referrals.$inferSelect;

// Competitors
export const competitors = sqliteTable("competitors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  website: text("website"),
  notes: text("notes"),
});

export const insertCompetitorSchema = createInsertSchema(competitors).omit({ id: true });
export type InsertCompetitor = z.infer<typeof insertCompetitorSchema>;
export type Competitor = typeof competitors.$inferSelect;

// AI Response Snapshots
export const aiSnapshots = sqliteTable("ai_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  platformId: integer("platform_id").notNull(),
  query: text("query").notNull(),
  responseText: text("response_text").notNull(),
  sentiment: text("sentiment").notNull(),
  mentionedAccurate: integer("mentioned_accurate").notNull().default(1),
  flaggedIssues: text("flagged_issues"),
  date: text("date").notNull(),
});

export const insertAiSnapshotSchema = createInsertSchema(aiSnapshots).omit({ id: true });
export type InsertAiSnapshot = z.infer<typeof insertAiSnapshotSchema>;
export type AiSnapshot = typeof aiSnapshots.$inferSelect;

// Alerts
export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  severity: text("severity").notNull().default("info"),
  isRead: integer("is_read").notNull().default(0),
  date: text("date").notNull(),
});

export const insertAlertSchema = createInsertSchema(alerts).omit({ id: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

// Content Gaps
export const contentGaps = sqliteTable("content_gaps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  query: text("query").notNull(),
  category: text("category").notNull(),
  currentlyRanking: integer("currently_ranking").notNull().default(0),
  recommendedContent: text("recommended_content").notNull(),
  contentType: text("content_type").notNull(),
  priority: text("priority").notNull().default("medium"),
});

export const insertContentGapSchema = createInsertSchema(contentGaps).omit({ id: true });
export type InsertContentGap = z.infer<typeof insertContentGapSchema>;
export type ContentGap = typeof contentGaps.$inferSelect;

// Locations
export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
});

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true });
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

// Users
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("customer"),
  isActive: integer("is_active").notNull().default(1),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "passwordHash">;

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// User-Business assignments
export const userBusinesses = sqliteTable("user_businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  businessId: integer("business_id").notNull(),
});

export const insertUserBusinessSchema = createInsertSchema(userBusinesses).omit({ id: true });
export type InsertUserBusiness = z.infer<typeof insertUserBusinessSchema>;
export type UserBusiness = typeof userBusinesses.$inferSelect;

// API Keys
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  isActive: integer("is_active").notNull().default(1),
  lastUsed: text("last_used"),
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true });
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type ApiKey = typeof apiKeys.$inferSelect;

// Scan Jobs
export const scanJobs = sqliteTable("scan_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  status: text("status").notNull().default("pending"),
  totalQueries: integer("total_queries").notNull().default(0),
  completedQueries: integer("completed_queries").notNull().default(0),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  error: text("error"),
});

export const insertScanJobSchema = createInsertSchema(scanJobs).omit({ id: true });
export type InsertScanJob = z.infer<typeof insertScanJobSchema>;
export type ScanJob = typeof scanJobs.$inferSelect;

// API Usage / Spend Tracking
export const apiUsage = sqliteTable("api_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  estimatedCost: text("estimated_cost").notNull(), // stored as string for precision, e.g. "0.0035"
  date: text("date").notNull(), // ISO date YYYY-MM-DD
  timestamp: text("timestamp").notNull(), // ISO datetime
});

export const insertApiUsageSchema = createInsertSchema(apiUsage).omit({ id: true });
export type InsertApiUsage = z.infer<typeof insertApiUsageSchema>;
export type ApiUsage = typeof apiUsage.$inferSelect;

// Click Events (raw click data from embedded snippet)
export const clickEvents = sqliteTable("click_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").notNull(),
  elementText: text("element_text"),
  elementUrl: text("element_url"),
  referrer: text("referrer"),
  landingPage: text("landing_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  deviceType: text("device_type"),
  timestamp: text("timestamp").notNull(),
});

export const insertClickEventSchema = createInsertSchema(clickEvents).omit({ id: true });
export type InsertClickEvent = z.infer<typeof insertClickEventSchema>;
export type ClickEvent = typeof clickEvents.$inferSelect;

// API Budget Settings
export const apiSettings = sqliteTable("api_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dailyBudget: text("daily_budget").notNull().default("10.00"), // dollars
  autoPauseEnabled: integer("auto_pause_enabled").notNull().default(1),
});

export const insertApiSettingsSchema = createInsertSchema(apiSettings).omit({ id: true });
export type InsertApiSettings = z.infer<typeof insertApiSettingsSchema>;
export type ApiSettings = typeof apiSettings.$inferSelect;
