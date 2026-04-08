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

// Generate realistic demo data for a business
function generateDemoData(businessId: number, businessName: string, industry: string) {
  const allPlatforms = db.select().from(platforms).all();

  const industryQueries: Record<string, string[]> = {
    "Restaurant": [
      `best ${industry.toLowerCase()} restaurants near me`,
      `top rated dining options in my area`,
      `where should I eat tonight`,
      `${businessName} reviews`,
      `restaurants with good ambiance`,
      `affordable fine dining`,
      `best brunch spots`,
      `${businessName} menu prices`,
      `restaurants open late`,
      `healthy restaurant options`,
    ],
    "Technology": [
      `best ${industry.toLowerCase()} companies`,
      `top software solutions for business`,
      `${businessName} alternatives`,
      `${businessName} pricing`,
      `enterprise software comparison`,
      `cloud service providers ranking`,
      `${businessName} vs competitors`,
      `tech companies to watch`,
      `best SaaS tools 2026`,
      `${businessName} customer reviews`,
    ],
    "default": [
      `best ${industry.toLowerCase()} businesses`,
      `top ${industry.toLowerCase()} services near me`,
      `${businessName} reviews`,
      `${businessName} alternatives`,
      `recommended ${industry.toLowerCase()} providers`,
      `${industry.toLowerCase()} companies comparison`,
      `affordable ${industry.toLowerCase()} services`,
      `${businessName} pricing`,
      `is ${businessName} worth it`,
      `${industry.toLowerCase()} industry leaders`,
    ],
  };

  const queries = industryQueries[industry] || industryQueries["default"];

  // Generate 30 days of data
  const now = new Date();
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split("T")[0];

    // 2-5 searches per day
    const searchCount = Math.floor(Math.random() * 4) + 2;
    for (let s = 0; s < searchCount; s++) {
      const platform = allPlatforms[Math.floor(Math.random() * allPlatforms.length)];
      const query = queries[Math.floor(Math.random() * queries.length)];
      const mentioned = Math.random() > 0.35 ? 1 : 0;
      const position = mentioned ? Math.floor(Math.random() * 5) + 1 : null;

      db.insert(searchRecords).values({
        businessId,
        platformId: platform.id,
        query,
        mentioned,
        position,
        date: dateStr,
      }).run();
    }
  }

  // Generate optimized prompts with SEO tips
  const promptTemplates = [
    {
      category: "discovery",
      prompt: `What are the best ${industry.toLowerCase()} options available right now?`,
      score: Math.floor(Math.random() * 20) + 75,
      tip: `Ensure your business description includes specific, unique value propositions. AI models rank businesses higher when they find distinctive attributes in indexed content.`,
    },
    {
      category: "comparison",
      prompt: `Compare ${businessName} with other ${industry.toLowerCase()} providers`,
      score: Math.floor(Math.random() * 20) + 70,
      tip: `Publish detailed comparison pages on your site. AI models frequently pull from structured comparison content when answering "vs" or "compare" queries.`,
    },
    {
      category: "recommendation",
      prompt: `Can you recommend a great ${industry.toLowerCase()} business for someone new?`,
      score: Math.floor(Math.random() * 20) + 65,
      tip: `Customer reviews and testimonials are heavily weighted by AI. Encourage verified reviews across platforms — AI models synthesize these into recommendations.`,
    },
    {
      category: "local",
      prompt: `What ${industry.toLowerCase()} businesses are popular in my area?`,
      score: Math.floor(Math.random() * 20) + 60,
      tip: `Optimize your Google Business Profile and ensure NAP (Name, Address, Phone) consistency across directories. AI models pull location data from these sources.`,
    },
    {
      category: "review",
      prompt: `What do people say about ${businessName}?`,
      score: Math.floor(Math.random() * 20) + 55,
      tip: `Respond to all reviews — positive and negative. Active engagement signals credibility to AI systems that analyze sentiment patterns.`,
    },
    {
      category: "discovery",
      prompt: `What's the best value in the ${industry.toLowerCase()} industry?`,
      score: Math.floor(Math.random() * 20) + 68,
      tip: `Publish transparent pricing information. AI models favor businesses with clear, accessible pricing when answering value-oriented queries.`,
    },
  ];

  for (const t of promptTemplates) {
    db.insert(optimizedPrompts).values({ businessId, ...t }).run();
  }

  // Generate referral/click-through data
  const mentionedRecords = db.select().from(searchRecords)
    .where(sql`business_id = ${businessId} AND mentioned = 1`)
    .all();

  const landingPages = ["/", "/about", "/services", "/pricing", "/contact", "/menu", "/products", "/reviews"];
  const conversionTypes = ["contact_form", "purchase", "signup", "phone_call", "booking"];
  const devices: Array<"desktop" | "mobile" | "tablet"> = ["desktop", "mobile", "tablet"];
  const deviceWeights = [0.45, 0.45, 0.1];

  for (const record of mentionedRecords) {
    if (Math.random() > 0.30) continue;

    const platform = allPlatforms.find(p => p.id === record.platformId);
    const platformSlug = (platform?.name ?? "ai").toLowerCase().replace(/\s+/g, "-");

    const rand = Math.random();
    let deviceIdx = 0;
    let cumulative = 0;
    for (let i = 0; i < deviceWeights.length; i++) {
      cumulative += deviceWeights[i];
      if (rand < cumulative) { deviceIdx = i; break; }
    }

    const sessionDuration = Math.floor(Math.random() * 300) + 15;
    const pagesViewed = Math.floor(Math.random() * 6) + 1;
    const converted = Math.random() < 0.20 ? 1 : 0;
    const conversionType = converted ? conversionTypes[Math.floor(Math.random() * conversionTypes.length)] : null;

    const hour = Math.floor(Math.random() * 14) + 8;
    const minute = Math.floor(Math.random() * 60);
    const timestamp = `${record.date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;

    db.insert(referrals).values({
      businessId,
      platformId: record.platformId,
      searchRecordId: record.id,
      query: record.query,
      landingPage: landingPages[Math.floor(Math.random() * landingPages.length)],
      utmSource: platformSlug,
      utmMedium: "ai-search",
      utmCampaign: null,
      converted,
      conversionType,
      sessionDuration,
      pagesViewed,
      deviceType: devices[deviceIdx],
      date: record.date,
      timestamp,
    }).run();
  }

  // === SEED COMPETITORS ===
  const competitorNames = [
    { name: `${industry} Elite`, website: `https://${industry.toLowerCase()}-elite.com` },
    { name: `Prime ${industry}`, website: `https://prime${industry.toLowerCase()}.com` },
    { name: `${industry} Hub`, website: `https://${industry.toLowerCase()}hub.io` },
  ];
  const numCompetitors = Math.floor(Math.random() * 2) + 2; // 2-3

  for (let c = 0; c < numCompetitors; c++) {
    const comp = competitorNames[c];
    db.insert(competitors).values({
      businessId,
      name: comp.name,
      website: comp.website,
      notes: `Key competitor in the ${industry.toLowerCase()} space`,
    }).run();
  }

  // === SEED AI SNAPSHOTS ===
  const snapshotTemplates = [
    {
      query: `What is ${businessName}?`,
      responseText: `${businessName} is a well-regarded ${industry.toLowerCase()} business known for its quality service and customer-first approach. They have been operating for several years and have built a strong reputation in the local market. Customers frequently praise their attention to detail and competitive pricing.`,
      sentiment: "positive",
      mentionedAccurate: 1,
      flaggedIssues: null,
    },
    {
      query: `Is ${businessName} still open?`,
      responseText: `Based on my information, ${businessName} appears to be actively operating. However, I should note that my information may not reflect the most current hours. Their listed hours show Monday-Friday 9am-6pm, but I'd recommend checking their website or calling directly for the most up-to-date information.`,
      sentiment: "neutral",
      mentionedAccurate: 0,
      flaggedIssues: JSON.stringify(["Hours may be outdated", "Recommends verification"]),
    },
    {
      query: `${businessName} vs competitors`,
      responseText: `When comparing ${businessName} to alternatives in the ${industry.toLowerCase()} space, several factors stand out. ${businessName} tends to offer competitive pricing with strong customer service. However, some competitors may offer a wider range of services. Overall, ${businessName} is a solid choice for value-conscious customers.`,
      sentiment: "positive",
      mentionedAccurate: 1,
      flaggedIssues: null,
    },
    {
      query: `Problems with ${businessName}`,
      responseText: `I found some mixed feedback about ${businessName}. While most reviews are positive, a few customers have mentioned occasional wait times and limited availability during peak hours. The business has responded to most concerns and appears to be actively improving their service delivery.`,
      sentiment: "negative",
      mentionedAccurate: 1,
      flaggedIssues: JSON.stringify(["Mentions negative reviews"]),
    },
    {
      query: `Best ${industry.toLowerCase()} recommendations`,
      responseText: `Here are my top recommendations for ${industry.toLowerCase()} services in your area: 1) ${businessName} - Great reviews and competitive pricing. 2) ${industry} Elite - Known for premium offerings. 3) Prime ${industry} - Good budget option. Each has its strengths depending on your specific needs.`,
      sentiment: "positive",
      mentionedAccurate: 1,
      flaggedIssues: null,
    },
    {
      query: `${businessName} contact information`,
      responseText: `${businessName} can be reached through their website. They are located in the downtown area and offer both in-person and online services. Note: I don't have their current phone number in my training data, so please check their website for the latest contact details.`,
      sentiment: "neutral",
      mentionedAccurate: 0,
      flaggedIssues: JSON.stringify(["Missing phone number", "Location may be inaccurate"]),
    },
  ];

  const numSnapshots = Math.floor(Math.random() * 3) + 4; // 4-6
  for (let s = 0; s < numSnapshots; s++) {
    const template = snapshotTemplates[s % snapshotTemplates.length];
    const daysAgo = Math.floor(Math.random() * 14);
    const snapshotDate = new Date(now);
    snapshotDate.setDate(snapshotDate.getDate() - daysAgo);
    const platform = allPlatforms[Math.floor(Math.random() * allPlatforms.length)];

    db.insert(aiSnapshots).values({
      businessId,
      platformId: platform.id,
      query: template.query,
      responseText: template.responseText,
      sentiment: template.sentiment,
      mentionedAccurate: template.mentionedAccurate,
      flaggedIssues: template.flaggedIssues,
      date: snapshotDate.toISOString().split("T")[0],
    }).run();
  }

  // === SEED ALERTS ===
  const alertTemplates = [
    { type: "mention_drop", message: `${businessName} mention rate dropped 15% on ChatGPT this week`, severity: "warning" },
    { type: "competitor_outrank", message: `${industry} Elite now appears before ${businessName} in "best ${industry.toLowerCase()}" queries on Perplexity`, severity: "warning" },
    { type: "platform_missing", message: `${businessName} was not mentioned in any Meta AI queries this week`, severity: "critical" },
    { type: "accuracy_issue", message: `AI snapshot flagged outdated business hours being reported by Google Gemini`, severity: "critical" },
    { type: "mention_drop", message: `Weekly mention rate across all platforms is down 8% compared to last week`, severity: "info" },
    { type: "competitor_outrank", message: `Prime ${industry} gained 3 new mention positions on Claude this month`, severity: "info" },
    { type: "accuracy_issue", message: `Perplexity is reporting an old address for ${businessName}`, severity: "warning" },
    { type: "platform_missing", message: `${businessName} has no mentions on Copilot — consider optimizing for this platform`, severity: "info" },
  ];

  const numAlerts = Math.floor(Math.random() * 4) + 5; // 5-8
  for (let a = 0; a < numAlerts; a++) {
    const template = alertTemplates[a % alertTemplates.length];
    const daysAgo = Math.floor(Math.random() * 10);
    const alertDate = new Date(now);
    alertDate.setDate(alertDate.getDate() - daysAgo);
    const isRead = Math.random() > 0.5 ? 1 : 0;

    db.insert(alerts).values({
      businessId,
      type: template.type,
      message: template.message,
      severity: template.severity,
      isRead,
      date: alertDate.toISOString().split("T")[0],
    }).run();
  }

  // === SEED CONTENT GAPS ===
  const gapTemplates = [
    { query: `best ${industry.toLowerCase()} for beginners`, category: "discovery", currentlyRanking: 0, recommendedContent: `Create a beginner's guide blog post targeting first-time ${industry.toLowerCase()} customers. Include FAQs, pricing breakdowns, and what to expect.`, contentType: "blog_post", priority: "high" },
    { query: `${industry.toLowerCase()} pricing comparison`, category: "pricing", currentlyRanking: 0, recommendedContent: `Add a transparent pricing page with comparison tables. AI models heavily favor structured pricing data.`, contentType: "landing_page", priority: "high" },
    { query: `${businessName} hours and location`, category: "local", currentlyRanking: 1, recommendedContent: `Add schema markup (LocalBusiness) to your website with accurate hours, address, and phone number.`, contentType: "schema_markup", priority: "high" },
    { query: `${industry.toLowerCase()} frequently asked questions`, category: "information", currentlyRanking: 0, recommendedContent: `Build a comprehensive FAQ page covering the top 15-20 questions customers ask about ${industry.toLowerCase()} services.`, contentType: "faq", priority: "medium" },
    { query: `${businessName} customer reviews summary`, category: "reputation", currentlyRanking: 1, recommendedContent: `Create a testimonials page featuring verified customer reviews. Respond to all reviews on Google and Yelp.`, contentType: "review_response", priority: "medium" },
    { query: `eco-friendly ${industry.toLowerCase()} options`, category: "trending", currentlyRanking: 0, recommendedContent: `Write a blog post about your sustainability practices and eco-friendly initiatives.`, contentType: "blog_post", priority: "medium" },
    { query: `${industry.toLowerCase()} near me open now`, category: "local", currentlyRanking: 0, recommendedContent: `Ensure Google Business Profile has accurate real-time hours. Add structured data for opening hours.`, contentType: "schema_markup", priority: "low" },
    { query: `${businessName} alternatives`, category: "comparison", currentlyRanking: 1, recommendedContent: `Create a comparison page positioning ${businessName} against alternatives, highlighting unique strengths.`, contentType: "landing_page", priority: "medium" },
    { query: `how to choose a ${industry.toLowerCase()} provider`, category: "educational", currentlyRanking: 0, recommendedContent: `Publish a guide on what to look for when choosing a ${industry.toLowerCase()} provider. Position ${businessName} as the expert.`, contentType: "blog_post", priority: "low" },
    { query: `${industry.toLowerCase()} deals and promotions`, category: "pricing", currentlyRanking: 0, recommendedContent: `Add a promotions page and keep it updated. AI models look for current offers when answering deal-related queries.`, contentType: "landing_page", priority: "low" },
  ];

  const numGaps = Math.floor(Math.random() * 5) + 6; // 6-10
  for (let g = 0; g < numGaps; g++) {
    const template = gapTemplates[g % gapTemplates.length];
    db.insert(contentGaps).values({ businessId, ...template }).run();
  }

  // === SEED LOCATIONS ===
  const locationTemplates = [
    { name: "Main Office", address: "123 Main Street, Downtown, NY 10001" },
    { name: "Satellite Location", address: "456 Oak Avenue, Midtown, NY 10019" },
  ];
  const numLocations = Math.floor(Math.random() * 2) + 1; // 1-2
  for (let l = 0; l < numLocations; l++) {
    db.insert(locations).values({ businessId, ...locationTemplates[l] }).run();
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Create tables
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

  // === DATABASE INDEXES for query performance ===
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

  // Ensure archive tables exist
  ensureArchiveTables();

  // Seed default budget settings if none exist
  const existingSettings = db.select().from(apiSettings).all();
  if (existingSettings.length === 0) {
    db.insert(apiSettings).values({ dailyBudget: "10.00", autoPauseEnabled: 1 }).run();
  }

  // Re-seed after table creation
  seedPlatforms();

  // Seed admin user if no users exist
  const existingUsers = db.select().from(users).all();
  if (existingUsers.length === 0) {
    await storage.createUser({
      username: "admin",
      password: "worthcreative2026",
      displayName: "Worth Creative",
      role: "admin",
    });
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
    generateDemoData(business.id, business.name, business.industry);
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

  return httpServer;
}
