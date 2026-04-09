import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import {
  businesses, platforms, searchRecords, optimizedPrompts, referrals,
  competitors, aiSnapshots, alerts, contentGaps, locations,
  apiKeys, scanJobs, apiUsage, apiSettings,
  users, userBusinesses, loginSchema,
  insertBusinessSchema, insertSearchRecordSchema,
  insertCompetitorSchema, insertAlertSchema, insertLocationSchema,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import { runScan, testApiKey, generateScanQueries, PROVIDER_COST_PER_CALL } from "./ai-providers";
import { requireAuth, requireAdmin, createSession, deleteSession, getSession } from "./auth";
import bcrypt from "bcryptjs";
import { validateSearchRecord, validateReferral, validateAiSnapshot } from "./data-validation";
import { ensureArchiveTables, runArchival } from "./data-archival";

// Seed default AI platforms
function seedPlatforms() {
  const existing = db.select().from(platforms).all();
  if (existing.length === 0) {
    const defaultPlatforms = [
      { name: "ChatGPT", icon: "bot", color: "#10a37f" },
      { name: "Perplexity", icon: "search", color: "#20808d" },
      { name: "Google Gemini", icon: "sparkles", color: "#4285f4" },
      { name: "Claude", icon: "brain", color: "#d97706" },
      { name: "Copilot", icon: "cpu", color: "#0078d4" },
      { name: "Meta AI", icon: "globe", color: "#0668e1" },
    ];
    for (const p of defaultPlatforms) {
      db.insert(platforms).values(p).run();
    }
  }
}

// Auto-scan runs in the background after business creation (fire-and-forget).
// It uses the same logic as the /scan endpoint but doesn't block the response.
async function autoScanBusiness(businessId: number, businessName: string, industry: string, location: string | null) {
  try {
    const keys = await storage.getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive);
    if (activeKeys.length === 0) {
      console.log(`[Auto-Scan] No API keys configured — skipping initial scan for "${businessName}"`);
      return;
    }

    const queries = generateScanQueries(businessName, industry, location);
    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.name, p.id]));

    const job = await storage.createScanJob({
      businessId,
      status: "running",
      totalQueries: queries.length * activeKeys.length,
      completedQueries: 0,
      startedAt: new Date().toISOString(),
    });

    let completed = 0;
    let mentionCount = 0;
    const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));

    for await (const result of runScan(businessName, queries, keyInputs)) {
      completed++;
      const platformId = platformMap[result.platform] ?? 1;
      const dateStr = new Date().toISOString().split("T")[0];

      await storage.createSearchRecord({
        businessId,
        platformId,
        query: result.query,
        mentioned: result.mentioned ? 1 : 0,
        position: result.position,
        date: dateStr,
      });

      // Track API cost
      const providerKey = keyInputs.find(k => {
        const pMap: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };
        return pMap[k.provider] === result.platform;
      });
      if (providerKey) {
        const cost = PROVIDER_COST_PER_CALL[providerKey.provider] ?? 0.005;
        db.insert(apiUsage).values({
          provider: providerKey.provider,
          estimatedCost: cost.toFixed(6),
          date: dateStr,
          timestamp: new Date().toISOString(),
        }).run();
      }

      if (result.mentioned) mentionCount++;

      if (result.responseText) {
        await storage.createAiSnapshot({
          businessId,
          platformId,
          query: result.query,
          responseText: result.responseText,
          sentiment: result.sentiment,
          mentionedAccurate: result.mentioned ? 1 : 0,
          flaggedIssues: null,
          date: dateStr,
        });
      }

      await storage.updateScanJob(job.id, { completedQueries: completed });
    }

    await storage.updateScanJob(job.id, {
      status: "completed",
      completedQueries: completed,
      completedAt: new Date().toISOString(),
    });

    console.log(`[Auto-Scan] Finished "${businessName}": ${completed} queries, ${mentionCount} mentions`);
  } catch (err: any) {
    console.error(`[Auto-Scan] Error for "${businessName}":`, err.message);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  try {
  console.log("[init] registerRoutes() started — beginning database initialization");

  // Create tables
  console.log("[init] Creating core tables...");
  db.run(sql`CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    industry TEXT NOT NULL,
    website TEXT,
    location TEXT,
    ga4_id TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS platforms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS search_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    mentioned INTEGER NOT NULL DEFAULT 0,
    position INTEGER,
    date TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS optimized_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    prompt TEXT NOT NULL,
    category TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    tip TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS competitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    website TEXT,
    notes TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS ai_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    platform_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    response_text TEXT NOT NULL,
    sentiment TEXT NOT NULL,
    mentioned_accurate INTEGER NOT NULL DEFAULT 1,
    flagged_issues TEXT,
    date TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    is_read INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS content_gaps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    query TEXT NOT NULL,
    category TEXT NOT NULL,
    currently_ranking INTEGER NOT NULL DEFAULT 0,
    recommended_content TEXT NOT NULL,
    content_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium'
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    api_key TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_used TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS scan_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    total_queries INTEGER NOT NULL DEFAULT 0,
    completed_queries INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    error TEXT
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    estimated_cost TEXT NOT NULL,
    date TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS api_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    daily_budget TEXT NOT NULL DEFAULT '10.00',
    auto_pause_enabled INTEGER NOT NULL DEFAULT 1
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS user_businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    business_id INTEGER NOT NULL
  )`);

  console.log("[init] Core tables created successfully");

  // === DATABASE INDEXES for query performance ===
  console.log("[init] Creating database indexes...");
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_search_records_business_date
    ON search_records(business_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_search_records_business_mentioned
    ON search_records(business_id, mentioned)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_referrals_business_date
    ON referrals(business_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_referrals_business_converted
    ON referrals(business_id, converted)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_ai_snapshots_business_date
    ON ai_snapshots(business_id, date)`);
  console.log("[init] Database indexes created successfully");

  // Ensure archive tables exist
  console.log("[init] Running ensureArchiveTables()...");
  try {
    ensureArchiveTables();
    console.log("[init] ensureArchiveTables() completed successfully");
  } catch (archiveErr) {
    console.error("[init] ERROR in ensureArchiveTables():", archiveErr);
    throw archiveErr;
  }

  // Seed default budget settings if none exist
  console.log("[init] Checking API settings...");
  const existingSettings = db.select().from(apiSettings).all();
  if (existingSettings.length === 0) {
    db.insert(apiSettings).values({ dailyBudget: "10.00", autoPauseEnabled: 1 }).run();
    console.log("[init] Default API settings seeded");
  } else {
    console.log("[init] API settings already exist, skipping seed");
  }

  // Re-seed after table creation
  console.log("[init] Running seedPlatforms()...");
  try {
    seedPlatforms();
    console.log("[init] seedPlatforms() completed successfully");
  } catch (seedErr) {
    console.error("[init] ERROR in seedPlatforms():", seedErr);
    throw seedErr;
  }

  // Seed admin user if no users exist
  console.log("[init] Checking for existing users...");
  try {
    const existingUsers = db.select().from(users).all();
    if (existingUsers.length === 0) {
      console.log("[init] No users found — creating default admin user...");
      await storage.createUser({
        username: "admin",
        password: "worthcreative2026",
        displayName: "Worth Creative",
        role: "admin",
      });
      console.log("[init] Default admin user created successfully");
    } else {
      console.log(`[init] Found ${existingUsers.length} existing user(s), skipping admin seed`);
    }
  } catch (userErr) {
    console.error("[init] ERROR creating admin user:", userErr);
    throw userErr;
  }

  // === AUTH ROUTES (no auth required) ===
  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Username and password required" });

    const { username, password } = parsed.data;
    const user = await storage.getUserByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: "Account is inactive" });
    }

    const token = createSession(user.id, user.role);
    res.cookie("session", token, { httpOnly: true, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 });
    const { passwordHash, ...safeUser } = user;
    res.json({ token, user: safeUser });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = req.cookies?.session || req.headers.authorization?.replace("Bearer ", "");
    if (token) deleteSession(token);
    res.clearCookie("session");
    res.json({ success: true });
  });

  app.get("/api/auth/me", (req, res) => {
    const token = req.cookies?.session || req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Not authenticated" });
    const session = getSession(token);
    if (!session) return res.status(401).json({ error: "Invalid or expired session" });

    storage.getUserById(session.userId).then((user) => {
      if (!user) return res.status(401).json({ error: "User not found" });
      const { passwordHash, ...safeUser } = user;
      res.json(safeUser);
    });
  });

  // === Apply auth to all remaining routes ===
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    // Skip auth routes
    if (req.path.startsWith("/auth/")) return next();
    requireAuth(req, res, next);
  });

  // === Business access check middleware for customer users ===
  app.use("/api/businesses/:id", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (req.user.role === "admin") return next();
    const businessId = parseInt(req.params.id as string);
    if (isNaN(businessId)) return next();
    const allowed = await storage.getUserBusinessIds(req.user.userId);
    if (!allowed.includes(businessId)) {
      return res.status(403).json({ error: "Access denied to this business" });
    }
    next();
  });

  // === ADMIN ROUTES ===
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getUsers();
    res.json(allUsers);
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: "username, password, and displayName required" });
    }
    const allUsers = await storage.getUsers();
    const customerCount = allUsers.filter((u) => u.role === "customer").length;
    if (customerCount >= 5) {
      return res.status(400).json({ error: "Maximum 5 customer accounts reached" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) return res.status(400).json({ error: "Username already exists" });
    const user = await storage.createUser({ username, password, displayName, role: "customer" });
    const { passwordHash, ...safe } = user;
    res.json(safe);
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id as string);
    const user = await storage.getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.role === "admin") return res.status(400).json({ error: "Cannot delete admin" });
    await storage.deleteUser(id);
    res.json({ success: true });
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id as string);
    const user = await storage.getUserById(id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const updates: any = {};
    if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
    if (req.body.isActive !== undefined) updates.isActive = req.body.isActive ? 1 : 0;
    if (req.body.password) updates.passwordHash = bcrypt.hashSync(req.body.password, 10);
    await storage.updateUser(id, updates);
    const updated = await storage.getUserById(id);
    if (!updated) return res.status(404).json({ error: "User not found" });
    const { passwordHash, ...safe } = updated;
    res.json(safe);
  });

  app.post("/api/admin/users/:id/assign-business", requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id as string);
    const { businessId } = req.body;
    if (!businessId) return res.status(400).json({ error: "businessId required" });
    await storage.assignBusiness(userId, businessId);
    res.json({ success: true });
  });

  app.delete("/api/admin/users/:id/assign-business/:businessId", requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id as string);
    const businessId = parseInt(req.params.businessId as string);
    await storage.unassignBusiness(userId, businessId);
    res.json({ success: true });
  });

  app.get("/api/admin/users/:id/businesses", requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id as string);
    const ids = await storage.getUserBusinessIds(userId);
    res.json(ids);
  });

  // === BUSINESSES ===
  app.get("/api/businesses", async (req, res) => {
    const allBiz = await storage.getBusinesses();
    if (req.user?.role === "admin") return res.json(allBiz);
    const allowed = await storage.getUserBusinessIds(req.user!.userId);
    res.json(allBiz.filter((b) => allowed.includes(b.id)));
  });

  app.get("/api/businesses/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const business = await storage.getBusiness(id);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json(business);
  });

  app.post("/api/businesses", async (req, res) => {
    const parsed = insertBusinessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const business = await storage.createBusiness(parsed.data);

    // Fire-and-forget: run an initial AI scan in the background so the user
    // gets real data instead of simulated data. The response returns immediately.
    autoScanBusiness(business.id, business.name, business.industry, business.location ?? null);

    res.json(business);
  });

  app.patch("/api/businesses/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const business = await storage.updateBusiness(id, req.body);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json(business);
  });

  app.delete("/api/businesses/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteBusiness(id);
    res.json({ success: true });
  });

  // === PLATFORMS ===
  app.get("/api/platforms", async (_req, res) => {
    const result = await storage.getPlatforms();
    res.json(result);
  });

  // === SEARCH RECORDS & STATS ===
  app.get("/api/businesses/:id/records", async (req, res) => {
    const id = parseInt(req.params.id);
    const records = await storage.getSearchRecords(id);
    res.json(records);
  });

  app.post("/api/businesses/:id/records", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const parsed = insertSearchRecordSchema.safeParse({ ...req.body, businessId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const record = await storage.createSearchRecord(parsed.data);
    res.json(record);
  });

  app.get("/api/businesses/:id/stats", async (req, res) => {
    const id = parseInt(req.params.id);
    const stats = await storage.getSearchStats(id);
    res.json(stats);
  });

  app.get("/api/businesses/:id/trend", async (req, res) => {
    const id = parseInt(req.params.id);
    const trend = await storage.getSearchTrend(id);
    res.json(trend);
  });

  app.get("/api/businesses/:id/platform-breakdown", async (req, res) => {
    const id = parseInt(req.params.id);
    const breakdown = await storage.getPlatformBreakdown(id);
    res.json(breakdown);
  });

  // === DASHBOARD SUMMARY (cross-business aggregate) ===
  app.get("/api/dashboard/summary", async (req, res) => {
    const allBiz = await storage.getBusinesses();
    let ids: number[];
    if (req.user?.role === "admin") {
      ids = allBiz.map((b) => b.id);
    } else {
      const allowed = await storage.getUserBusinessIds(req.user!.userId);
      ids = allBiz.filter((b) => allowed.includes(b.id)).map((b) => b.id);
    }
    const summary = await storage.getDashboardSummary(ids);
    res.json(summary);
  });

  // === QUERY PERFORMANCE ===
  app.get("/api/businesses/:id/query-performance", async (req, res) => {
    const id = parseInt(req.params.id);
    const rows = await storage.getQueryPerformance(id);
    res.json(rows);
  });

  // === VISIBILITY SCORES ===
  app.get("/api/businesses/:id/visibility-scores", async (req, res) => {
    const id = parseInt(req.params.id);
    const scores = await storage.getVisibilityScores(id);
    res.json(scores);
  });

  // === OPTIMIZED PROMPTS ===
  app.get("/api/businesses/:id/prompts", async (req, res) => {
    const id = parseInt(req.params.id);
    const prompts = await storage.getOptimizedPrompts(id);
    res.json(prompts);
  });

  // === REFERRALS ===
  app.get("/api/businesses/:id/referrals", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await storage.getReferrals(id);
    res.json(result);
  });

  app.get("/api/businesses/:id/referral-stats", async (req, res) => {
    const id = parseInt(req.params.id);
    const stats = await storage.getReferralStats(id);
    res.json(stats);
  });

  app.get("/api/businesses/:id/referral-trend", async (req, res) => {
    const id = parseInt(req.params.id);
    const trend = await storage.getReferralTrend(id);
    res.json(trend);
  });

  app.get("/api/businesses/:id/referrals-by-platform", async (req, res) => {
    const id = parseInt(req.params.id);
    const breakdown = await storage.getReferralsByPlatform(id);
    res.json(breakdown);
  });

  app.get("/api/businesses/:id/conversions-by-type", async (req, res) => {
    const id = parseInt(req.params.id);
    const types = await storage.getConversionsByType(id);
    res.json(types);
  });

  app.get("/api/businesses/:id/top-referral-queries", async (req, res) => {
    const id = parseInt(req.params.id);
    const queries = await storage.getTopReferralQueries(id);
    res.json(queries);
  });

  // === UTM LINK GENERATOR ===
  app.post("/api/businesses/:id/generate-utm", async (req, res) => {
    const id = parseInt(req.params.id);
    const business = await storage.getBusiness(id);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const { baseUrl, platform, campaign } = req.body;
    if (!baseUrl || !platform) return res.status(400).json({ error: "baseUrl and platform required" });

    const platformSlug = platform.toLowerCase().replace(/\s+/g, "-");
    const url = new URL(baseUrl);
    url.searchParams.set("utm_source", platformSlug);
    url.searchParams.set("utm_medium", "ai-search");
    if (campaign) url.searchParams.set("utm_campaign", campaign);
    url.searchParams.set("utm_content", `aiseo-${id}`);

    res.json({ url: url.toString() });
  });

  // === COMPETITORS ===
  app.get("/api/businesses/:id/competitors", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await storage.getCompetitors(id);
    res.json(result);
  });

  app.post("/api/businesses/:id/competitors", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const parsed = insertCompetitorSchema.safeParse({ ...req.body, businessId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const competitor = await storage.createCompetitor(parsed.data);
    res.json(competitor);
  });

  app.delete("/api/competitors/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteCompetitor(id);
    res.json({ success: true });
  });

  // === AI SNAPSHOTS ===
  app.get("/api/businesses/:id/snapshots", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await storage.getAiSnapshots(id);
    res.json(result);
  });

  // === ALERTS ===
  app.get("/api/alerts", async (req, res) => {
    const allAlerts = await storage.getAlerts();
    if (req.user?.role === "admin") return res.json(allAlerts);
    const allowed = await storage.getUserBusinessIds(req.user!.userId);
    res.json(allAlerts.filter((a) => allowed.includes(a.businessId)));
  });

  app.get("/api/alerts/unread-count", async (req, res) => {
    if (req.user?.role === "admin") {
      const count = await storage.getUnreadAlertCount();
      return res.json({ count });
    }
    const allAlerts = await storage.getAlerts();
    const allowed = await storage.getUserBusinessIds(req.user!.userId);
    const count = allAlerts.filter((a) => allowed.includes(a.businessId) && !a.isRead).length;
    res.json({ count });
  });

  app.patch("/api/alerts/:id/read", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.markAlertRead(id);
    res.json({ success: true });
  });

  app.post("/api/alerts", async (req, res) => {
    const parsed = insertAlertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const alert = await storage.createAlert(parsed.data);
    res.json(alert);
  });

  // === CONTENT GAPS ===
  app.get("/api/businesses/:id/content-gaps", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await storage.getContentGaps(id);
    res.json(result);
  });

  // === LOCATIONS ===
  app.get("/api/businesses/:id/locations", async (req, res) => {
    const id = parseInt(req.params.id);
    const result = await storage.getLocations(id);
    res.json(result);
  });

  app.post("/api/businesses/:id/locations", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const parsed = insertLocationSchema.safeParse({ ...req.body, businessId });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const location = await storage.createLocation(parsed.data);
    res.json(location);
  });

  app.delete("/api/locations/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    await storage.deleteLocation(id);
    res.json({ success: true });
  });

  // === EXPORT CSV ===
  app.get("/api/businesses/:id/export/search-csv", async (req, res) => {
    const id = parseInt(req.params.id);
    const records = await storage.getSearchRecords(id);
    const plats = await storage.getPlatforms();
    const platMap = Object.fromEntries(plats.map(p => [p.id, p.name]));

    const header = "Date,Platform,Query,Mentioned,Position\n";
    const rows = records.map(r =>
      `${r.date},"${platMap[r.platformId] || "Unknown"}","${r.query.replace(/"/g, '""')}",${r.mentioned ? "Yes" : "No"},${r.position ?? ""}`
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="search-log-${id}.csv"`);
    res.send(header + rows);
  });

  app.get("/api/businesses/:id/export/referral-csv", async (req, res) => {
    const id = parseInt(req.params.id);
    const refs = await storage.getReferrals(id);
    const plats = await storage.getPlatforms();
    const platMap = Object.fromEntries(plats.map(p => [p.id, p.name]));

    const header = "Date,Timestamp,Platform,Query,Landing Page,Converted,Conversion Type,Session Duration,Pages Viewed,Device\n";
    const rows = refs.map(r =>
      `${r.date},${r.timestamp},"${platMap[r.platformId] || "Unknown"}","${r.query.replace(/"/g, '""')}","${r.landingPage}",${r.converted ? "Yes" : "No"},${r.conversionType || ""},${r.sessionDuration || ""},${r.pagesViewed},${r.deviceType}`
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="referrals-${id}.csv"`);
    res.send(header + rows);
  });

  app.get("/api/businesses/:id/export/summary-csv", async (req, res) => {
    const id = parseInt(req.params.id);
    const business = await storage.getBusiness(id);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const stats = await storage.getSearchStats(id);
    const refStats = await storage.getReferralStats(id);
    const gaps = await storage.getContentGaps(id);
    const comps = await storage.getCompetitors(id);
    const snaps = await storage.getAiSnapshots(id);

    let csv = "Business Summary Report\n\n";
    csv += `Business Name,${business.name}\n`;
    csv += `Industry,${business.industry}\n`;
    csv += `Website,${business.website || "N/A"}\n\n`;

    csv += "Search Stats\n";
    csv += `Total Searches,${stats.totalSearches}\n`;
    csv += `Total Mentions,${stats.totalMentions}\n`;
    csv += `Mention Rate,${stats.mentionRate}%\n`;
    csv += `Avg Position,${stats.avgPosition || "N/A"}\n`;
    csv += `Platforms Tracked,${stats.platformCount}\n\n`;

    csv += "Referral Stats\n";
    csv += `Total Referrals,${refStats.totalReferrals}\n`;
    csv += `Total Conversions,${refStats.totalConversions}\n`;
    csv += `Conversion Rate,${refStats.conversionRate}%\n`;
    csv += `Click-Through Rate,${refStats.clickThroughRate}%\n\n`;

    csv += "Competitors\n";
    csv += "Name,Website\n";
    comps.forEach(c => { csv += `"${c.name}",${c.website || "N/A"}\n`; });
    csv += "\n";

    csv += "Content Gaps\n";
    csv += "Query,Priority,Content Type,Currently Ranking\n";
    gaps.forEach(g => {
      csv += `"${g.query}",${g.priority},${g.contentType},${g.currentlyRanking ? "Yes" : "No"}\n`;
    });
    csv += "\n";

    csv += "AI Snapshots\n";
    csv += "Date,Query,Sentiment,Accurate\n";
    snaps.forEach(s => {
      csv += `${s.date},"${s.query.replace(/"/g, '""')}",${s.sentiment},${s.mentionedAccurate ? "Yes" : "No"}\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="summary-${id}.csv"`);
    res.send(csv);
  });

  // === API KEYS (admin only) ===
  app.get("/api/api-keys", requireAdmin, async (_req, res) => {
    const keys = await storage.getApiKeys();
    const masked = keys.map((k) => ({
      ...k,
      apiKey: k.apiKey.slice(0, 8) + "...",
    }));
    res.json(masked);
  });

  app.post("/api/api-keys", requireAdmin, async (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) return res.status(400).json({ error: "provider and apiKey required" });
    const key = await storage.upsertApiKey(provider, apiKey);
    res.json({ ...key, apiKey: key.apiKey.slice(0, 8) + "..." });
  });

  app.delete("/api/api-keys/:provider", requireAdmin, async (req, res) => {
    await storage.deleteApiKey(req.params.provider as string);
    res.json({ success: true });
  });

  app.post("/api/api-keys/test", requireAdmin, async (req, res) => {
    const { provider, apiKey } = req.body;
    if (!provider || !apiKey) return res.status(400).json({ error: "provider and apiKey required" });
    const result = await testApiKey(provider, apiKey);
    res.json(result);
  });

  // === SCAN ===
  app.post("/api/businesses/:id/scan", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const keys = await storage.getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive);
    if (activeKeys.length === 0) {
      return res.status(400).json({ error: "No API keys configured. Add keys in the API Keys page." });
    }

    // Check daily budget before scanning
    const settings = db.select().from(apiSettings).get();
    const dailyBudget = parseFloat(settings?.dailyBudget ?? "10.00");
    const today = new Date().toISOString().split("T")[0];
    const todayUsage = db.select({ total: sql<string>`coalesce(sum(cast(estimated_cost as real)), 0)` })
      .from(apiUsage).where(sql`date = ${today}`).get();
    const currentSpend = parseFloat(todayUsage?.total ?? "0");

    const queries = generateScanQueries(business.name, business.industry, business.location ?? null);
    const totalQueries = queries.length * activeKeys.length;

    // Estimate cost of this scan
    const estimatedScanCost = activeKeys.reduce((sum, k) => sum + (PROVIDER_COST_PER_CALL[k.provider] ?? 0.005) * queries.length, 0);

    if (settings?.autoPauseEnabled && (currentSpend + estimatedScanCost) > dailyBudget) {
      return res.status(429).json({
        error: `Daily budget limit reached. Today's spend: $${currentSpend.toFixed(2)} / $${dailyBudget.toFixed(2)}. This scan would cost ~$${estimatedScanCost.toFixed(3)}.`,
        currentSpend,
        dailyBudget,
        estimatedScanCost,
      });
    }

    const job = await storage.createScanJob({
      businessId,
      status: "running",
      totalQueries,
      completedQueries: 0,
      startedAt: new Date().toISOString(),
    });

    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.name, p.id]));

    let completed = 0;
    let mentionCount = 0;

    try {
      const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));
      for await (const result of runScan(business.name, queries, keyInputs)) {
        completed++;
        const platformId = platformMap[result.platform] ?? 1;
        const dateStr = new Date().toISOString().split("T")[0];

        await storage.createSearchRecord({
          businessId,
          platformId,
          query: result.query,
          mentioned: result.mentioned ? 1 : 0,
          position: result.position,
          date: dateStr,
        });

        // Track API cost
        const providerKey = keyInputs.find(k => {
          const pMap: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };
          return pMap[k.provider] === result.platform;
        });
        if (providerKey) {
          const cost = PROVIDER_COST_PER_CALL[providerKey.provider] ?? 0.005;
          db.insert(apiUsage).values({
            provider: providerKey.provider,
            estimatedCost: cost.toFixed(6),
            date: dateStr,
            timestamp: new Date().toISOString(),
          }).run();
        }

        if (result.mentioned) mentionCount++;

        if (result.responseText) {
          await storage.createAiSnapshot({
            businessId,
            platformId,
            query: result.query,
            responseText: result.responseText,
            sentiment: result.sentiment,
            mentionedAccurate: result.mentioned ? 1 : 0,
            flaggedIssues: null,
            date: dateStr,
          });
        }

        await storage.updateScanJob(job.id, { completedQueries: completed });
      }

      await storage.updateScanJob(job.id, {
        status: "completed",
        completedQueries: completed,
        completedAt: new Date().toISOString(),
      });

      res.json({
        jobId: job.id,
        totalQueries: completed,
        platforms: activeKeys.length,
        mentions: mentionCount,
      });
    } catch (err: any) {
      await storage.updateScanJob(job.id, {
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/businesses/:id/scan-jobs", async (req, res) => {
    const id = parseInt(req.params.id);
    const jobs = await storage.getScanJobs(id);
    res.json(jobs);
  });

  // === MANUAL LOG SEARCH ===
  app.post("/api/businesses/:id/log-search", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const { platformName, query, responseText, mentioned } = req.body;
    if (!platformName || !query) return res.status(400).json({ error: "platformName and query required" });

    const allPlatforms = await storage.getPlatforms();
    const platform = allPlatforms.find((p) => p.name === platformName);
    if (!platform) return res.status(400).json({ error: `Unknown platform: ${platformName}` });

    const dateStr = new Date().toISOString().split("T")[0];
    const record = await storage.createSearchRecord({
      businessId,
      platformId: platform.id,
      query,
      mentioned: mentioned ? 1 : 0,
      position: null,
      date: dateStr,
    });

    if (responseText) {
      await storage.createAiSnapshot({
        businessId,
        platformId: platform.id,
        query,
        responseText,
        sentiment: "neutral",
        mentionedAccurate: mentioned ? 1 : 0,
        flaggedIssues: null,
        date: dateStr,
      });
    }

    res.json(record);
  });

  // === API BUDGET & USAGE ===
  app.get("/api/usage/today", async (_req, res) => {
    const today = new Date().toISOString().split("T")[0];
    const todayRows = db.select().from(apiUsage).where(sql`date = ${today}`).all();
    const totalSpend = todayRows.reduce((sum, r) => sum + parseFloat(r.estimatedCost), 0);
    const callCount = todayRows.length;
    const byProvider: Record<string, { calls: number; cost: number }> = {};
    for (const row of todayRows) {
      if (!byProvider[row.provider]) byProvider[row.provider] = { calls: 0, cost: 0 };
      byProvider[row.provider].calls++;
      byProvider[row.provider].cost += parseFloat(row.estimatedCost);
    }

    const settings = db.select().from(apiSettings).get();
    const dailyBudget = parseFloat(settings?.dailyBudget ?? "10.00");
    const pctUsed = dailyBudget > 0 ? Math.round((totalSpend / dailyBudget) * 100) : 0;

    res.json({
      date: today,
      totalSpend: Math.round(totalSpend * 1000) / 1000,
      callCount,
      dailyBudget,
      pctUsed,
      autoPauseEnabled: settings?.autoPauseEnabled ?? 1,
      byProvider,
      status: pctUsed >= 100 ? "exceeded" : pctUsed >= 75 ? "warning" : "ok",
    });
  });

  app.get("/api/usage/history", async (_req, res) => {
    const rows = db.select({
      date: apiUsage.date,
      totalSpend: sql<string>`sum(cast(estimated_cost as real))`,
      callCount: sql<number>`count(*)`,
    }).from(apiUsage).groupBy(apiUsage.date).orderBy(sql`date desc`).limit(30).all();
    res.json(rows.map(r => ({ ...r, totalSpend: Math.round(parseFloat(r.totalSpend ?? "0") * 1000) / 1000 })));
  });

  app.get("/api/settings/budget", async (_req, res) => {
    const settings = db.select().from(apiSettings).get();
    res.json({
      dailyBudget: settings?.dailyBudget ?? "10.00",
      autoPauseEnabled: settings?.autoPauseEnabled ?? 1,
    });
  });

  app.patch("/api/settings/budget", async (req, res) => {
    const { dailyBudget, autoPauseEnabled } = req.body;
    const settings = db.select().from(apiSettings).get();
    if (settings) {
      if (dailyBudget !== undefined) {
        db.update(apiSettings).set({ dailyBudget: String(dailyBudget) }).where(sql`id = ${settings.id}`).run();
      }
      if (autoPauseEnabled !== undefined) {
        db.update(apiSettings).set({ autoPauseEnabled: autoPauseEnabled ? 1 : 0 }).where(sql`id = ${settings.id}`).run();
      }
    }
    const updated = db.select().from(apiSettings).get();
    res.json(updated);
  });

  // === DATA QUALITY ENDPOINTS ===

  // GET /api/data-quality/:businessId — full quality report
  app.get("/api/data-quality/:businessId", async (req, res) => {
    const businessId = parseInt(req.params.businessId);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    if (req.user?.role !== "admin") {
      const allowed = await storage.getUserBusinessIds(req.user!.userId);
      if (!allowed.includes(businessId)) {
        return res.status(403).json({ error: "Access denied to this business" });
      }
    }
    const report = await storage.getDataQualityMetrics(businessId);
    res.json(report);
  });

  // GET /api/data/freshness/:businessId — freshness stats only
  app.get("/api/data/freshness/:businessId", async (req, res) => {
    const businessId = parseInt(req.params.businessId);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    if (req.user?.role !== "admin") {
      const allowed = await storage.getUserBusinessIds(req.user!.userId);
      if (!allowed.includes(businessId)) {
        return res.status(403).json({ error: "Access denied to this business" });
      }
    }
    const freshness = await storage.getDataFreshness(businessId);
    res.json(freshness);
  });

  // POST /api/data/validate — validate incoming data without persisting
  app.post("/api/data/validate", async (req, res) => {
    const { type, data } = req.body;
    if (!type || !data) {
      return res.status(400).json({ error: "type and data are required" });
    }
    let result;
    switch (type) {
      case "searchRecord":
        result = validateSearchRecord(data);
        break;
      case "referral":
        result = validateReferral(data);
        break;
      case "aiSnapshot":
        result = validateAiSnapshot(data);
        break;
      default:
        return res.status(400).json({ error: `Unknown type: ${type}. Use searchRecord, referral, or aiSnapshot.` });
    }
    res.json(result);
  });

  // POST /api/data/deduplicate/:businessId — remove duplicate search records
  app.post("/api/data/deduplicate/:businessId", requireAdmin, async (req, res) => {
    const businessId = parseInt(req.params.businessId);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid businessId" });
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });
    const result = await storage.deduplicateSearchRecords(businessId);
    res.json({ success: true, ...result });
  });

  // POST /api/data/archive — archive old records (admin only)
  app.post("/api/data/archive", requireAdmin, async (req, res) => {
    const { daysOld = 90, businessId } = req.body;
    if (typeof daysOld !== "number" || daysOld < 1) {
      return res.status(400).json({ error: "daysOld must be a positive number" });
    }
    const result = await storage.archiveOldData(daysOld, businessId);
    res.json({ success: true, ...result });
  });

  // POST /api/data/archival-run — run full archival pass (admin only)
  app.post("/api/data/archival-run", requireAdmin, async (_req, res) => {
    const result = runArchival();
    res.json({ success: true, ...result });
  });

  console.log("[init] registerRoutes() completed successfully — all routes registered");
  return httpServer;
  } catch (err) {
    console.error("[init] FATAL ERROR in registerRoutes() — app cannot start:", err);
    if (err instanceof Error) {
      console.error("[init] Error name:", err.name);
      console.error("[init] Error message:", err.message);
      console.error("[init] Stack trace:", err.stack);
    }
    throw err;
  }
}
