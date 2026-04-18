// Worth Tracking v2 — routes
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage, db } from "./storage";
import {
  businesses, platforms, searchRecords, optimizedPrompts, referrals,
  competitors, aiSnapshots, alerts, contentGaps, locations,
  apiKeys, scanJobs, apiUsage, apiSettings, clickEvents,
  users, userBusinesses, agencySettings, platformHealth, citations, botVisits, geoActions, loginSchema,
  insertBusinessSchema, insertSearchRecordSchema,
  insertCompetitorSchema, insertAlertSchema, insertLocationSchema,
} from "@shared/schema";
import { sql } from "drizzle-orm";
import { runScan, testApiKey, diagnosticQuery, generateScanQueries, detectCompetitors, setAnalysisKeys, detectHallucinations, verifyCitations, setHealthCallback, PROVIDER_COST_PER_CALL, type BusinessContext } from "./ai-providers";
import { generateDemoData, clearDemoData } from "./demo-data";
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
// Helper: build extraTerms for mention detection from business fields
function buildExtraTerms(biz: any): string[] {
  const terms: string[] = [];
  if (biz.services) biz.services.split(",").map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => terms.push(s));
  if (biz.keywords) biz.keywords.split(",").map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => terms.push(s));
  return terms;
}

// Helper: build BusinessContext from a business record
function toBizContext(biz: any): BusinessContext {
  return {
    name: biz.name,
    industry: biz.industry,
    location: biz.location ?? null,
    services: biz.services ?? null,
    keywords: biz.keywords ?? null,
    targetAudience: biz.targetAudience ?? biz.target_audience ?? null,
    uniqueSellingPoints: biz.uniqueSellingPoints ?? biz.unique_selling_points ?? null,
    competitors: biz.competitors ?? biz.known_competitors ?? null,
    customQueries: biz.customQueries ?? biz.custom_queries ?? null,
  };
}

// ── AI SEO Prompt Generation ────────────────────────────────────────────────
// After a scan, analyze which queries performed well/poorly and generate
// optimized prompts with actionable tips.
async function generateOptimizedPrompts(businessId: number) {
  try {
    const biz = await storage.getBusiness(businessId);
    if (!biz) return;

    // Use the most recent scan's records (not filtered by exact date to avoid timezone issues)
    const allRecords = db.select().from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL`)
      .all();

    if (allRecords.length === 0) return;

    // Find the latest date and use records from that date
    const latestDate = allRecords.reduce((max, r) => r.date > max ? r.date : max, allRecords[0].date);
    const records = allRecords.filter(r => r.date === latestDate);

    // Clear old prompts for this business and regenerate
    db.delete(optimizedPrompts).where(sql`business_id = ${businessId}`).run();

    // Group records by query
    const queryMap = new Map<string, { mentioned: number; total: number; positions: number[]; sentiments: string[] }>();
    for (const r of records) {
      if (!queryMap.has(r.query)) queryMap.set(r.query, { mentioned: 0, total: 0, positions: [], sentiments: [] });
      const q = queryMap.get(r.query)!;
      q.total++;
      if (r.mentioned) {
        q.mentioned++;
        if (r.position) q.positions.push(r.position);
      }
      if (r.sentiment) q.sentiments.push(r.sentiment);
    }

    const prompts: { prompt: string; category: string; score: number; tip: string }[] = [];

    for (const [query, data] of queryMap) {
      const mentionRate = Math.round((data.mentioned / data.total) * 100);
      const avgPos = data.positions.length > 0
        ? Math.round((data.positions.reduce((a, b) => a + b, 0) / data.positions.length) * 10) / 10
        : null;
      const mainSentiment = data.sentiments.length > 0
        ? (data.sentiments.filter(s => s === "positive").length >= data.sentiments.length / 2 ? "positive" : data.sentiments.filter(s => s === "negative").length >= data.sentiments.length / 2 ? "negative" : "neutral")
        : "neutral";

      // Determine category from query content
      const lq = query.toLowerCase();
      let category = "discovery";
      if (lq.includes("vs ") || lq.includes("compare") || lq.includes("versus")) category = "comparison";
      else if (lq.includes("best") || lq.includes("recommend") || lq.includes("top")) category = "recommendation";
      else if (lq.includes("near") || lq.includes("in ") || (biz.location && lq.includes(biz.location.toLowerCase()))) category = "local";
      else if (lq.includes("review") || lq.includes("reputation") || lq.includes("worth")) category = "review";

      // Generate actionable tip based on performance
      let tip: string;
      if (mentionRate >= 75) {
        tip = mainSentiment === "positive"
          ? "Strong performance! Maintain your online presence and encourage fresh reviews to keep this ranking."
          : "You're being mentioned often but sentiment could improve. Focus on customer experience and review management.";
      } else if (mentionRate >= 40) {
        if (category === "local") {
          tip = `Moderate local visibility. Ensure your Google Business Profile is complete, add location-specific content to your website, and build local citations.`;
        } else if (category === "comparison") {
          tip = `You show up in some comparisons. Create detailed comparison content on your site highlighting your unique advantages over competitors.`;
        } else {
          tip = `Room for improvement. Add structured data (schema markup) to your website, publish relevant blog content, and ensure your business info is consistent across directories.`;
        }
      } else if (mentionRate > 0) {
        tip = `Low visibility for this query type. Create dedicated content targeting "${query.replace(/"/g, '')}" on your website. Add FAQ pages and ensure your business details are on major directories (Yelp, BBB, industry-specific sites).`;
      } else {
        tip = `Not appearing for this query. This is a content gap — create a dedicated page or blog post addressing "${query.replace(/"/g, '')}". Ensure your website mentions relevant keywords and services.`;
      }

      prompts.push({ prompt: query, category, score: mentionRate, tip });
    }

    // Sort: worst-performing first (biggest opportunities), limit to 20
    prompts.sort((a, b) => a.score - b.score);
    const topPrompts = prompts.slice(0, 20);

    for (const p of topPrompts) {
      db.insert(optimizedPrompts).values({
        businessId,
        prompt: p.prompt,
        category: p.category,
        score: p.score,
        tip: p.tip,
      }).run();
    }

    console.log(`[Prompts] Generated ${topPrompts.length} optimized prompts for business #${businessId}`);
  } catch (err: any) {
    console.error(`[Prompts] Error generating prompts for business #${businessId}:`, err.message);
  }
}

// ── Content Gap Detection ──────────────────────────────────────────────────
// Analyzes scan results to find queries where the business is NOT being mentioned.
// These represent content opportunities — topics to write about on your website.
async function generateContentGaps(businessId: number) {
  try {
    const biz = await storage.getBusiness(businessId);
    if (!biz) return;

    // Get the most recent scan's records
    const allRecords = db.select().from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL`)
      .all();

    if (allRecords.length === 0) return;

    const latestDate = allRecords.reduce((max, r) => r.date > max ? r.date : max, allRecords[0].date);
    const records = allRecords.filter(r => r.date === latestDate);

    // Clear old gaps and regenerate
    db.delete(contentGaps).where(sql`business_id = ${businessId}`).run();

    // Group by query — find queries with low or zero mention rates
    const queryMap = new Map<string, { mentioned: number; total: number }>();
    for (const r of records) {
      if (!queryMap.has(r.query)) queryMap.set(r.query, { mentioned: 0, total: 0 });
      const q = queryMap.get(r.query)!;
      q.total++;
      if (r.mentioned) q.mentioned++;
    }

    const gaps: { query: string; category: string; currentlyRanking: number; recommendedContent: string; contentType: string; priority: string }[] = [];

    for (const [query, data] of queryMap) {
      const mentionRate = data.total > 0 ? data.mentioned / data.total : 0;

      // Only flag as a gap if mention rate is below 50%
      if (mentionRate >= 0.5) continue;

      const lq = query.toLowerCase();
      const bizName = biz.name.toLowerCase();

      // Determine category
      let category = "General";
      if (lq.includes("best") || lq.includes("recommend") || lq.includes("top")) category = "Discovery";
      else if (lq.includes("vs ") || lq.includes("compare") || lq.includes("between")) category = "Comparison";
      else if (lq.includes("review") || lq.includes("reputation") || lq.includes("worth")) category = "Reputation";
      else if (lq.includes("near") || lq.includes("in ") || lq.includes("local")) category = "Local SEO";
      else if (lq.includes("cost") || lq.includes("price") || lq.includes("afford")) category = "Pricing";
      else if (lq.includes("how") || lq.includes("what") || lq.includes("tips")) category = "Educational";

      // Determine content type recommendation
      let contentType = "blog_post";
      let recommendedContent = "";
      const priority = mentionRate === 0 ? "high" : "medium";

      if (category === "Discovery") {
        contentType = "landing_page";
        recommendedContent = `Create a dedicated service page optimized for "${query.replace(/"/g, '')}". Include your business name, location, services, and customer testimonials. Add schema markup (LocalBusiness + Service).`;
      } else if (category === "Comparison") {
        contentType = "blog_post";
        recommendedContent = `Write a comparison guide that positions your business against alternatives. Highlight your unique advantages, pricing, and customer reviews.`;
      } else if (category === "Reputation") {
        contentType = "review_response";
        recommendedContent = `Strengthen your review presence: respond to all Google/Yelp reviews, add testimonials to your website, and create a dedicated reviews page. Encourage satisfied customers to leave reviews.`;
      } else if (category === "Local SEO") {
        contentType = "schema_markup";
        recommendedContent = `Optimize for local search: complete your Google Business Profile, add LocalBusiness schema markup, build citations on directories (Yelp, BBB, industry-specific), and create location-specific content.`;
      } else if (category === "Pricing") {
        contentType = "landing_page";
        recommendedContent = `Create a pricing/cost guide page. AI models often cite businesses with transparent pricing. Include service tiers, starting prices, and "get a free quote" calls-to-action.`;
      } else if (category === "Educational") {
        contentType = "blog_post";
        recommendedContent = `Write an educational blog post or FAQ page addressing "${query.replace(/"/g, '')}". AI models heavily cite authoritative, informative content.`;
      } else {
        contentType = "blog_post";
        recommendedContent = `Create content addressing "${query.replace(/"/g, '')}". Add relevant keywords to your website, publish a blog post, and ensure your business is listed on major directories.`;
      }

      // Skip queries that are just about the business by name (those aren't content gaps)
      if (lq.includes(bizName) && category === "Reputation") continue;

      gaps.push({
        query,
        category,
        currentlyRanking: mentionRate > 0 ? 1 : 0,
        recommendedContent,
        contentType,
        priority,
      });
    }

    // Sort by priority (high first) then by category
    gaps.sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return (prio[a.priority as keyof typeof prio] ?? 1) - (prio[b.priority as keyof typeof prio] ?? 1);
    });

    const topGaps = gaps.slice(0, 15);

    for (const g of topGaps) {
      db.insert(contentGaps).values({
        businessId,
        query: g.query,
        category: g.category,
        currentlyRanking: g.currentlyRanking,
        recommendedContent: g.recommendedContent,
        contentType: g.contentType,
        priority: g.priority,
      }).run();
    }

    console.log(`[ContentGaps] Generated ${topGaps.length} content gaps for business #${businessId}`);
  } catch (err: any) {
    console.error(`[ContentGaps] Error generating gaps for business #${businessId}:`, err.message);
  }
}

// ── Query Categorization Helper ──────────────────────────────────────────────
function categorizeQuery(query: string): string {
  const lq = query.toLowerCase();
  if (lq.includes("buy") || lq.includes("hire") || lq.includes("cost") || lq.includes("price") || lq.includes("best") || lq.includes("top") || lq.includes("recommend")) return "purchase_intent";
  if (lq.includes("vs ") || lq.includes("compare") || lq.includes("alternative")) return "comparison";
  if (lq.includes("review") || lq.includes("reputation") || lq.includes("rating")) return "reputation";
  if (lq.includes("near") || lq.includes("in ") || lq.includes("local")) return "local";
  if (lq.includes("how") || lq.includes("what") || lq.includes("tips") || lq.includes("guide")) return "educational";
  return "general";
}

// ── GEO Roadmap Action Generator ────────────────────────────────────────────
// Turns content gaps and scan data into a prioritized action queue split into
// Owned Media (create content) and Earned Media (get listed/mentioned).
async function generateGeoActions(businessId: number) {
  const biz = await storage.getBusiness(businessId);
  if (!biz) return;

  const gaps = await storage.getContentGaps(businessId);
  const records = db.select().from(searchRecords)
    .where(sql`business_id = ${businessId} AND competitor_id IS NULL`)
    .all();
  const allCitations = db.select().from(citations).where(sql`business_id = ${businessId}`).all();

  // Clear old actions
  db.delete(geoActions).where(sql`business_id = ${businessId}`).run();
  const now = new Date().toISOString();
  const actions: { actionType: string; title: string; description: string; category: string; opportunityScore: string; relatedQuery: string | null }[] = [];

  // ── Owned Media actions from content gaps ──
  for (const gap of gaps) {
    const priority = gap.priority === "high" ? "high" : "medium";
    actions.push({
      actionType: "owned_media",
      title: `Create ${gap.contentType.replace(/_/g, " ")} for "${gap.query}"`,
      description: gap.recommendedContent,
      category: gap.category,
      opportunityScore: priority,
      relatedQuery: gap.query,
    });
  }

  // ── Check for missing schema markup ──
  if (biz.website) {
    try {
      let fullUrl = biz.website.trim();
      if (!fullUrl.startsWith("http")) fullUrl = "https://" + fullUrl;
      const r = await fetch(fullUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0)", Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const html = await r.text();
        if (!html.includes("application/ld+json")) {
          actions.push({
            actionType: "owned_media",
            title: "Add JSON-LD schema markup to your website",
            description: "AI platforms strongly prefer websites with structured data. Add LocalBusiness, FAQPage, and AggregateRating schema to help AI understand your business.",
            category: "Schema",
            opportunityScore: "high",
            relatedQuery: null,
          });
        }
        if (!html.includes("FAQPage") && !html.includes("faqpage")) {
          actions.push({
            actionType: "owned_media",
            title: "Create an FAQ page with FAQ schema",
            description: "FAQ content is one of the most frequently cited content types by AI platforms. Create a comprehensive FAQ page and add FAQPage schema markup.",
            category: "Content",
            opportunityScore: "high",
            relatedQuery: null,
          });
        }
      }
    } catch { /* skip */ }
  }

  // ── Earned Media actions ──
  const bizDomain = biz.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || "";
  const ownCitationCount = allCitations.filter(c => c.isOwnDomain).length;
  const totalCitations = allCitations.length;

  if (totalCitations > 0 && ownCitationCount / totalCitations < 0.1) {
    actions.push({
      actionType: "earned_media",
      title: "Increase your citation rate — only " + Math.round((ownCitationCount / totalCitations) * 100) + "% of AI citations link to you",
      description: "AI platforms are citing other sources instead of your website. Focus on building authoritative, citable content and getting listed on directories and industry sites that AI platforms trust.",
      category: "Citations",
      opportunityScore: "high",
      relatedQuery: null,
    });
  }

  // Check top cited domains — if competitors dominate, suggest outreach
  const domainCounts = new Map<string, number>();
  for (const c of allCitations) {
    if (!c.isOwnDomain) {
      domainCounts.set(c.domain, (domainCounts.get(c.domain) ?? 0) + 1);
    }
  }
  const topExternal = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [domain, count] of topExternal) {
    if (count >= 3 && !domain.includes("wikipedia") && !domain.includes("google")) {
      actions.push({
        actionType: "earned_media",
        title: `Get listed on ${domain} (cited ${count} times by AI)`,
        description: `AI platforms frequently cite ${domain} when answering queries about your industry. Ensure your business is listed or mentioned on this site, or pitch a guest article / listing.`,
        category: "Directory",
        opportunityScore: count >= 5 ? "high" : "medium",
        relatedQuery: null,
      });
    }
  }

  // Check for Reddit/forum mentions
  const redditCitations = allCitations.filter(c => c.domain.includes("reddit.com")).length;
  if (redditCitations >= 2) {
    actions.push({
      actionType: "earned_media",
      title: "Engage on Reddit — AI platforms cite it heavily",
      description: `Reddit was cited ${redditCitations} times in AI responses about your industry. Monitor relevant subreddits, provide helpful answers, and build your brand presence there.`,
      category: "Community",
      opportunityScore: "medium",
      relatedQuery: null,
    });
  }

  // Platform-specific weak spots
  const platformMentionRates = new Map<string, { mentioned: number; total: number }>();
  for (const r of records) {
    const platNames: Record<number, string> = { 1: "ChatGPT", 2: "Perplexity", 3: "Google Gemini", 4: "Claude" };
    const name = platNames[r.platformId] ?? `Platform ${r.platformId}`;
    if (!platformMentionRates.has(name)) platformMentionRates.set(name, { mentioned: 0, total: 0 });
    const p = platformMentionRates.get(name)!;
    p.total++;
    if (r.mentioned) p.mentioned++;
  }
  for (const [platform, data] of platformMentionRates) {
    if (data.total >= 5 && data.mentioned / data.total < 0.2) {
      actions.push({
        actionType: "owned_media",
        title: `Improve visibility on ${platform} (only ${Math.round(data.mentioned / data.total * 100)}% mention rate)`,
        description: `${platform} rarely mentions your business. Focus on the content signals ${platform} values — structured data, authoritative content, and third-party citations.`,
        category: "Platform",
        opportunityScore: "high",
        relatedQuery: null,
      });
    }
  }

  // Store actions
  for (const a of actions.slice(0, 25)) {
    db.insert(geoActions).values({
      businessId,
      actionType: a.actionType,
      title: a.title,
      description: a.description,
      category: a.category,
      opportunityScore: a.opportunityScore,
      status: "pending",
      relatedQuery: a.relatedQuery,
      createdAt: now,
    }).run();
  }

  console.log(`[GEO Actions] Generated ${Math.min(actions.length, 25)} actions for business #${businessId}`);
}

// ── Ranking Drop Alert System ────────────────────────────────────────────────
// After a scan completes, compare current results to previous scan and generate
// alerts for mention rate drops, competitor overtaking, and platform issues.
async function generateScanAlerts(businessId: number) {
  const today = new Date().toISOString().split("T")[0];

  // Helper: check if an alert with same type+message+date already exists
  function alertExists(type: string, message: string, date: string): boolean {
    const existing = db
      .select()
      .from(alerts)
      .where(sql`business_id = ${businessId} AND type = ${type} AND message = ${message} AND date = ${date}`)
      .get();
    return !!existing;
  }

  try {
    // Get the most recent previous scan date (before today)
    const prevDateRow = db
      .select({ date: searchRecords.date })
      .from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date < ${today}`)
      .orderBy(sql`date DESC`)
      .limit(1)
      .get();

    // Get today's business records
    const todayRecords = db
      .select()
      .from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date = ${today}`)
      .all();

    if (todayRecords.length === 0) return; // no scan results today

    // ── (a) Mention rate drop (with temporal anomaly detection) ────────────────
    if (prevDateRow) {
      const prevDate = prevDateRow.date;
      const prevRecords = db
        .select()
        .from(searchRecords)
        .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date = ${prevDate}`)
        .all();

      // Get rolling average from last 7 scan dates for anomaly detection
      const recentDates = db
        .select({ date: searchRecords.date })
        .from(searchRecords)
        .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date <= ${today}`)
        .groupBy(searchRecords.date)
        .orderBy(sql`date DESC`)
        .limit(7)
        .all();

      let rollingAvgRate: number | null = null;
      if (recentDates.length >= 3) {
        let totalMentions = 0;
        let totalRecords = 0;
        for (const { date } of recentDates.slice(1)) { // exclude today
          const dayRecords = db
            .select()
            .from(searchRecords)
            .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date = ${date}`)
            .all();
          totalRecords += dayRecords.length;
          totalMentions += dayRecords.filter(r => r.mentioned === 1).length;
        }
        if (totalRecords > 0) {
          rollingAvgRate = totalMentions / totalRecords;
        }
      }

      // Detect extreme anomaly: if today's rate swings more than 50% from rolling avg
      if (rollingAvgRate !== null && todayRecords.length > 0) {
        const todayRate = todayRecords.filter(r => r.mentioned === 1).length / todayRecords.length;
        const deviation = Math.abs(todayRate - rollingAvgRate) / Math.max(rollingAvgRate, 0.01);
        if (deviation > 0.5) {
          const direction = todayRate < rollingAvgRate ? "drop" : "spike";
          const msg = `Anomaly detected: mention rate ${direction} of ${Math.round(deviation * 100)}% from 7-day average (${Math.round(rollingAvgRate * 100)}% avg → ${Math.round(todayRate * 100)}% today). This may be a temporary fluctuation.`;
          if (!alertExists("anomaly", msg, today)) {
            await storage.createAlert({ businessId, type: "anomaly", message: msg, severity: "info", date: today });
            console.log(`[Alerts] Created anomaly alert for business ${businessId}`);
          }
        }
      }

      if (prevRecords.length > 0) {
        const prevMentionRate = prevRecords.filter((r) => r.mentioned === 1).length / prevRecords.length;
        const todayMentionRate = todayRecords.filter((r) => r.mentioned === 1).length / todayRecords.length;

        // Use rolling average comparison when available, fall back to prev-day
        if (rollingAvgRate !== null && rollingAvgRate > 0) {
          // Compare against rolling average instead of just previous day
          const dropPct = ((rollingAvgRate - todayMentionRate) / rollingAvgRate) * 100;

          if (dropPct > 30) {
            const msg = `Mention rate dropped ${Math.round(dropPct)}% from 7-day average (${Math.round(rollingAvgRate * 100)}% avg → ${Math.round(todayMentionRate * 100)}% today)`;
            if (!alertExists("mention_drop", msg, today)) {
              await storage.createAlert({ businessId, type: "mention_drop", message: msg, severity: "critical", date: today });
              console.log(`[Alerts] Created critical mention_drop alert for business ${businessId}`);
            }
          } else if (dropPct > 15) {
            const msg = `Mention rate dropped ${Math.round(dropPct)}% from 7-day average (${Math.round(rollingAvgRate * 100)}% avg → ${Math.round(todayMentionRate * 100)}% today)`;
            if (!alertExists("mention_drop", msg, today)) {
              await storage.createAlert({ businessId, type: "mention_drop", message: msg, severity: "warning", date: today });
              console.log(`[Alerts] Created warning mention_drop alert for business ${businessId}`);
            }
          }
        } else if (prevMentionRate > 0) {
          // Fallback: less than 3 days of data, compare to previous day
          const dropPct = ((prevMentionRate - todayMentionRate) / prevMentionRate) * 100;

          if (dropPct > 30) {
            const msg = `Mention rate dropped ${Math.round(dropPct)}% (from ${Math.round(prevMentionRate * 100)}% to ${Math.round(todayMentionRate * 100)}%) since ${prevDate}`;
            if (!alertExists("mention_drop", msg, today)) {
              await storage.createAlert({ businessId, type: "mention_drop", message: msg, severity: "critical", date: today });
              console.log(`[Alerts] Created critical mention_drop alert for business ${businessId}`);
            }
          } else if (dropPct > 15) {
            const msg = `Mention rate dropped ${Math.round(dropPct)}% (from ${Math.round(prevMentionRate * 100)}% to ${Math.round(todayMentionRate * 100)}%) since ${prevDate}`;
            if (!alertExists("mention_drop", msg, today)) {
              await storage.createAlert({ businessId, type: "mention_drop", message: msg, severity: "warning", date: today });
              console.log(`[Alerts] Created warning mention_drop alert for business ${businessId}`);
            }
          }
        }

        // ── (c) Platform-specific issues ───────────────────────────────────────
        // Check if any platform that previously had mentions now has 0 across all queries
        const prevByPlatform = new Map<number, { total: number; mentioned: number }>();
        for (const r of prevRecords) {
          const entry = prevByPlatform.get(r.platformId) ?? { total: 0, mentioned: 0 };
          entry.total++;
          if (r.mentioned === 1) entry.mentioned++;
          prevByPlatform.set(r.platformId, entry);
        }

        const todayByPlatform = new Map<number, { total: number; mentioned: number }>();
        for (const r of todayRecords) {
          const entry = todayByPlatform.get(r.platformId) ?? { total: 0, mentioned: 0 };
          entry.total++;
          if (r.mentioned === 1) entry.mentioned++;
          todayByPlatform.set(r.platformId, entry);
        }

        // Look up platform names
        const allPlatforms = await storage.getPlatforms();
        const platformNameMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p.name]));

        for (const [platformId, prev] of prevByPlatform) {
          if (prev.mentioned > 0) {
            const todayStats = todayByPlatform.get(platformId);
            if (todayStats && todayStats.total > 0 && todayStats.mentioned === 0) {
              const platformName = platformNameMap[platformId] ?? `Platform #${platformId}`;
              const msg = `${platformName} returned 0 mentions across all queries today (previously had ${prev.mentioned}/${prev.total})`;
              if (!alertExists("platform_missing", msg, today)) {
                await storage.createAlert({ businessId, type: "platform_missing", message: msg, severity: "info", date: today });
                console.log(`[Alerts] Created platform_missing alert for business ${businessId}: ${platformName}`);
              }
            }
          }
        }
      }
    }

    // ── (b) Competitor overtaking ──────────────────────────────────────────────
    // Compare competitor mention rates vs business mention rates per query today
    const comps = await storage.getCompetitors(businessId);
    if (comps.length > 0 && prevDateRow) {
      const prevDate = prevDateRow.date;

      for (const comp of comps) {
        // Get today's competitor records
        const todayCompRecords = db
          .select()
          .from(searchRecords)
          .where(sql`business_id = ${businessId} AND competitor_id = ${comp.id} AND date = ${today}`)
          .all();

        // Get previous competitor records
        const prevCompRecords = db
          .select()
          .from(searchRecords)
          .where(sql`business_id = ${businessId} AND competitor_id = ${comp.id} AND date = ${prevDate}`)
          .all();

        // Build per-query mention lookup for today and previous
        const todayBizByQuery = new Map<string, boolean>();
        for (const r of todayRecords) todayBizByQuery.set(r.query, r.mentioned === 1);

        const prevBizByQuery = new Map<string, boolean>();
        const prevBizRecords = db
          .select()
          .from(searchRecords)
          .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND date = ${prevDate}`)
          .all();
        for (const r of prevBizRecords) prevBizByQuery.set(r.query, r.mentioned === 1);

        const prevCompByQuery = new Map<string, boolean>();
        for (const r of prevCompRecords) prevCompByQuery.set(r.query, r.mentioned === 1);

        const todayCompByQuery = new Map<string, boolean>();
        for (const r of todayCompRecords) todayCompByQuery.set(r.query, r.mentioned === 1);

        // Find queries where: previously business was mentioned & competitor was not,
        // but now competitor is mentioned & business is not
        for (const [query, bizMentionedToday] of todayBizByQuery) {
          const compMentionedToday = todayCompByQuery.get(query) ?? false;
          const bizMentionedPrev = prevBizByQuery.get(query) ?? false;
          const compMentionedPrev = prevCompByQuery.get(query) ?? false;

          if (bizMentionedPrev && !compMentionedPrev && compMentionedToday && !bizMentionedToday) {
            const msg = `${comp.name} overtook your business on "${query}" — they are now mentioned while you are not`;
            if (!alertExists("competitor_outrank", msg, today)) {
              await storage.createAlert({ businessId, type: "competitor_outrank", message: msg, severity: "warning", date: today });
              console.log(`[Alerts] Created competitor_outrank alert for business ${businessId}: ${comp.name} on "${query}"`);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[Alerts] Error generating alerts for business ${businessId}:`, err.message);
  }
}

async function autoScanBusiness(businessId: number) {
  try {
    let biz = await storage.getBusiness(businessId);
    if (!biz) return;

    const keys = await storage.getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive);
    if (activeKeys.length === 0) {
      console.log(`[Auto-Scan] No API keys configured — skipping initial scan for "${biz.name}"`);
      return;
    }

    // Auto-detect competitors if none exist in the competitors table
    const existingComps = await storage.getCompetitors(businessId);
    if (existingComps.length === 0) {
      try {
        const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));
        // Check known_competitors field first
        const knownCsv = (biz as any).known_competitors ?? "";
        let compNames: string[] = [];
        if (knownCsv) {
          compNames = knownCsv.split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 1);
        }
        if (compNames.length === 0) {
          compNames = await detectCompetitors(biz.name, biz.industry, biz.location ?? null, keyInputs);
        }
        if (compNames.length > 0) {
          const csv = compNames.join(", ");
          console.log(`[Auto-Scan] Detected competitors for "${biz.name}": ${csv}`);
          db.run(sql`UPDATE businesses SET known_competitors = ${csv} WHERE id = ${businessId}`);
          // Insert into competitors table so they appear in the tab and get scanned
          for (const name of compNames) {
            try {
              await storage.createCompetitor({ businessId, name, industry: biz.industry });
            } catch (_e) { /* duplicate or error, skip */ }
          }
          biz = (await storage.getBusiness(businessId))!;
        }
      } catch (err: any) {
        console.error(`[Auto-Scan] Competitor detection failed for "${biz.name}":`, err.message);
      }
    }

    const ctx = toBizContext(biz);
    const queries = generateScanQueries(ctx);
    const extraTerms = buildExtraTerms(biz);
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
    setAnalysisKeys(keyInputs);
    const scanDateStr = new Date().toISOString().split("T")[0];
    setHealthCallback((provider, status, responseTimeMs, errorMessage) => {
      db.insert(platformHealth).values({ provider, status, errorMessage: errorMessage ?? null, responseTimeMs, date: scanDateStr, timestamp: new Date().toISOString() }).run();
    });

    for await (const result of runScan(biz.name, queries, keyInputs, extraTerms, { location: biz.location ?? null, website: biz.website ?? null, services: (biz as any).services ?? null, industry: biz.industry ?? null })) {
      completed++;
      const platformId = platformMap[result.platform] ?? 1;
      const dateStr = new Date().toISOString().split("T")[0];

      const record = await storage.createSearchRecord({
        businessId,
        platformId,
        query: result.query,
        mentioned: result.mentioned ? 1 : 0,
        position: result.position,
        sentiment: result.sentiment,
        confidence: result.confidence,
        sourceType: result.sourceType,
        crossValidated: result.crossValidated === null ? null : result.crossValidated ? 1 : 0,
        date: dateStr,
      });
      // Store granular sentiment data
      db.run(sql`UPDATE search_records SET sentiment_score = ${(result as any).sentimentScore ?? 50}, sentiment_topic = ${(result as any).sentimentTopic ?? 'general'} WHERE id = ${record.id}`);

      // Extract citations — prefer structured citedUrls from AI providers, fall back to regex
      const citedUrls: string[] = (result as any).citedUrls ?? [];
      if (citedUrls.length === 0 && result.responseText) {
        const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
        citedUrls.push(...(result.responseText.match(urlRegex) || []));
      }
      const uniqueUrls = [...new Set(citedUrls)];
      const bizDomain = biz.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || "";
      for (const url of uniqueUrls.slice(0, 20)) {
        const domain = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        const isOwn = bizDomain && domain.includes(bizDomain) ? 1 : 0;
        db.insert(citations).values({
          businessId,
          searchRecordId: record.id,
          url,
          domain,
          isOwnDomain: isOwn,
          platform: result.platform,
          query: result.query,
          date: dateStr,
        }).run();
      }

      // Track API cost (original query + analysis follow-up)
      const providerKey = keyInputs.find(k => {
        const pMap: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };
        return pMap[k.provider] === result.platform;
      });
      if (providerKey) {
        // Use actual token-based cost from result; fall back to flat-rate estimate
        const cost = (result as any).actualCost ?? (PROVIDER_COST_PER_CALL[providerKey.provider] ?? 0.005);
        db.insert(apiUsage).values({
          provider: providerKey.provider,
          estimatedCost: cost.toFixed(6),
          date: dateStr,
          timestamp: new Date().toISOString(),
        }).run();
      }

      if (result.mentioned) mentionCount++;

      // Flag issues for outliers or low confidence
      const issues: string[] = [];
      if (result.confidence === "low") issues.push("Low confidence analysis");
      if (result.crossValidated === false) issues.push("Outlier: disagrees with other platforms");

      // Run hallucination + citation checks in parallel (not sequentially)
      let hallucinationCount = 0;
      const checks: Promise<void>[] = [];

      if (result.mentioned && result.responseText) {
        checks.push(
          detectHallucinations(
            { name: biz.name, location: biz.location ?? null, website: biz.website ?? null, services: (biz as any).services ?? null },
            result.responseText,
            result.platform
          ).then(halCheck => {
            if (halCheck.hasHallucinations) {
              hallucinationCount = halCheck.issues.length;
              issues.push(...halCheck.issues.map(i => `Hallucination: ${i}`));
            }
          }).catch(err => console.error(`[Auto-Scan] Hallucination check failed:`, err.message))
        );
      }

      if (result.sourceType === "grounded" && result.mentioned) {
        checks.push(
          verifyCitations(result.responseText, biz.name).then(citationResult => {
            if (citationResult.failed > 0) {
              issues.push(`Citation: ${citationResult.failed} of ${citationResult.verified + citationResult.failed} cited URLs are broken/invalid`);
            }
          }).catch(() => {})
        );
      }

      await Promise.all(checks);

      if (result.responseText) {
        await storage.createAiSnapshot({
          businessId,
          platformId,
          query: result.query,
          responseText: result.responseText,
          sentiment: result.sentiment,
          mentionedAccurate: result.mentioned ? 1 : 0,
          flaggedIssues: issues.length > 0 ? JSON.stringify(issues) : null,
          hallucinationCount,
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

    console.log(`[Auto-Scan] Finished "${biz.name}": ${completed} queries, ${mentionCount} mentions`);

    // ── Competitor scanning ──────────────────────────────────────────────────
    const comps = await storage.getCompetitors(businessId);
    const compSubset = comps.slice(0, 5); // limit to 5 competitors
    const compQueries = queries.slice(0, 8); // use first 8 representative queries

    for (const comp of compSubset) {
      console.log(`[Auto-Scan] Scanning competitor "${comp.name}" for "${biz.name}"`);
      try {
        for await (const result of runScan(comp.name, compQueries, keyInputs, [], { industry: biz.industry ?? null, location: biz.location ?? null, website: null, services: null })) {
          const platformId = platformMap[result.platform] ?? 1;
          const dateStr = new Date().toISOString().split("T")[0];

          const compRecord = await storage.createSearchRecord({
            businessId,
            platformId,
            query: result.query,
            mentioned: result.mentioned ? 1 : 0,
            position: result.position,
            sentiment: result.sentiment,
            confidence: result.confidence,
            sourceType: result.sourceType,
            crossValidated: result.crossValidated === null ? null : result.crossValidated ? 1 : 0,
            competitorId: comp.id,
            date: dateStr,
          });
          db.run(sql`UPDATE search_records SET sentiment_score = ${(result as any).sentimentScore ?? 50}, sentiment_topic = ${(result as any).sentimentTopic ?? 'general'} WHERE id = ${compRecord.id}`);

          // Extract citations — prefer structured citedUrls, fall back to regex
          const compCitedUrls: string[] = (result as any).citedUrls ?? [];
          if (compCitedUrls.length === 0 && result.responseText) {
            const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
            compCitedUrls.push(...(result.responseText.match(urlRegex) || []));
          }
          const compUniqueUrls = [...new Set(compCitedUrls)];
          const compBizDomain = biz.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || "";
          for (const url of compUniqueUrls.slice(0, 20)) {
            const domain = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
            const isOwn = compBizDomain && domain.includes(compBizDomain) ? 1 : 0;
            db.insert(citations).values({
              businessId,
              searchRecordId: compRecord.id,
              url,
              domain,
              isOwnDomain: isOwn,
              platform: result.platform,
              query: result.query,
              date: dateStr,
            }).run();
          }

          // Track API cost for competitor scans too
          const providerKey = keyInputs.find(k => {
            const pMap: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };
            return pMap[k.provider] === result.platform;
          });
          if (providerKey) {
            const baseCost = PROVIDER_COST_PER_CALL[providerKey.provider] ?? 0.005;
            const analysisCost = 0.001;
            const cost = baseCost + analysisCost;
            db.insert(apiUsage).values({
              provider: providerKey.provider,
              estimatedCost: cost.toFixed(6),
              date: dateStr,
              timestamp: new Date().toISOString(),
            }).run();
          }
          // Skip AI snapshots for competitor scans (saves API cost)
        }
        console.log(`[Auto-Scan] Finished competitor "${comp.name}" for "${biz.name}"`);
      } catch (compErr: any) {
        console.error(`[Auto-Scan] Error scanning competitor "${comp.name}":`, compErr.message);
      }
    }

    // Generate alerts, prompts, and content gaps based on scan results
    await generateScanAlerts(businessId);
    await generateOptimizedPrompts(businessId);
    await generateContentGaps(businessId);
    await generateGeoActions(businessId);

  } catch (err: any) {
    console.error(`[Auto-Scan] Error for business ${businessId}:`, err.message);
  }
}

// ── Scheduled auto-scan system ─────────────────────────────────────────────
// Supports per-business scan frequencies: manual, daily, weekly, biweekly.
// Checks every hour for businesses that are due for a scan and runs them.
let scheduledScanRunning = false;

async function runAllBusinessScans(trigger: string) {
  if (nightlyScanRunning) {
    console.log(`[Scheduler] Scan already running — skipping ${trigger} trigger`);
    return;
  }
  nightlyScanRunning = true;

  try {
    const keys = await storage.getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive);
    if (activeKeys.length === 0) {
      console.log(`[Scheduler] No API keys configured — skipping ${trigger} scan`);
      return;
    }

    // Check daily budget
    const settings = db.select().from(apiSettings).get() as any;
    const dailyBudget = parseFloat(settings?.dailyBudget ?? settings?.daily_budget ?? "10.00");
    const today = new Date().toISOString().split("T")[0];
    const todayUsage = db.select({ total: sql<string>`coalesce(sum(cast(estimated_cost as real)), 0)` })
      .from(apiUsage).where(sql`date = ${today}`).get();
    const currentSpend = parseFloat(todayUsage?.total ?? "0");

    if (settings?.autoPauseEnabled && currentSpend >= dailyBudget) {
      console.log(`[Scheduler] Daily budget reached ($${currentSpend.toFixed(2)} / $${dailyBudget.toFixed(2)}) — skipping`);
      return;
    }

    const allBiz = await storage.getBusinesses();
    console.log(`[Scheduler] ${trigger}: scanning ${allBiz.length} businesses`);

    for (const biz of allBiz) {
      // Re-check budget before each business
      const latestUsage = db.select({ total: sql<string>`coalesce(sum(cast(estimated_cost as real)), 0)` })
        .from(apiUsage).where(sql`date = ${today}`).get();
      const latestSpend = parseFloat(latestUsage?.total ?? "0");
      if (settings?.autoPauseEnabled && latestSpend >= dailyBudget) {
        console.log(`[Scheduler] Budget hit mid-cycle — stopping`);
        break;
      }

      console.log(`[Scheduler] Scanning "${biz.name}"...`);
      await autoScanBusiness(biz.id);
    }

    lastNightlyScanDate = today;
    console.log(`[Scheduler] ${trigger}: all scans complete`);
  } catch (err: any) {
    console.error(`[Scheduler] Error during ${trigger} scan:`, err.message);
  } finally {
    nightlyScanRunning = false;
  }
}

// Check every 30 minutes if it's past 2 AM and we haven't scanned today yet
function startNightlyScheduler() {
  setInterval(() => {
    const now = new Date();
    const hour = now.getHours();
    const today = now.toISOString().split("T")[0];

    // Run at 2 AM if we haven't run today
    if (hour >= 2 && lastNightlyScanDate !== today) {
      runAllBusinessScans("nightly-2am");
    }
  }, 30 * 60 * 1000); // check every 30 min

  console.log("[Scheduler] Nightly 2 AM scan scheduler started");
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

  // Add rich context columns (safe for existing DBs)
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN keywords TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN services TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN target_audience TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN unique_selling_points TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN known_competitors TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE businesses ADD COLUMN custom_queries TEXT`); } catch (_e) { /* exists */ }

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

  // Add sentiment + confidence columns (safe for existing DBs)
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN sentiment TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN confidence TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN source_type TEXT`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN cross_validated INTEGER`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN competitor_id INTEGER`); } catch (_e) { /* exists */ }

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
    hallucination_count INTEGER NOT NULL DEFAULT 0,
    date TEXT NOT NULL
  )`);
  // Migration for existing DBs missing hallucination_count
  try { db.run(sql`ALTER TABLE ai_snapshots ADD COLUMN hallucination_count INTEGER NOT NULL DEFAULT 0`); } catch (_e) { /* exists */ }

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

  db.run(sql`CREATE TABLE IF NOT EXISTS click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    element_text TEXT,
    element_url TEXT,
    referrer TEXT,
    landing_page TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    device_type TEXT,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS agency_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    agency_name TEXT NOT NULL,
    logo_url TEXT,
    primary_color TEXT DEFAULT '#6366f1',
    custom_domain TEXT,
    footer_text TEXT,
    created_at TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS platform_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    response_time_ms INTEGER,
    date TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    search_record_id INTEGER,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    is_own_domain INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL,
    query TEXT NOT NULL,
    date TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS bot_visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    bot_name TEXT NOT NULL,
    page_url TEXT NOT NULL,
    status_code INTEGER,
    date TEXT NOT NULL,
    timestamp TEXT NOT NULL
  )`);

  db.run(sql`CREATE TABLE IF NOT EXISTS geo_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    opportunity_score TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'pending',
    related_query TEXT,
    created_at TEXT NOT NULL
  )`);

  // Add sentiment_score and sentiment_topic columns to search_records
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN sentiment_score INTEGER DEFAULT 50`); } catch (_e) { /* exists */ }
  try { db.run(sql`ALTER TABLE search_records ADD COLUMN sentiment_topic TEXT DEFAULT 'general'`); } catch (_e) { /* exists */ }

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
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_citations_business_date
    ON citations(business_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_citations_business_domain
    ON citations(business_id, domain)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_bot_visits_business_date
    ON bot_visits(business_id, date)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_geo_actions_business_status
    ON geo_actions(business_id, status)`);
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

  // Clean up stale scan jobs on startup (e.g. server crashed mid-scan)
  try {
    const staleJobs = db.select().from(scanJobs).where(sql`status = 'running'`).all();
    for (const j of staleJobs) {
      db.update(scanJobs).set({ status: "failed", error: "Server restarted while scan was running", completedAt: new Date().toISOString() }).where(sql`id = ${j.id}`).run();
      console.log(`[init] Marked stale scan job #${j.id} as failed`);
    }
  } catch (e) {
    console.error("[init] Failed to clean stale scan jobs:", e);
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

    // Trigger a background scan on login if we haven't scanned today
    const today = new Date().toISOString().split("T")[0];
    if (lastNightlyScanDate !== today) {
      runAllBusinessScans("login");
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = req.cookies?.session || req.headers.authorization?.replace("Bearer ", "");
    if (token) deleteSession(token);
    res.clearCookie("session");
    res.json({ success: true });
  });

  // ── Demo mode: creates a demo user + sample business with realistic data ──
  app.post("/api/auth/demo", async (req, res) => {
    try {
      // Create or find demo user
      let demoUser = await storage.getUserByUsername("demo");
      if (!demoUser) {
        const hash = bcrypt.hashSync("demo-viewer", 10);
        demoUser = db.insert(users).values({
          username: "demo",
          passwordHash: hash,
          displayName: "Demo Viewer",
          role: "admin", // admin so they can see everything
          isActive: 1,
          createdAt: new Date().toISOString(),
        }).returning().get();
      }

      // Generate fresh demo data
      const { businessId } = await generateDemoData(demoUser.id);

      // Create session
      const token = createSession(demoUser.id, demoUser.role);
      res.cookie("session", token, { httpOnly: true, sameSite: "lax", maxAge: 24 * 60 * 60 * 1000 });
      const { passwordHash, ...safeUser } = demoUser;
      res.json({ token, user: { ...safeUser, isDemo: true }, businessId });
    } catch (err: any) {
      console.error("[Demo] Error generating demo:", err.message);
      res.status(500).json({ error: "Failed to generate demo data" });
    }
  });

  // Clear demo data
  app.post("/api/auth/demo/clear", async (req, res) => {
    try {
      await clearDemoData();
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
    // Skip click-tracking endpoint — called from external websites without a session
    if (req.path.match(/^\/businesses\/\d+\/log-click$/) && (req.method === "POST" || req.method === "OPTIONS")) return next();
    requireAuth(req, res, next);
  });

  // === Business access check middleware for customer users ===
  app.use("/api/businesses/:id", async (req: Request, res: Response, next: NextFunction) => {
    // log-click is public (called from external websites)
    if (req.path === "/log-click" && (req.method === "POST" || req.method === "OPTIONS")) return next();
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

  // === AGENCY / WHITE-LABEL ROUTES ===
  app.get("/api/agency/settings", requireAdmin, async (req, res) => {
    const settings = await storage.getAgencySettings(req.user!.userId);
    res.json(settings ?? null);
  });

  app.put("/api/agency/settings", requireAdmin, async (req, res) => {
    const { agencyName, logoUrl, primaryColor, customDomain, footerText } = req.body;
    if (!agencyName) return res.status(400).json({ error: "agencyName is required" });
    const settings = await storage.upsertAgencySettings(req.user!.userId, {
      agencyName,
      logoUrl: logoUrl ?? null,
      primaryColor: primaryColor ?? "#6366f1",
      customDomain: customDomain ?? null,
      footerText: footerText ?? null,
    });
    res.json(settings);
  });

  app.get("/api/agency/clients", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getUsers();
    const clients = allUsers.filter((u) => u.role === "customer");
    const result = [];
    for (const client of clients) {
      const bizIds = await storage.getUserBusinessIds(client.id);
      result.push({ ...client, assignedBusinessCount: bizIds.length, assignedBusinessIds: bizIds });
    }
    res.json(result);
  });

  app.post("/api/agency/clients", requireAdmin, async (req, res) => {
    const { username, password, displayName, businessIds } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: "username, password, and displayName required" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) return res.status(400).json({ error: "Username already exists" });
    const user = await storage.createUser({ username, password, displayName, role: "customer" });
    // Assign businesses if provided
    if (Array.isArray(businessIds)) {
      for (const bizId of businessIds) {
        await storage.assignBusiness(user.id, bizId);
      }
    }
    const { passwordHash, ...safe } = user;
    res.json(safe);
  });

  app.get("/api/agency/client-report/:businessId", requireAdmin, async (req, res) => {
    const businessId = parseInt(req.params.businessId as string);
    const biz = await storage.getBusiness(businessId);
    if (!biz) return res.status(404).json({ error: "Business not found" });

    const records = await storage.getSearchRecords(businessId);
    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p.name]));

    // Calculate mention rate
    const totalRecords = records.length;
    const mentioned = records.filter((r) => r.mentioned === 1);
    const mentionRate = totalRecords > 0 ? Math.round((mentioned.length / totalRecords) * 100) : 0;

    // Average position among mentioned results
    const positions = mentioned.filter((r) => r.position != null).map((r) => r.position!);
    const avgPosition = positions.length > 0 ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10 : 0;

    // Top platform
    const platformCounts: Record<string, number> = {};
    for (const r of mentioned) {
      const pName = platformMap[r.platformId] || "Unknown";
      platformCounts[pName] = (platformCounts[pName] || 0) + 1;
    }
    const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";

    // Trend: compare last 7 days vs previous 7 days
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0];
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split("T")[0];
    const recentRecords = records.filter((r) => r.date >= sevenDaysAgo);
    const prevRecords = records.filter((r) => r.date >= fourteenDaysAgo && r.date < sevenDaysAgo);
    const recentMentionRate = recentRecords.length > 0 ? (recentRecords.filter((r) => r.mentioned === 1).length / recentRecords.length) * 100 : 0;
    const prevMentionRate = prevRecords.length > 0 ? (prevRecords.filter((r) => r.mentioned === 1).length / prevRecords.length) * 100 : 0;
    const diff = recentMentionRate - prevMentionRate;
    const trend = diff > 0 ? "up" : diff < 0 ? "down" : "stable";
    const weekOverWeek = diff > 0 ? `+${Math.round(diff)}%` : `${Math.round(diff)}%`;

    // Top queries by mention rate
    const queryMap: Record<string, { total: number; mentioned: number }> = {};
    for (const r of records) {
      if (!queryMap[r.query]) queryMap[r.query] = { total: 0, mentioned: 0 };
      queryMap[r.query].total++;
      if (r.mentioned === 1) queryMap[r.query].mentioned++;
    }
    const topQueries = Object.entries(queryMap)
      .map(([query, stats]) => ({ query, mentionRate: Math.round((stats.mentioned / stats.total) * 100) }))
      .sort((a, b) => b.mentionRate - a.mentionRate)
      .slice(0, 5);

    // Simple recommendations based on data
    const recommendations: string[] = [];
    if (mentionRate < 50) recommendations.push("Mention rate is below 50% -- consider optimizing your business listings and online presence.");
    if (avgPosition > 3) recommendations.push("Average position is low -- focus on building authority through quality content and backlinks.");
    if (topQueries.some((q) => q.mentionRate < 30)) recommendations.push("Some key queries have very low visibility -- create targeted content for those topics.");
    if (trend === "down") recommendations.push("Visibility is trending down -- review recent AI platform changes and adjust your strategy.");
    if (recommendations.length === 0) recommendations.push("Visibility is strong -- keep maintaining your current strategy.");

    res.json({
      business: { name: biz.name, industry: biz.industry },
      mentionRate,
      avgPosition,
      topPlatform,
      trend,
      weekOverWeek,
      topQueries,
      recommendations,
      generatedAt: new Date().toISOString(),
    });
  });

  // === BUSINESSES ===
  // Mark demo businesses so frontends can warn users not to treat the data as real.
  const DEMO_MARKER = "[DEMO]";
  function withDemoFlag<T extends { description?: string | null }>(biz: T): T & { isDemo: boolean } {
    return { ...biz, isDemo: (biz.description ?? "").includes(DEMO_MARKER) };
  }

  app.get("/api/businesses", async (req, res) => {
    const allBiz = await storage.getBusinesses();
    if (req.user?.role === "admin") return res.json(allBiz.map(withDemoFlag));
    const allowed = await storage.getUserBusinessIds(req.user!.userId);
    res.json(allBiz.filter((b) => allowed.includes(b.id)).map(withDemoFlag));
  });

  app.get("/api/businesses/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const business = await storage.getBusiness(id);
    if (!business) return res.status(404).json({ error: "Business not found" });
    res.json(withDemoFlag(business));
  });

  app.post("/api/businesses", async (req, res) => {
    const parsed = insertBusinessSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const business = await storage.createBusiness(parsed.data);

    // Fire-and-forget: run an initial AI scan in the background so the user
    // gets real data instead of simulated data. The response returns immediately.
    autoScanBusiness(business.id);

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

  // === DIAGNOSTIC: test a single query to see raw AI responses ===
  app.get("/api/businesses/:id/diagnostic", async (req, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const biz = await storage.getBusiness(businessId);
      if (!biz) return res.status(404).json({ error: "Business not found" });

      const keys = await storage.getApiKeys();
      const activeKeys = keys.filter((k) => k.isActive);
      if (activeKeys.length === 0) return res.status(400).json({ error: "No API keys configured" });

      const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));

      // Test with a direct name query and a discovery query
      const directQuery = `Tell me about ${biz.name}${biz.location ? ` in ${biz.location}` : ""}. Are they any good?`;
      const discoveryQuery = `What are the best ${biz.industry?.toLowerCase() || "service"} companies${biz.location ? ` in ${biz.location}` : ""}? Give me your top picks.`;

      const [directResults, discoveryResults] = await Promise.all([
        diagnosticQuery(biz.name, directQuery, keyInputs, { location: biz.location, website: biz.website, services: (biz as any).services, industry: biz.industry ?? null }),
        diagnosticQuery(biz.name, discoveryQuery, keyInputs, { location: biz.location, website: biz.website, services: (biz as any).services, industry: biz.industry ?? null }),
      ]);

      res.json({
        businessName: biz.name,
        platformsConfigured: activeKeys.map(k => k.provider),
        directQuery: { query: directQuery, results: directResults },
        discoveryQuery: { query: discoveryQuery, results: discoveryResults },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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

  // === QUERY TRENDS (historical per-query tracking) ===
  app.get("/api/businesses/:id/query-trends", async (req, res) => {
    const id = parseInt(req.params.id);
    const days = parseInt((req.query.days as string) ?? "30") || 30;
    const queryFilter = req.query.query as string | undefined;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    let rows: any[];
    if (queryFilter) {
      rows = db.select({
        query: searchRecords.query,
        date: searchRecords.date,
        total: sql<number>`count(*)`,
        mentions: sql<number>`sum(case when ${searchRecords.mentioned} = 1 then 1 else 0 end)`,
        avgPosition: sql<number>`avg(case when ${searchRecords.mentioned} = 1 then ${searchRecords.position} end)`,
      })
        .from(searchRecords)
        .where(sql`${searchRecords.businessId} = ${id} AND ${searchRecords.competitorId} IS NULL AND ${searchRecords.date} >= ${cutoffStr} AND ${searchRecords.query} = ${queryFilter}`)
        .groupBy(searchRecords.query, searchRecords.date)
        .orderBy(searchRecords.date)
        .all();
    } else {
      rows = db.select({
        query: searchRecords.query,
        date: searchRecords.date,
        total: sql<number>`count(*)`,
        mentions: sql<number>`sum(case when ${searchRecords.mentioned} = 1 then 1 else 0 end)`,
        avgPosition: sql<number>`avg(case when ${searchRecords.mentioned} = 1 then ${searchRecords.position} end)`,
      })
        .from(searchRecords)
        .where(sql`${searchRecords.businessId} = ${id} AND ${searchRecords.competitorId} IS NULL AND ${searchRecords.date} >= ${cutoffStr}`)
        .groupBy(searchRecords.query, searchRecords.date)
        .orderBy(searchRecords.date)
        .all();
    }

    // Group rows by query
    const grouped: Record<string, any[]> = {};
    for (const row of rows) {
      if (!grouped[row.query]) grouped[row.query] = [];
      const mentionRate = row.total > 0 ? Math.round((row.mentions / row.total) * 100) : 0;
      grouped[row.query].push({
        date: row.date,
        mentionRate,
        avgPosition: row.avgPosition != null ? Math.round(row.avgPosition * 10) / 10 : null,
        total: row.total,
      });
    }

    const trends = Object.entries(grouped).map(([query, dataPoints]) => ({ query, dataPoints }));
    res.json({ trends });
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

  app.get("/api/businesses/:id/competitor-visibility", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p]));
    const comps = await storage.getCompetitors(businessId);

    // Fetch all competitor search records for this business
    const rows = db.select({
      competitorId: sql<number>`competitor_id`,
      platformId: searchRecords.platformId,
      total: sql<number>`count(*)`,
      mentions: sql<number>`sum(case when mentioned = 1 then 1 else 0 end)`,
      avgPosition: sql<number>`avg(case when mentioned = 1 then position end)`,
    })
      .from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NOT NULL`)
      .groupBy(sql`competitor_id, platform_id`)
      .all();

    // Group by competitor
    const compMap = new Map<number, {
      competitorId: number;
      competitorName: string;
      totalQueries: number;
      mentions: number;
      platformBreakdown: { platformName: string; mentionRate: number; color: string }[];
      positionSum: number;
      positionCount: number;
    }>();

    for (const comp of comps) {
      compMap.set(comp.id, {
        competitorId: comp.id,
        competitorName: comp.name,
        totalQueries: 0,
        mentions: 0,
        platformBreakdown: [],
        positionSum: 0,
        positionCount: 0,
      });
    }

    for (const row of rows) {
      const entry = compMap.get(row.competitorId);
      if (!entry) continue;
      entry.totalQueries += row.total;
      entry.mentions += row.mentions;
      if (row.avgPosition) {
        entry.positionSum += row.avgPosition * row.mentions;
        entry.positionCount += row.mentions;
      }
      const plat = platformMap[row.platformId];
      if (plat) {
        entry.platformBreakdown.push({
          platformName: plat.name,
          mentionRate: row.total > 0 ? Math.round((row.mentions / row.total) * 100) : 0,
          color: plat.color,
        });
      }
    }

    const result = Array.from(compMap.values()).map((e) => ({
      competitorId: e.competitorId,
      competitorName: e.competitorName,
      mentionRate: e.totalQueries > 0 ? Math.round((e.mentions / e.totalQueries) * 100) : 0,
      avgPosition: e.positionCount > 0 ? Math.round((e.positionSum / e.positionCount) * 10) / 10 : null,
      totalQueries: e.totalQueries,
      mentions: e.mentions,
      platformBreakdown: e.platformBreakdown.sort((a, b) => b.mentionRate - a.mentionRate),
    }));

    res.json(result);
  });

  // === COMPETITIVE PROMPT INTELLIGENCE ===
  // Compares query-level performance: your business vs each competitor
  app.get("/api/businesses/:id/competitor-prompts", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const comps = await storage.getCompetitors(businessId);
    if (comps.length === 0) return res.json({ queries: [], recommendations: [] });

    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.id, p.name]));

    // Get YOUR search records (no competitor)
    const myRecords = db.select({
      query: searchRecords.query,
      mentioned: searchRecords.mentioned,
      position: searchRecords.position,
      sentiment: searchRecords.sentiment,
      confidence: searchRecords.confidence,
      platformId: searchRecords.platformId,
    })
      .from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL`)
      .all();

    // Get COMPETITOR search records
    const compRecords = db.select({
      query: searchRecords.query,
      mentioned: searchRecords.mentioned,
      position: searchRecords.position,
      competitorId: sql<number>`competitor_id`,
      platformId: searchRecords.platformId,
    })
      .from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NOT NULL`)
      .all();

    const compNameMap = Object.fromEntries(comps.map((c) => [c.id, c.name]));

    // Build per-query comparison
    type QueryStats = {
      query: string;
      myMentionRate: number;
      myMentions: number;
      myTotal: number;
      myAvgPosition: number | null;
      mySentiment: string | null;
      competitors: {
        name: string;
        mentionRate: number;
        mentions: number;
        total: number;
        avgPosition: number | null;
      }[];
      gap: number; // best competitor rate - my rate (positive = they're winning)
      status: "winning" | "losing" | "tied" | "no_data";
    };

    const queryMap = new Map<string, {
      myMentions: number; myTotal: number; myPosSum: number; myPosCount: number; mySentiments: string[];
      comps: Map<number, { mentions: number; total: number; posSum: number; posCount: number }>;
    }>();

    // Aggregate own records
    for (const r of myRecords) {
      if (!queryMap.has(r.query)) {
        queryMap.set(r.query, { myMentions: 0, myTotal: 0, myPosSum: 0, myPosCount: 0, mySentiments: [], comps: new Map() });
      }
      const q = queryMap.get(r.query)!;
      q.myTotal++;
      if (r.mentioned) {
        q.myMentions++;
        if (r.position) { q.myPosSum += r.position; q.myPosCount++; }
      }
      if (r.sentiment) q.mySentiments.push(r.sentiment);
    }

    // Aggregate competitor records
    for (const r of compRecords) {
      if (!queryMap.has(r.query)) {
        queryMap.set(r.query, { myMentions: 0, myTotal: 0, myPosSum: 0, myPosCount: 0, mySentiments: [], comps: new Map() });
      }
      const q = queryMap.get(r.query)!;
      if (!q.comps.has(r.competitorId)) {
        q.comps.set(r.competitorId, { mentions: 0, total: 0, posSum: 0, posCount: 0 });
      }
      const c = q.comps.get(r.competitorId)!;
      c.total++;
      if (r.mentioned) {
        c.mentions++;
        if (r.position) { c.posSum += r.position; c.posCount++; }
      }
    }

    // Build final query comparison list
    const queries: QueryStats[] = [];
    for (const [query, data] of queryMap) {
      const myRate = data.myTotal > 0 ? Math.round((data.myMentions / data.myTotal) * 100) : 0;
      const myPos = data.myPosCount > 0 ? Math.round((data.myPosSum / data.myPosCount) * 10) / 10 : null;
      const topSentiment = data.mySentiments.length > 0
        ? (data.mySentiments.filter(s => s === "positive").length >= data.mySentiments.length / 2 ? "positive"
          : data.mySentiments.filter(s => s === "negative").length >= data.mySentiments.length / 2 ? "negative" : "neutral")
        : null;

      const compStats = Array.from(data.comps.entries()).map(([cId, c]) => ({
        name: compNameMap[cId] || `Competitor #${cId}`,
        mentionRate: c.total > 0 ? Math.round((c.mentions / c.total) * 100) : 0,
        mentions: c.mentions,
        total: c.total,
        avgPosition: c.posCount > 0 ? Math.round((c.posSum / c.posCount) * 10) / 10 : null,
      }));

      const bestCompRate = compStats.length > 0 ? Math.max(...compStats.map(c => c.mentionRate)) : 0;
      const gap = bestCompRate - myRate;
      const status = data.myTotal === 0 && compStats.every(c => c.total === 0) ? "no_data"
        : gap > 10 ? "losing" : gap < -10 ? "winning" : "tied";

      queries.push({
        query,
        myMentionRate: myRate,
        myMentions: data.myMentions,
        myTotal: data.myTotal,
        myAvgPosition: myPos,
        mySentiment: topSentiment,
        competitors: compStats,
        gap,
        status,
      });
    }

    // Sort by gap descending (biggest competitor advantage first)
    queries.sort((a, b) => b.gap - a.gap);

    // Generate recommendations for queries where competitors are winning
    const recommendations: { query: string; competitors: string[]; tip: string; priority: "high" | "medium" | "low" }[] = [];

    for (const q of queries) {
      if (q.status !== "losing") continue;
      const winningComps = q.competitors.filter(c => c.mentionRate > q.myMentionRate).map(c => c.name);
      let tip = "";
      let priority: "high" | "medium" | "low" = "medium";

      if (q.myMentionRate === 0) {
        tip = `You're not mentioned at all for "${q.query}" but ${winningComps.join(", ")} ${winningComps.length === 1 ? "is" : "are"}. Add this topic to your website content, FAQ page, or blog to increase visibility.`;
        priority = "high";
      } else if (q.gap > 50) {
        tip = `${winningComps.join(", ")} ${winningComps.length === 1 ? "dominates" : "dominate"} this query with ${q.gap}% higher mention rate. Create dedicated content targeting "${q.query}" — consider a landing page, detailed blog post, or structured FAQ.`;
        priority = "high";
      } else if (q.gap > 25) {
        tip = `Competitors are ahead by ${q.gap}%. Strengthen your content around "${q.query}" with more specific details, case studies, or customer testimonials.`;
        priority = "medium";
      } else {
        tip = `Close gap (${q.gap}%). Fine-tune your existing content for "${q.query}" — ensure your business name, services, and differentiators are clearly stated.`;
        priority = "low";
      }

      recommendations.push({ query: q.query, competitors: winningComps, tip, priority });
    }

    res.json({
      queries: queries.slice(0, 50), // limit response size
      recommendations: recommendations.slice(0, 20),
      summary: {
        totalQueries: queries.length,
        winning: queries.filter(q => q.status === "winning").length,
        losing: queries.filter(q => q.status === "losing").length,
        tied: queries.filter(q => q.status === "tied").length,
      },
    });
  });

  // === CONTENT BRIEF GENERATION ===
  // Generates an actionable content brief for a given search query
  app.post("/api/businesses/:id/content-brief", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const { query } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    // Get API keys
    const keys = await storage.getApiKeys();
    const activeKeys = keys.filter((k) => k.isActive);
    if (activeKeys.length === 0) {
      return res.status(400).json({ error: "No API keys configured. Add one in Settings first." });
    }

    const prompt = `You are an SEO content strategist. Generate a detailed content brief for the following business to help them rank for a specific search query.

Business details:
- Name: ${business.name}
- Industry: ${business.industry || "Not specified"}
- Services: ${business.services || "Not specified"}
- Location: ${business.location || "Not specified"}
- Target Audience: ${business.targetAudience || "Not specified"}
- Description: ${business.description || "Not specified"}

Target search query: "${query}"

Return ONLY valid JSON with this exact structure:
{
  "title": "SEO-optimized title for the content piece",
  "contentType": "blog_post" or "faq" or "landing_page" or "guide" or "comparison" or "case_study",
  "wordCount": number between 800 and 3000,
  "outline": [
    { "heading": "Section heading", "points": ["Key point 1", "Key point 2"] }
  ],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "callToAction": "Suggested call to action for the content",
  "rationale": "Brief explanation of why this content will help rank for the query"
}

Include 3-6 sections in the outline, each with 2-4 bullet points. Include 5-10 keywords. Make the content brief specific and actionable.${business.location ? ` Focus on the LOCAL market in ${business.location} — include location-specific keywords, local landmarks, neighborhoods, and references that will help this business rank for local AI searches within a 25-mile radius.` : ""}`;

    // Try providers in cost order
    const priority = ["google", "openai", "anthropic", "perplexity"];
    const sortedKeys = [...activeKeys].sort((a, b) => {
      return priority.indexOf(a.provider) - priority.indexOf(b.provider);
    });

    let result: any = null;

    for (const key of sortedKeys) {
      try {
        let responseText = "";

        if (key.provider === "google") {
          const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: "You are an SEO content strategist. Return only valid JSON, no markdown or explanation." }] },
              contents: [{ parts: [{ text: prompt }] }],
            }),
          });
          if (!apiRes.ok) continue;
          const data = await apiRes.json();
          responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        } else if (key.provider === "openai") {
          const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              max_completion_tokens: 2048,
              messages: [
                { role: "system", content: "You are an SEO content strategist. Return only valid JSON, no markdown or explanation." },
                { role: "user", content: prompt },
              ],
            }),
          });
          if (!apiRes.ok) continue;
          const data = await apiRes.json();
          responseText = data.choices?.[0]?.message?.content ?? "";
        } else if (key.provider === "anthropic") {
          const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 2048,
              system: "You are an SEO content strategist. Return only valid JSON, no markdown or explanation.",
              messages: [{ role: "user", content: prompt }],
            }),
          });
          if (!apiRes.ok) continue;
          const data = await apiRes.json();
          responseText = Array.isArray(data.content)
            ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
            : "";
        } else if (key.provider === "perplexity") {
          const apiRes = await fetch("https://api.perplexity.ai/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "sonar",
              max_tokens: 2048,
              messages: [
                { role: "system", content: "You are an SEO content strategist. Return only valid JSON, no markdown or explanation." },
                { role: "user", content: prompt },
              ],
            }),
          });
          if (!apiRes.ok) continue;
          const data = await apiRes.json();
          responseText = data.choices?.[0]?.message?.content ?? "";
        }

        // Parse the JSON response
        const jsonCleaned = responseText.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
        result = JSON.parse(jsonCleaned);
        break; // success, stop trying providers
      } catch (err: any) {
        console.error(`[ContentBrief] ${key.provider} failed:`, err.message);
        continue;
      }
    }

    if (!result) {
      return res.status(500).json({ error: "Could not generate content brief. Try again later." });
    }

    // Track API cost
    const dateStr = new Date().toISOString().split("T")[0];
    db.insert(apiUsage).values({
      provider: sortedKeys[0]?.provider ?? "unknown",
      estimatedCost: "0.003",
      date: dateStr,
      timestamp: new Date().toISOString(),
    }).run();

    res.json({
      title: result.title || "",
      contentType: result.contentType || "blog_post",
      wordCount: result.wordCount || 1500,
      outline: Array.isArray(result.outline) ? result.outline : [],
      keywords: Array.isArray(result.keywords) ? result.keywords : [],
      callToAction: result.callToAction || "",
      rationale: result.rationale || "",
    });
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

  // === CITATIONS ===
  app.get("/api/businesses/:id/citations", async (req, res) => {
    const businessId = parseInt(req.params.id);

    const allCitations = db.select().from(citations)
      .where(sql`business_id = ${businessId}`)
      .all();

    // Group by domain
    const domainMap = new Map<string, { domain: string; count: number; isOwn: boolean; platforms: Set<string> }>();
    for (const c of allCitations) {
      if (!domainMap.has(c.domain)) {
        domainMap.set(c.domain, { domain: c.domain, count: 0, isOwn: !!c.isOwnDomain, platforms: new Set() });
      }
      const d = domainMap.get(c.domain)!;
      d.count++;
      if (c.platform) d.platforms.add(c.platform);
    }

    const domains = [...domainMap.values()]
      .map(d => ({ ...d, platforms: [...d.platforms] }))
      .sort((a, b) => b.count - a.count);

    const totalCitations = allCitations.length;
    const ownCitations = allCitations.filter(c => c.isOwnDomain).length;
    const ownRate = totalCitations > 0 ? Math.round((ownCitations / totalCitations) * 100) : 0;

    res.json({
      totalCitations,
      ownCitations,
      ownCitationRate: ownRate,
      topDomains: domains.slice(0, 20),
      recentCitations: allCitations.slice(-20).reverse(),
    });
  });

  // === SENTIMENT ANALYTICS ===
  app.get("/api/businesses/:id/sentiment", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const records = db.select().from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL AND mentioned = 1`)
      .all();

    if (records.length === 0) return res.json({ overallScore: 50, topicBreakdown: [], trend: [], recentMentions: [] });

    // Overall average sentiment score
    const scores = records.map(r => (r as any).sentiment_score ?? (r as any).sentimentScore ?? 50);
    const overallScore = Math.round(scores.reduce((a: number, b: number) => a + b, 0) / scores.length);

    // Breakdown by topic
    const topicMap = new Map<string, { scores: number[]; count: number }>();
    for (const r of records) {
      const topic = (r as any).sentiment_topic ?? (r as any).sentimentTopic ?? "general";
      if (!topicMap.has(topic)) topicMap.set(topic, { scores: [], count: 0 });
      const t = topicMap.get(topic)!;
      t.scores.push((r as any).sentiment_score ?? (r as any).sentimentScore ?? 50);
      t.count++;
    }
    const topicBreakdown = [...topicMap.entries()].map(([topic, data]) => ({
      topic,
      avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
      count: data.count,
      sentiment: data.scores.reduce((a, b) => a + b, 0) / data.scores.length >= 65 ? "positive" : data.scores.reduce((a, b) => a + b, 0) / data.scores.length <= 35 ? "negative" : "neutral",
    })).sort((a, b) => b.count - a.count);

    // Trend over time (by date)
    const dateMap = new Map<string, number[]>();
    for (const r of records) {
      if (!dateMap.has(r.date)) dateMap.set(r.date, []);
      dateMap.get(r.date)!.push((r as any).sentiment_score ?? (r as any).sentimentScore ?? 50);
    }
    const trend = [...dateMap.entries()]
      .map(([date, scores]) => ({ date, avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    // Recent strong mentions (positive or negative)
    const recentMentions = records
      .filter(r => {
        const score = (r as any).sentiment_score ?? (r as any).sentimentScore ?? 50;
        return score >= 75 || score <= 25;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10)
      .map(r => ({
        query: r.query,
        sentiment: r.sentiment,
        sentimentScore: (r as any).sentiment_score ?? (r as any).sentimentScore ?? 50,
        topic: (r as any).sentiment_topic ?? (r as any).sentimentTopic ?? "general",
        date: r.date,
      }));

    res.json({ overallScore, topicBreakdown, trend, recentMentions });
  });

  // === GEO ROADMAP (Actionable Tasks) ===
  app.get("/api/businesses/:id/geo-actions", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const actions = db.select().from(geoActions)
      .where(sql`business_id = ${businessId}`)
      .all();
    res.json(actions);
  });

  app.patch("/api/geo-actions/:id", async (req, res) => {
    const actionId = parseInt(req.params.id);
    const { status } = req.body;
    if (!["pending", "in_progress", "done", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    db.run(sql`UPDATE geo_actions SET status = ${status} WHERE id = ${actionId}`);
    res.json({ success: true });
  });

  app.post("/api/businesses/:id/generate-geo-actions", async (req, res) => {
    const businessId = parseInt(req.params.id);
    try {
      await generateGeoActions(businessId);
      const actions = db.select().from(geoActions).where(sql`business_id = ${businessId}`).all();
      res.json(actions);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === BOT CRAWLER ANALYTICS ===
  app.get("/api/businesses/:id/bot-analytics", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const visits = db.select().from(botVisits).where(sql`business_id = ${businessId}`).all();

    // Group by bot
    const botMap = new Map<string, { count: number; pages: Set<string>; lastSeen: string }>();
    for (const v of visits) {
      if (!botMap.has(v.botName)) botMap.set(v.botName, { count: 0, pages: new Set(), lastSeen: "" });
      const b = botMap.get(v.botName)!;
      b.count++;
      b.pages.add(v.pageUrl);
      if (v.date > b.lastSeen) b.lastSeen = v.date;
    }

    const bots = [...botMap.entries()].map(([name, data]) => ({
      botName: name,
      visitCount: data.count,
      uniquePages: data.pages.size,
      lastSeen: data.lastSeen,
    })).sort((a, b) => b.visitCount - a.visitCount);

    // Daily trend
    const dayMap = new Map<string, number>();
    for (const v of visits) {
      dayMap.set(v.date, (dayMap.get(v.date) ?? 0) + 1);
    }
    const dailyTrend = [...dayMap.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    res.json({ totalVisits: visits.length, bots, dailyTrend, recentVisits: visits.slice(-20).reverse() });
  });

  // Ingest bot visits from website (called by embedded snippet or server log parser)
  app.post("/api/businesses/:id/bot-visits", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const { botName, pageUrl, statusCode } = req.body;
    if (!botName || !pageUrl) return res.status(400).json({ error: "botName and pageUrl required" });
    const now = new Date();
    db.insert(botVisits).values({
      businessId,
      botName,
      pageUrl,
      statusCode: statusCode ?? null,
      date: now.toISOString().split("T")[0],
      timestamp: now.toISOString(),
    }).run();
    res.json({ success: true });
  });

  // === PROMPT VOLUME / AI SEARCH DEMAND ===
  app.get("/api/businesses/:id/prompt-demand", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const records = db.select().from(searchRecords)
      .where(sql`business_id = ${businessId} AND competitor_id IS NULL`)
      .all();

    if (records.length === 0) return res.json({ queries: [] });

    // Group by query — estimate "demand" by consistency of responses
    const queryMap = new Map<string, { mentioned: number; total: number; platforms: Set<string>; dates: Set<string> }>();
    for (const r of records) {
      if (!queryMap.has(r.query)) queryMap.set(r.query, { mentioned: 0, total: 0, platforms: new Set(), dates: new Set() });
      const q = queryMap.get(r.query)!;
      q.total++;
      if (r.mentioned) q.mentioned++;
      // Get platform name from platformId
      const platNames: Record<number, string> = { 1: "ChatGPT", 2: "Perplexity", 3: "Google Gemini", 4: "Claude" };
      q.platforms.add(platNames[r.platformId] ?? `Platform ${r.platformId}`);
      q.dates.add(r.date);
    }

    const queries = [...queryMap.entries()].map(([query, data]) => {
      const mentionRate = Math.round((data.mentioned / data.total) * 100);
      // Estimate popularity: queries that appear across more platforms and dates = higher demand
      const platformCoverage = data.platforms.size / 4; // out of 4 platforms
      const dateCoverage = data.dates.size;
      const demandScore = Math.round(((platformCoverage * 50) + Math.min(dateCoverage * 10, 50)));

      return {
        query,
        mentionRate,
        totalResults: data.total,
        platforms: [...data.platforms],
        scanCount: data.dates.size,
        estimatedDemand: demandScore >= 70 ? "high" : demandScore >= 40 ? "medium" : "low",
        demandScore,
        topic: categorizeQuery(query),
      };
    }).sort((a, b) => b.demandScore - a.demandScore);

    res.json({ queries });
  });

  // === DATA EXPORT API (BI Integration) ===
  app.get("/api/businesses/:id/export/json", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const biz = await storage.getBusiness(businessId);
    if (!biz) return res.status(404).json({ error: "Business not found" });

    const records = await storage.getSearchRecords(businessId);
    const stats = await storage.getSearchStats(businessId);
    const gaps = await storage.getContentGaps(businessId);
    const snaps = await storage.getAiSnapshots(businessId);
    const allCitations = db.select().from(citations).where(sql`business_id = ${businessId}`).all();
    const actions = db.select().from(geoActions).where(sql`business_id = ${businessId}`).all();

    res.json({
      exportDate: new Date().toISOString(),
      business: biz,
      stats,
      records,
      citations: allCitations,
      contentGaps: gaps,
      geoActions: actions,
      snapshots: snaps.map(s => ({ ...s, responseText: s.responseText.substring(0, 500) })),
    });
  });

  app.get("/api/businesses/:id/export/looker-csv", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const records = await storage.getSearchRecords(businessId);
    const biz = await storage.getBusiness(businessId);
    if (!biz) return res.status(404).json({ error: "Business not found" });

    const platNames: Record<number, string> = { 1: "ChatGPT", 2: "Perplexity", 3: "Google Gemini", 4: "Claude" };
    const header = "date,query,platform,mentioned,position,sentiment,sentiment_score,sentiment_topic,confidence,source_type,cross_validated\n";
    const rows = records.map(r =>
      `${r.date},"${r.query.replace(/"/g, '""')}",${platNames[r.platformId] ?? r.platformId},${r.mentioned},${r.position ?? ""},${r.sentiment ?? ""},${(r as any).sentiment_score ?? (r as any).sentimentScore ?? ""},${(r as any).sentiment_topic ?? (r as any).sentimentTopic ?? ""},${r.confidence ?? ""},${r.sourceType ?? ""},${r.crossValidated ?? ""}`
    ).join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${biz.name.replace(/[^a-zA-Z0-9]/g, "_")}_looker_data.csv"`);
    res.send(header + rows);
  });

  // === CONTENT DRAFT SUGGESTIONS ===
  app.get("/api/businesses/:id/content-drafts", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const biz = await storage.getBusiness(businessId);
    if (!biz) return res.status(404).json({ error: "Business not found" });
    const gaps = await storage.getContentGaps(businessId);

    const drafts = gaps.slice(0, 10).map(gap => {
      const lq = gap.query.toLowerCase();
      let outline: string[] = [];
      let suggestedTitle = "";
      let wordCount = 0;

      if (gap.contentType === "blog_post") {
        suggestedTitle = `${gap.query} — A Complete Guide by ${biz.name}`;
        wordCount = 1200;
        outline = [
          `Introduction — Why "${gap.query}" matters`,
          `What to look for when choosing ${biz.industry ?? "a provider"}`,
          `How ${biz.name} approaches this (your unique value)`,
          `Key factors: pricing, quality, experience, and reviews`,
          `Customer testimonials and case studies`,
          `FAQ section (3-5 common questions)`,
          `Call to action — contact ${biz.name}`,
        ];
      } else if (gap.contentType === "landing_page") {
        suggestedTitle = `${biz.name} — ${gap.query.replace(/best |top /gi, "")}`;
        wordCount = 800;
        outline = [
          `Hero section with headline and CTA`,
          `Services overview — what ${biz.name} offers`,
          `Why choose ${biz.name} (differentiators)`,
          `Pricing or "Get a Free Quote" section`,
          `Customer reviews and star ratings`,
          `Location and contact information`,
          `Schema markup: LocalBusiness + Service`,
        ];
      } else if (gap.contentType === "faq") {
        suggestedTitle = `Frequently Asked Questions — ${biz.name}`;
        wordCount = 600;
        outline = [
          `What services does ${biz.name} offer?`,
          `How much does ${gap.query.replace(/best |top /gi, "")} cost?`,
          `What areas does ${biz.name} serve?`,
          `What makes ${biz.name} different from competitors?`,
          `How can I get started / get a quote?`,
          `Add FAQPage schema markup for each Q&A pair`,
        ];
      } else if (gap.contentType === "schema_markup") {
        suggestedTitle = "Schema Markup Implementation";
        wordCount = 0;
        outline = [
          `Add LocalBusiness JSON-LD with name, address, phone, hours`,
          `Add AggregateRating with your current review score`,
          `Add Service schema for each service offered`,
          `Add FAQPage schema if you have FAQ content`,
          `Test with Google Rich Results Test tool`,
        ];
      } else {
        suggestedTitle = `${gap.query} — ${biz.name}`;
        wordCount = 800;
        outline = [
          `Introduction to the topic`,
          `How ${biz.name} addresses this`,
          `Key benefits and differentiators`,
          `Customer proof points`,
          `Call to action`,
        ];
      }

      return {
        gapId: gap.id,
        query: gap.query,
        category: gap.category,
        priority: gap.priority,
        contentType: gap.contentType,
        suggestedTitle,
        targetWordCount: wordCount,
        outline,
        seoTips: [
          `Include "${gap.query}" naturally in the title and first paragraph`,
          `Mention ${biz.name} and ${biz.location ?? "your location"} explicitly`,
          `Add internal links to related service pages`,
          `Include specific numbers, stats, and customer testimonials`,
          `Write in natural language that AI models can easily cite`,
        ],
      };
    });

    res.json({ drafts });
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

  // === WEBSITE SCRAPE → AUTO-FILL ===
  // Fetches a website, extracts text, and uses AI to parse business info
  app.post("/api/tools/scrape-website", async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required" });
    }

    // Normalize URL
    let fullUrl = url.trim();
    if (!fullUrl.startsWith("http")) fullUrl = "https://" + fullUrl;

    try {
      // 1. Fetch the webpage
      const pageRes = await fetch(fullUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0; +https://worthtracking.com)",
          "Accept": "text/html",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!pageRes.ok) {
        return res.status(400).json({ error: `Could not fetch website (HTTP ${pageRes.status})` });
      }
      const html = await pageRes.text();

      // 2. Extract meaningful text from HTML (strip tags, scripts, styles)
      const cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-zA-Z]+;/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000); // limit to ~6000 chars for the AI prompt

      if (cleaned.length < 50) {
        return res.status(400).json({ error: "Could not extract enough text from the website" });
      }

      // 3. Get an API key for analysis
      const keys = await storage.getApiKeys();
      const activeKeys = keys.filter((k) => k.isActive);
      if (activeKeys.length === 0) {
        return res.status(400).json({ error: "No API keys configured. Add one in Settings → API Keys first." });
      }

      // 4. Send to AI for extraction
      const prompt = `Analyze this website content and extract business information. Return ONLY valid JSON with these fields:
{
  "name": "Business name",
  "industry": "One of: Restaurant, Technology, Healthcare, Retail, Finance, Education, Real Estate, Legal, Marketing, Fitness, Beauty, Automotive, Construction, Consulting, Cleaning Services, Other",
  "description": "2-3 sentence business description",
  "location": "City, State or null if not found",
  "services": "comma-separated list of services/products offered",
  "keywords": "comma-separated search keywords relevant to this business",
  "targetAudience": "comma-separated target customer segments",
  "uniqueSellingPoints": "what makes this business unique/different",
  "competitors": "comma-separated list of 3-5 real LOCAL competitors within a 25-mile radius — must be actual businesses operating in the same geographic area and industry, NOT national chains or businesses in other cities"
}

Website URL: ${fullUrl}
Website content:
"""
${cleaned}
"""

Extract real information from the content. If a field isn't clear from the website, use your best judgment or leave it empty. For industry, pick the closest match from the list provided. For competitors, list REAL LOCAL businesses within 25 miles that compete with this company — they must physically operate in the same area. Do not list national chains unless they have a nearby location. Focus on the specific local market.`;

      // Try providers in cost order
      const priority = ["google", "openai", "anthropic", "perplexity"];
      const sortedKeys = [...activeKeys].sort((a, b) => {
        return priority.indexOf(a.provider) - priority.indexOf(b.provider);
      });

      let result: any = null;

      for (const key of sortedKeys) {
        try {
          let responseText = "";

          if (key.provider === "google") {
            const apiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key.apiKey}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: "You are a precise JSON extraction tool. Return only valid JSON, no markdown or explanation." }] },
                contents: [{ parts: [{ text: prompt }] }],
              }),
            });
            if (!apiRes.ok) continue;
            const data = await apiRes.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          } else if (key.provider === "openai") {
            const apiRes = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                max_completion_tokens: 1024,
                messages: [
                  { role: "system", content: "You are a precise JSON extraction tool. Return only valid JSON, no markdown or explanation." },
                  { role: "user", content: prompt },
                ],
              }),
            });
            if (!apiRes.ok) continue;
            const data = await apiRes.json();
            responseText = data.choices?.[0]?.message?.content ?? "";
          } else if (key.provider === "anthropic") {
            const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": key.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1024,
                system: "You are a precise JSON extraction tool. Return only valid JSON, no markdown or explanation.",
                messages: [{ role: "user", content: prompt }],
              }),
            });
            if (!apiRes.ok) continue;
            const data = await apiRes.json();
            responseText = Array.isArray(data.content)
              ? data.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
              : "";
          } else if (key.provider === "perplexity") {
            const apiRes = await fetch("https://api.perplexity.ai/chat/completions", {
              method: "POST",
              headers: { "Authorization": `Bearer ${key.apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "sonar",
                max_tokens: 1024,
                messages: [
                  { role: "system", content: "You are a precise JSON extraction tool. Return only valid JSON, no markdown or explanation." },
                  { role: "user", content: prompt },
                ],
              }),
            });
            if (!apiRes.ok) continue;
            const data = await apiRes.json();
            responseText = data.choices?.[0]?.message?.content ?? "";
          }

          // Parse the JSON response
          const jsonCleaned = responseText.replace(/```json?\s*/gi, "").replace(/```/g, "").trim();
          result = JSON.parse(jsonCleaned);
          break; // success, stop trying providers
        } catch (err: any) {
          console.error(`[Scrape] ${key.provider} failed:`, err.message);
          continue;
        }
      }

      if (!result) {
        return res.status(500).json({ error: "Could not analyze website content. Try again or fill in fields manually." });
      }

      // Track API cost
      const dateStr = new Date().toISOString().split("T")[0];
      db.insert(apiUsage).values({
        provider: sortedKeys[0]?.provider ?? "unknown",
        estimatedCost: "0.005",
        date: dateStr,
        timestamp: new Date().toISOString(),
      }).run();

      // If AI didn't return competitors, try dedicated competitor detection
      let competitorsStr = result.competitors || "";
      if (!competitorsStr && result.name && result.industry) {
        try {
          const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));
          const detected = await detectCompetitors(
            result.name,
            result.industry,
            result.location || null,
            keyInputs
          );
          if (detected.length > 0) {
            competitorsStr = detected.join(", ");
          }
        } catch (err: any) {
          console.error("[Scrape] Competitor detection failed:", err.message);
        }
      }

      res.json({
        name: result.name || "",
        industry: result.industry || "",
        description: result.description || "",
        location: result.location || "",
        website: fullUrl,
        services: result.services || "",
        keywords: result.keywords || "",
        targetAudience: result.targetAudience || result.target_audience || "",
        uniqueSellingPoints: result.uniqueSellingPoints || result.unique_selling_points || "",
        competitors: competitorsStr,
      });
    } catch (err: any) {
      console.error("[Scrape] Error:", err.message);
      if (err.name === "TimeoutError" || err.message?.includes("timeout")) {
        return res.status(400).json({ error: "Website took too long to respond. Check the URL and try again." });
      }
      res.status(500).json({ error: err.message || "Failed to scrape website" });
    }
  });

  // === AI VISIBILITY AUDIT — scrape website + analyze for AI signals ===
  app.get("/api/businesses/:id/visibility-audit", async (req, res) => {
    try {
      const businessId = parseInt(req.params.id);
      const biz = await storage.getBusiness(businessId);
      if (!biz) return res.status(404).json({ error: "Business not found" });

      const websiteUrl = biz.website;
      let websiteText = "";
      let scrapedPages: { url: string; text: string }[] = [];

      // 1. Scrape the website if available
      if (websiteUrl) {
        const pagesToScrape = [websiteUrl];
        // Try common subpages
        const baseUrl = websiteUrl.replace(/\/$/, "");
        for (const path of ["/about", "/services", "/contact", "/reviews"]) {
          pagesToScrape.push(baseUrl + path);
        }

        for (const pageUrl of pagesToScrape) {
          try {
            let fullUrl = pageUrl.trim();
            if (!fullUrl.startsWith("http")) fullUrl = "https://" + fullUrl;
            const pageRes = await fetch(fullUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0; +https://worthtracking.com)", Accept: "text/html" },
              signal: AbortSignal.timeout(8000),
              redirect: "follow",
            });
            if (pageRes.ok) {
              const html = await pageRes.text();
              const cleaned = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/&[a-zA-Z]+;/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              if (cleaned.length > 50) {
                scrapedPages.push({ url: fullUrl, text: cleaned.slice(0, 3000) });
                websiteText += " " + cleaned;
              }
            }
          } catch { /* skip failed pages */ }
        }
        websiteText = websiteText.slice(0, 12000);
      }

      const allText = `${biz.name} ${biz.industry || ""} ${biz.location || ""} ${(biz as any).services || ""} ${(biz as any).description || ""} ${websiteText}`.toLowerCase();
      const bizLocation = biz.location?.toLowerCase() || "";
      const bizName = biz.name.toLowerCase();

      // 2. Analyze signals from ALL data sources
      const categories: { name: string; score: number; tips: string[]; details: string }[] = [];

      // ── Local Signals ──
      const locationParts = bizLocation.split(",").map(s => s.trim()).filter(Boolean);
      const city = locationParts[0] || "";
      const state = locationParts[1] || "";
      let localScore = 0;
      const localTips: string[] = [];
      const localDetails: string[] = [];

      if (city && allText.includes(city)) { localScore += 20; localDetails.push(`✓ City "${city}" found`); }
      else if (city) { localTips.push(`Add your city "${city}" to your website content`); }

      if (state && allText.includes(state.toLowerCase())) { localScore += 10; localDetails.push(`✓ State found`); }

      if (/\d{5}/.test(allText)) { localScore += 15; localDetails.push("✓ Zip code found"); }
      else localTips.push("Add your zip code to your website");

      const localPhrases = ["located in", "based in", "serving", "near", "our location", "visit us", "come see us"];
      const localPhraseCount = localPhrases.filter(p => allText.includes(p)).length;
      localScore += Math.min(25, localPhraseCount * 8);
      if (localPhraseCount > 0) localDetails.push(`✓ ${localPhraseCount} location phrases found`);
      else localTips.push("Add location phrases like 'located in' or 'serving the [area] community'");

      if (allText.includes("google business") || allText.includes("google maps") || allText.includes("directions")) {
        localScore += 10; localDetails.push("✓ Google Business/Maps reference found");
      } else localTips.push("Reference Google Business Profile or add directions link");

      const hasAddress = /\d+\s+\w+\s+(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|way|ct|court|pl|place)/i.test(websiteText);
      if (hasAddress) { localScore += 20; localDetails.push("✓ Street address found on website"); }
      else localTips.push("Add your full street address to your website");

      localScore = Math.min(100, localScore);
      categories.push({ name: "Local Signals", score: localScore, tips: localTips, details: localDetails.join(", ") });

      // ── Review / Trust Signals ──
      let reviewScore = 0;
      const reviewTips: string[] = [];
      const reviewDetails: string[] = [];

      const trustWords = ["review", "testimonial", "rated", "stars", "customer", "feedback", "recommend", "trusted", "verified", "satisfaction", "guarantee", "award", "certified", "accredited", "bbb", "angi", "yelp", "google review"];
      const trustCount = trustWords.filter(w => allText.includes(w)).length;
      reviewScore += Math.min(50, trustCount * 8);
      if (trustCount > 0) reviewDetails.push(`✓ ${trustCount} trust signals found`);
      else reviewTips.push("Mention customer reviews and ratings on your website");

      if (/\d(\.\d)?\s*(star|\/\s*5|out of 5)/i.test(allText)) { reviewScore += 20; reviewDetails.push("✓ Star rating found"); }
      else reviewTips.push("Display your star rating (e.g., '4.8 stars on Google')");

      if (/\d+\s*(review|testimonial|\+?\s*customer)/i.test(allText)) { reviewScore += 15; reviewDetails.push("✓ Review count found"); }
      else reviewTips.push("Show review count (e.g., 'trusted by 200+ customers')");

      if (allText.includes("guarantee") || allText.includes("warranty") || allText.includes("satisfaction")) {
        reviewScore += 15; reviewDetails.push("✓ Guarantee/warranty mentioned");
      } else reviewTips.push("Add satisfaction guarantee or warranty information");

      reviewScore = Math.min(100, reviewScore);
      categories.push({ name: "Review & Trust Signals", score: reviewScore, tips: reviewTips, details: reviewDetails.join(", ") });

      // ── Schema / Structured Data ──
      let schemaScore = 0;
      const schemaTips: string[] = [];
      const schemaDetails: string[] = [];
      const rawHtml = scrapedPages.length > 0 ? scrapedPages.map(p => p.text).join(" ") : "";
      // Check original HTML for schema markup (before tag stripping)
      let fullHtml = "";
      if (websiteUrl) {
        try {
          let fullUrl = websiteUrl.trim();
          if (!fullUrl.startsWith("http")) fullUrl = "https://" + fullUrl;
          const r = await fetch(fullUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0)", Accept: "text/html" },
            signal: AbortSignal.timeout(8000),
          });
          if (r.ok) fullHtml = await r.text();
        } catch { /* skip */ }
      }

      if (fullHtml.includes("application/ld+json")) { schemaScore += 40; schemaDetails.push("✓ JSON-LD schema markup found"); }
      else schemaTips.push("Add JSON-LD schema markup (LocalBusiness type) to your website");

      if (fullHtml.includes("LocalBusiness") || fullHtml.includes("localbusiness")) { schemaScore += 20; schemaDetails.push("✓ LocalBusiness schema found"); }
      else if (schemaScore > 0) schemaTips.push("Add LocalBusiness schema type specifically");

      if (fullHtml.includes("AggregateRating") || fullHtml.includes("aggregaterating")) { schemaScore += 20; schemaDetails.push("✓ AggregateRating schema found"); }
      else schemaTips.push("Add AggregateRating schema to display review stars in search results");

      if (fullHtml.includes("FAQPage") || fullHtml.includes("faqpage")) { schemaScore += 10; schemaDetails.push("✓ FAQ schema found"); }
      else schemaTips.push("Add FAQ schema to help AI platforms find answers about your business");

      if (/<meta\s[^>]*description/i.test(fullHtml)) { schemaScore += 10; schemaDetails.push("✓ Meta description found"); }
      else schemaTips.push("Add a meta description tag to your homepage");

      schemaScore = Math.min(100, schemaScore);
      categories.push({ name: "Schema & Structured Data", score: schemaScore, tips: schemaTips, details: schemaDetails.join(", ") });

      // ── Content Quality ──
      let contentScore = 0;
      const contentTips: string[] = [];
      const contentDetails: string[] = [];

      const wordCount = websiteText.split(/\s+/).filter(Boolean).length;
      if (wordCount > 500) { contentScore += 25; contentDetails.push(`✓ Good content volume (${wordCount}+ words)`); }
      else if (wordCount > 200) { contentScore += 15; contentDetails.push(`Moderate content (${wordCount} words)`); contentTips.push("Add more detailed content — aim for 500+ words on key pages"); }
      else { contentTips.push("Your website needs more content. Add detailed service descriptions, about page, and FAQ"); }

      const services = ((biz as any).services || "").split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean);
      const servicesOnSite = services.filter((s: string) => allText.includes(s)).length;
      if (services.length > 0) {
        const serviceRate = servicesOnSite / services.length;
        contentScore += Math.round(serviceRate * 25);
        if (serviceRate >= 0.8) contentDetails.push(`✓ ${servicesOnSite}/${services.length} services mentioned on site`);
        else contentTips.push(`Only ${servicesOnSite}/${services.length} of your services are mentioned on your website. Add pages for: ${services.filter((s: string) => !allText.includes(s)).join(", ")}`);
      }

      if (allText.includes("faq") || allText.includes("frequently asked") || allText.includes("questions")) {
        contentScore += 15; contentDetails.push("✓ FAQ content found");
      } else contentTips.push("Add an FAQ page — AI platforms heavily cite FAQ content");

      if (allText.includes("blog") || allText.includes("article") || allText.includes("guide") || allText.includes("how to")) {
        contentScore += 15; contentDetails.push("✓ Blog/educational content found");
      } else contentTips.push("Start a blog with guides and tips — this builds AI authority");

      if (allText.includes("about") && (allText.includes("team") || allText.includes("founder") || allText.includes("experience") || allText.includes("years"))) {
        contentScore += 10; contentDetails.push("✓ About/team page found");
      } else contentTips.push("Add an 'About Us' page with team info and years of experience");

      const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(allText);
      const hasEmail = /@/.test(allText) && allText.includes(".");
      if (hasPhone) { contentScore += 5; contentDetails.push("✓ Phone number found"); } else contentTips.push("Add your phone number to the website");
      if (hasEmail) { contentScore += 5; contentDetails.push("✓ Email found"); }

      contentScore = Math.min(100, contentScore);
      categories.push({ name: "Content Quality", score: contentScore, tips: contentTips, details: contentDetails.join(", ") });

      // ── Competitive Edge ──
      let edgeScore = 0;
      const edgeTips: string[] = [];
      const edgeDetails: string[] = [];

      const edgeWords = ["only", "first", "exclusive", "patented", "proprietary", "award", "winning", "ranked", "leading", "pioneering", "innovative", "unique", "best"];
      const edgeCount = edgeWords.filter(w => allText.includes(w)).length;
      edgeScore += Math.min(40, edgeCount * 8);
      if (edgeCount > 0) edgeDetails.push(`✓ ${edgeCount} differentiator keywords found`);
      else edgeTips.push("Highlight what makes you unique — awards, patents, certifications, or 'only' claims");

      if (/\d+%|\d+\s*years|\d+\+|\d+\s*customers|\d+\s*projects|\d+\s*clients/i.test(allText)) {
        edgeScore += 20; edgeDetails.push("✓ Specific numbers/stats found");
      } else edgeTips.push("Include specific numbers (e.g., '10+ years', '500+ clients', '98% satisfaction rate')");

      if (allText.includes("free") && (allText.includes("quote") || allText.includes("estimate") || allText.includes("consultation"))) {
        edgeScore += 15; edgeDetails.push("✓ Free quote/estimate offer found");
      } else edgeTips.push("Add a 'free quote' or 'free consultation' offer — AI platforms favor businesses with clear CTAs");

      if (allText.includes("insured") || allText.includes("licensed") || allText.includes("bonded") || allText.includes("certified")) {
        edgeScore += 15; edgeDetails.push("✓ Licensing/insurance mentioned");
      } else edgeTips.push("Mention licensing, insurance, or certifications — these build AI trust signals");

      if (allText.includes("price") || allText.includes("cost") || allText.includes("pricing") || allText.includes("rate") || allText.includes("$")) {
        edgeScore += 10; edgeDetails.push("✓ Pricing information found");
      } else edgeTips.push("Add pricing info — AI platforms prefer businesses with transparent pricing");

      edgeScore = Math.min(100, edgeScore);
      categories.push({ name: "Competitive Edge", score: edgeScore, tips: edgeTips, details: edgeDetails.join(", ") });

      // ── AI Crawlability & Citability ──
      let crawlScore = 0;
      const crawlTips: string[] = [];
      const crawlDetails: string[] = [];

      // Check robots.txt for AI bot access
      if (websiteUrl) {
        try {
          let robotsUrl = websiteUrl.replace(/\/$/, "") + "/robots.txt";
          if (!robotsUrl.startsWith("http")) robotsUrl = "https://" + robotsUrl;
          const robotsRes = await fetch(robotsUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; WorthTracking/1.0)" },
            signal: AbortSignal.timeout(5000),
          });
          if (robotsRes.ok) {
            const robotsTxt = await robotsRes.text();
            const robotsLower = robotsTxt.toLowerCase();
            crawlScore += 10; crawlDetails.push("✓ robots.txt accessible");

            // Check if AI bots are blocked
            const aiBots = ["gptbot", "claudebot", "perplexitybot", "google-extended", "ccbot", "anthropic"];
            const blockedBots = aiBots.filter(bot => robotsLower.includes(`user-agent: ${bot}`) && robotsLower.includes("disallow: /"));
            if (blockedBots.length === 0) {
              crawlScore += 30; crawlDetails.push("✓ No AI bots blocked");
            } else {
              crawlTips.push(`Your robots.txt blocks these AI crawlers: ${blockedBots.join(", ")}. Consider allowing them to index your content.`);
            }

            // Check for sitemap reference
            if (robotsLower.includes("sitemap:")) {
              crawlScore += 15; crawlDetails.push("✓ Sitemap referenced in robots.txt");
            } else {
              crawlTips.push("Add a sitemap reference to your robots.txt");
            }
          } else {
            crawlTips.push("No robots.txt found — add one to guide AI crawlers");
          }
        } catch { crawlTips.push("Could not check robots.txt"); }
      }

      // Check if content is JS-heavy (bad for AI crawlers)
      if (fullHtml) {
        const scriptCount = (fullHtml.match(/<script/gi) || []).length;
        const bodyTextRatio = websiteText.length / Math.max(fullHtml.length, 1);
        if (bodyTextRatio > 0.15) {
          crawlScore += 15; crawlDetails.push("✓ Good text-to-HTML ratio");
        } else if (bodyTextRatio > 0.05) {
          crawlDetails.push("Moderate text-to-HTML ratio");
          crawlTips.push("Your site may be JS-heavy. Ensure key content is in server-rendered HTML, not loaded via JavaScript");
        } else {
          crawlTips.push("Very low text-to-HTML ratio — AI crawlers may not see your content. Use server-side rendering.");
        }

        // Check for conversational/citable content
        const sentences = websiteText.split(/[.!?]+/).filter(s => s.trim().length > 20);
        if (sentences.length >= 10) {
          crawlScore += 15; crawlDetails.push(`✓ ${sentences.length} citable sentences found`);
        } else {
          crawlTips.push("Add more complete sentences — AI models cite well-structured, factual statements");
        }

        // Check for statistics (numbers + context = highly citable)
        const statPatterns = /\d+%|\d+\s*(years?|clients?|customers?|projects?|locations?|employees?)/gi;
        const statsFound = websiteText.match(statPatterns)?.length ?? 0;
        if (statsFound >= 3) {
          crawlScore += 15; crawlDetails.push(`✓ ${statsFound} statistics/numbers found (highly citable)`);
        } else {
          crawlTips.push("Add specific statistics (e.g., '15 years experience', '500+ customers') — these are highly cited by AI");
        }
      }

      crawlScore = Math.min(100, crawlScore);
      categories.push({ name: "AI Crawlability", score: crawlScore, tips: crawlTips, details: crawlDetails.join(", ") });

      // 3. Get latest scan stats for context
      const stats = await storage.getSearchStats(businessId);

      const overallScore = Math.round(categories.reduce((sum, c) => sum + c.score, 0) / categories.length);

      res.json({
        businessName: biz.name,
        website: websiteUrl,
        pagesScraped: scrapedPages.length,
        pagesFound: scrapedPages.map(p => p.url),
        overallScore,
        categories,
        scanStats: stats ? {
          mentionRate: stats.mentionRate,
          avgPosition: stats.avgPosition,
          totalQueries: stats.totalQueries,
        } : null,
      });
    } catch (err: any) {
      console.error("[Visibility Audit] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
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

    // Auto-detect competitors if none exist
    const existingComps = await storage.getCompetitors(businessId);
    if (existingComps.length === 0) {
      try {
        const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));
        const knownCsv = (business as any).known_competitors ?? "";
        let compNames: string[] = [];
        if (knownCsv) {
          compNames = knownCsv.split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 1);
        }
        if (compNames.length === 0) {
          compNames = await detectCompetitors(business.name, business.industry, business.location ?? null, keyInputs);
        }
        if (compNames.length > 0) {
          const csv = compNames.join(", ");
          db.run(sql`UPDATE businesses SET known_competitors = ${csv} WHERE id = ${businessId}`);
          for (const name of compNames) {
            try {
              await storage.createCompetitor({ businessId, name, industry: business.industry });
            } catch (_e) { /* duplicate */ }
          }
          console.log(`[Scan] Detected competitors for "${business.name}": ${csv}`);
        }
      } catch (err: any) {
        console.error(`[Scan] Competitor detection failed:`, err.message);
      }
    }

    const ctx = toBizContext(await storage.getBusiness(businessId) ?? business);
    const queries = generateScanQueries(ctx);
    const extraTerms = buildExtraTerms(business);
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

    // Respond immediately so Railway's HTTP gateway doesn't time out.
    // The client polls /api/businesses/:id/scan-jobs for live progress.
    res.json({ jobId: job.id, status: "started", totalQueries, platforms: activeKeys.length });

    // Run the scan in the background (fire-and-forget).
    (async () => {
    const allPlatforms = await storage.getPlatforms();
    const platformMap = Object.fromEntries(allPlatforms.map((p) => [p.name, p.id]));

    let completed = 0;
    let mentionCount = 0;

    try {
      const keyInputs = activeKeys.map((k) => ({ provider: k.provider, apiKey: k.apiKey }));
      setAnalysisKeys(keyInputs);
      const manualScanDate = new Date().toISOString().split("T")[0];
      setHealthCallback((provider, status, responseTimeMs, errorMessage) => {
        db.insert(platformHealth).values({ provider, status, errorMessage: errorMessage ?? null, responseTimeMs, date: manualScanDate, timestamp: new Date().toISOString() }).run();
      });
      for await (const result of runScan(business.name, queries, keyInputs, extraTerms, { location: business.location ?? null, website: (business as any).website ?? null, services: (business as any).services ?? null, industry: business.industry ?? null })) {
        completed++;
        const platformId = platformMap[result.platform] ?? 1;
        const dateStr = new Date().toISOString().split("T")[0];

        const record = await storage.createSearchRecord({
          businessId,
          platformId,
          query: result.query,
          mentioned: result.mentioned ? 1 : 0,
          position: result.position,
          sentiment: result.sentiment,
          confidence: result.confidence,
          sourceType: result.sourceType,
          crossValidated: result.crossValidated === null ? null : result.crossValidated ? 1 : 0,
          date: dateStr,
        });
        db.run(sql`UPDATE search_records SET sentiment_score = ${(result as any).sentimentScore ?? 50}, sentiment_topic = ${(result as any).sentimentTopic ?? 'general'} WHERE id = ${record.id}`);

        // Extract citations — prefer structured citedUrls, fall back to regex
        const autoScanCitedUrls: string[] = (result as any).citedUrls ?? [];
        if (autoScanCitedUrls.length === 0 && result.responseText) {
          const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
          autoScanCitedUrls.push(...(result.responseText.match(urlRegex) || []));
        }
        const autoScanUniqueUrls = [...new Set(autoScanCitedUrls)];
        const autoScanBizDomain = business.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || "";
        for (const url of autoScanUniqueUrls.slice(0, 20)) {
          const domain = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
          const isOwn = autoScanBizDomain && domain.includes(autoScanBizDomain) ? 1 : 0;
          db.insert(citations).values({
            businessId,
            searchRecordId: record.id,
            url,
            domain,
            isOwnDomain: isOwn,
            platform: result.platform,
            query: result.query,
            date: dateStr,
          }).run();
        }

        // Track API cost — use real token-based cost from result, fall back to flat rate
        const providerKey = keyInputs.find(k => {
          const pMap: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };
          return pMap[k.provider] === result.platform;
        });
        if (providerKey) {
          const cost = (result as any).actualCost ?? (PROVIDER_COST_PER_CALL[providerKey.provider] ?? 0.005);
          db.insert(apiUsage).values({
            provider: providerKey.provider,
            estimatedCost: cost.toFixed(6),
            date: dateStr,
            timestamp: new Date().toISOString(),
          }).run();
        }

        if (result.mentioned) mentionCount++;

        const issues: string[] = [];
        if (result.confidence === "low") issues.push("Low confidence analysis");
        if (result.crossValidated === false) issues.push("Outlier: disagrees with other platforms");

        // Run hallucination + citation checks in parallel
        let hallucinationCount = 0;
        const checks: Promise<void>[] = [];

        if (result.mentioned && result.responseText) {
          checks.push(
            detectHallucinations(
              { name: business.name, location: business.location ?? null, website: business.website ?? null, services: (business as any).services ?? null },
              result.responseText,
              result.platform
            ).then(halCheck => {
              if (halCheck.hasHallucinations) {
                hallucinationCount = halCheck.issues.length;
                issues.push(...halCheck.issues.map(i => `Hallucination: ${i}`));
              }
            }).catch(err => console.error(`[Scan] Hallucination check failed:`, err.message))
          );
        }

        if (result.sourceType === "grounded" && result.mentioned) {
          checks.push(
            verifyCitations(result.responseText, business.name).then(citationResult => {
              if (citationResult.failed > 0) {
                issues.push(`Citation: ${citationResult.failed} of ${citationResult.verified + citationResult.failed} cited URLs are broken/invalid`);
              }
            }).catch(() => {})
          );
        }

        await Promise.all(checks);

        if (result.responseText) {
          await storage.createAiSnapshot({
            businessId,
            platformId,
            query: result.query,
            responseText: result.responseText,
            sentiment: result.sentiment,
            mentionedAccurate: result.mentioned ? 1 : 0,
            flaggedIssues: issues.length > 0 ? JSON.stringify(issues) : null,
            hallucinationCount,
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

      // ── Competitor scanning (same as auto-scan) ──────────────────────────
      const comps = await storage.getCompetitors(businessId);
      const compSubset = comps.slice(0, 5);
      const compQueries = queries.slice(0, 8);

      for (const comp of compSubset) {
        console.log(`[Scan] Scanning competitor "${comp.name}" for "${business.name}"`);
        try {
          for await (const result of runScan(comp.name, compQueries, keyInputs, [], { industry: business.industry ?? null, location: business.location ?? null, website: null, services: null })) {
            const platId = platformMap[result.platform] ?? 1;
            const dateStr = new Date().toISOString().split("T")[0];
            const compRecord = await storage.createSearchRecord({
              businessId,
              platformId: platId,
              query: result.query,
              mentioned: result.mentioned ? 1 : 0,
              position: result.position,
              sentiment: result.sentiment,
              confidence: result.confidence,
              sourceType: result.sourceType,
              crossValidated: result.crossValidated === null ? null : result.crossValidated ? 1 : 0,
              competitorId: comp.id,
              date: dateStr,
            });
            db.run(sql`UPDATE search_records SET sentiment_score = ${(result as any).sentimentScore ?? 50}, sentiment_topic = ${(result as any).sentimentTopic ?? 'general'} WHERE id = ${compRecord.id}`);

            // Extract citations — prefer structured citedUrls, fall back to regex
            const autoCompCitedUrls: string[] = (result as any).citedUrls ?? [];
            if (autoCompCitedUrls.length === 0 && result.responseText) {
              const urlRegex = /https?:\/\/[^\s\)\]"'<>,]+/g;
              autoCompCitedUrls.push(...(result.responseText.match(urlRegex) || []));
            }
            const autoCompUniqueUrls = [...new Set(autoCompCitedUrls)];
            const autoCompBizDomain = business.website?.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "") || "";
            for (const url of autoCompUniqueUrls.slice(0, 20)) {
              const domain = url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
              const isOwn = autoCompBizDomain && domain.includes(autoCompBizDomain) ? 1 : 0;
              db.insert(citations).values({
                businessId,
                searchRecordId: compRecord.id,
                url,
                domain,
                isOwnDomain: isOwn,
                platform: result.platform,
                query: result.query,
                date: dateStr,
              }).run();
            }
          }
        } catch (compErr: any) {
          console.error(`[Scan] Error scanning competitor "${comp.name}":`, compErr.message);
        }
      }

      // Generate alerts, prompts, content gaps, and GEO actions based on scan results
      await generateScanAlerts(businessId);
      await generateOptimizedPrompts(businessId);
      await generateContentGaps(businessId);
      await generateGeoActions(businessId);

      console.log(`[Scan] Completed "${business.name}": ${completed} queries, ${mentionCount} mentions`);
    } catch (err: any) {
      await storage.updateScanJob(job.id, {
        status: "failed",
        error: err.message,
        completedAt: new Date().toISOString(),
      });
      console.error(`[Scan] Background scan failed for "${business.name}":`, err.message);
    }
    })(); // end background IIFE
  });

  app.get("/api/businesses/:id/scan-jobs", async (req, res) => {
    const id = parseInt(req.params.id);
    const jobs = await storage.getScanJobs(id);
    // Auto-expire running jobs older than 10 minutes
    const now = Date.now();
    for (const j of jobs) {
      if (j.status === "running" && j.startedAt) {
        const elapsed = now - new Date(j.startedAt).getTime();
        if (elapsed > 10 * 60 * 1000) {
          await storage.updateScanJob(j.id, { status: "failed", error: "Scan timed out after 10 minutes", completedAt: new Date().toISOString() });
          j.status = "failed";
          j.error = "Scan timed out after 10 minutes";
        }
      }
    }
    res.json(jobs);
  });

  // Cancel a stuck scan job
  app.post("/api/businesses/:id/cancel-scan", async (req, res) => {
    const id = parseInt(req.params.id);
    const jobs = await storage.getScanJobs(id);
    const running = jobs.find(j => j.status === "running");
    if (!running) return res.json({ message: "No running scan to cancel" });
    await storage.updateScanJob(running.id, { status: "failed", error: "Cancelled by user", completedAt: new Date().toISOString() });
    res.json({ message: "Scan cancelled", jobId: running.id });
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

  // === PLATFORM HEALTH ===
  app.get("/api/platform-health", async (_req, res) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const stats = db.select({
      provider: platformHealth.provider,
      successCount: sql<number>`sum(case when status = 'success' then 1 else 0 end)`,
      errorCount: sql<number>`sum(case when status = 'error' then 1 else 0 end)`,
      avgResponseTime: sql<number>`avg(response_time_ms)`,
    })
      .from(platformHealth)
      .where(sql`date >= ${sevenDaysAgo}`)
      .groupBy(platformHealth.provider)
      .all();

    res.json(stats.map(s => ({
      ...s,
      successRate: s.successCount + s.errorCount > 0
        ? Math.round((s.successCount / (s.successCount + s.errorCount)) * 100)
        : 0,
      avgResponseTime: Math.round(s.avgResponseTime ?? 0),
    })));
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

  // === CLICK TRACKING (from embedded snippet) ===

  // POST /api/businesses/:id/log-click — receives click data from the embedded JS snippet.
  // This endpoint is intentionally open to cross-origin requests so the snippet can POST
  // from any website. Business ID validation acts as the auth gate.
  app.post("/api/businesses/:id/log-click", async (req, res) => {
    // Allow cross-origin requests from any website (snippet is embedded externally)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const businessId = parseInt(req.params.id);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid business ID" });

    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const {
      elementText,
      elementUrl,
      referrer,
      landingPage,
      utmSource,
      utmMedium,
      utmCampaign,
      deviceType,
      timestamp,
    } = req.body;

    const ts = timestamp || new Date().toISOString();

    // Dedup: reject clicks that look like duplicates within a 30-second window.
    // Same business + landing page + referrer within 30s = double-click or bot replay.
    const thirtySecsAgo = new Date(Date.now() - 30_000).toISOString();
    const recentDuplicate = db.select({ id: clickEvents.id })
      .from(clickEvents)
      .where(sql`business_id = ${businessId}
        AND landing_page IS ${landingPage || null}
        AND referrer IS ${referrer || null}
        AND timestamp > ${thirtySecsAgo}`)
      .get();

    if (recentDuplicate) {
      console.log(`[Click] Duplicate suppressed (businessId:${businessId}, within 30s, original id:${recentDuplicate.id})`);
      return res.json({ success: true, clickId: recentDuplicate.id, deduplicated: true });
    }

    // Store raw click event
    const clickEvent = db.insert(clickEvents).values({
      businessId,
      elementText: elementText || null,
      elementUrl: elementUrl || null,
      referrer: referrer || null,
      landingPage: landingPage || null,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      deviceType: deviceType || "desktop",
      timestamp: ts,
    }).returning().get();

    // Create a referral entry so the click shows up in the referrals dashboard.
    // Match platform from utmSource first, then fall back to matching by referrer domain.
    // If we can't determine the platform at all, skip the referral (no false attribution).
    const allPlatforms = await storage.getPlatforms();

    // Domain → platform name mapping for referrer-based fallback
    const REFERRER_DOMAIN_MAP: Record<string, string> = {
      "chatgpt.com": "ChatGPT", "chat.openai.com": "ChatGPT",
      "perplexity.ai": "Perplexity",
      "gemini.google.com": "Google Gemini", "bard.google.com": "Google Gemini",
      "claude.ai": "Claude",
      "copilot.microsoft.com": "Copilot", "bing.com": "Copilot",
      "meta.ai": "Meta AI",
    };

    let matchedPlatform = allPlatforms.find(
      (p) => p.name.toLowerCase().replace(/\s+/g, "-") === (utmSource || "").toLowerCase()
        || p.name.toLowerCase() === (utmSource || "").toLowerCase()
    );

    // Try referrer domain if utmSource didn't match
    if (!matchedPlatform && referrer) {
      const refLower = referrer.toLowerCase();
      const domainMatch = Object.entries(REFERRER_DOMAIN_MAP).find(([domain]) => refLower.includes(domain));
      if (domainMatch) {
        const platformName = domainMatch[1];
        matchedPlatform = allPlatforms.find(p => p.name === platformName);
      }
    }

    if (matchedPlatform) {
      const dateStr = ts.split("T")[0] || new Date().toISOString().split("T")[0];
      await storage.createReferral({
        businessId,
        platformId: matchedPlatform.id,
        searchRecordId: null,
        query: `[snippet-click] ${elementText || elementUrl || "unknown"}`,
        landingPage: landingPage || "/",
        utmSource: utmSource || null,
        utmMedium: utmMedium || null,
        utmCampaign: utmCampaign || null,
        converted: 0,
        conversionType: null,
        sessionDuration: null,
        pagesViewed: 1,
        deviceType: deviceType || "desktop",
        date: dateStr,
        timestamp: ts,
      });
    } else {
      console.log(`[Click] Could not attribute platform for businessId:${businessId} utmSource:"${utmSource}" referrer:"${referrer}" — referral record skipped`);
    }

    res.json({ success: true, clickId: clickEvent.id });
  });

  // Handle CORS preflight for log-click
  app.options("/api/businesses/:id/log-click", (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(204);
  });

  // GET /api/businesses/:id/snippet — returns the embeddable JS snippet
  app.get("/api/businesses/:id/snippet", async (req, res) => {
    const businessId = parseInt(req.params.id);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid business ID" });

    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const host = req.headers.host || "your-app.railway.app";
    const protocol = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
    const apiUrl = `${protocol}://${host}/api/businesses/${businessId}/log-click`;

    const snippet = `<!-- Worth Tracking Click Tracker v1.0 -->
<!-- Tracks clicks from AI search platforms (ChatGPT, Perplexity, Gemini, etc.) -->
<!-- No personal data collected. Respects Do Not Track. -->
<script>
(function() {
  'use strict';

  // Respect Do Not Track
  if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  var BUSINESS_ID = '${businessId}';
  var API_URL = '${apiUrl}';

  // AI search platform referrer patterns
  var AI_REFERRERS = [
    'chatgpt.com', 'chat.openai.com',
    'perplexity.ai',
    'gemini.google.com', 'bard.google.com',
    'claude.ai',
    'copilot.microsoft.com', 'bing.com/chat',
    'meta.ai', 'llama',
    'you.com', 'phind.com', 'kagi.com',
  ];

  function isAiReferrer(ref) {
    if (!ref) return false;
    var lower = ref.toLowerCase();
    for (var i = 0; i < AI_REFERRERS.length; i++) {
      if (lower.indexOf(AI_REFERRERS[i]) !== -1) return true;
    }
    return false;
  }

  function getDeviceType() {
    var ua = navigator.userAgent;
    if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
    if (/mobile|iphone|ipod|android|blackberry|mini|windows\\sce|palm/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  function getUtmParam(name) {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get(name) || '';
    } catch (e) { return ''; }
  }

  function getElementText(el) {
    var text = (el.innerText || el.textContent || el.value || el.alt || el.title || '').trim();
    return text.slice(0, 200);
  }

  function getElementUrl(el) {
    return el.href || el.action || el.dataset.href || '';
  }

  function sendClick(data) {
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        navigator.sendBeacon(API_URL, blob);
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API_URL, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(data));
      }
    } catch (e) { /* silent fail */ }
  }

  function handleClick(e) {
    try {
      var el = e.target;
      // Walk up to find the nearest link or button
      var depth = 0;
      while (el && el !== document.body && depth < 5) {
        if (el.tagName === 'A' || el.tagName === 'BUTTON' || el.role === 'button') break;
        el = el.parentElement;
        depth++;
      }
      if (!el || el === document.body) return;

      var referrer = document.referrer;
      var utmSource = getUtmParam('utm_source');

      // Only track if visitor came from an AI platform (via referrer or UTM)
      if (!isAiReferrer(referrer) && !isAiReferrer(utmSource)) return;

      sendClick({
        elementText: getElementText(el),
        elementUrl: getElementUrl(el),
        referrer: referrer,
        landingPage: window.location.pathname,
        utmSource: utmSource || referrer.split('/')[2] || '',
        utmMedium: getUtmParam('utm_medium') || 'ai-search',
        utmCampaign: getUtmParam('utm_campaign') || 'worth-tracking',
        deviceType: getDeviceType(),
        timestamp: new Date().toISOString(),
      });
    } catch (e) { /* silent fail */ }
  }

  // Attach listener after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      document.addEventListener('click', handleClick, true);
    });
  } else {
    document.addEventListener('click', handleClick, true);
  }
})();
</script>`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(snippet);
  });

  // GET /api/businesses/:id/snippet-status — click stats for the last 7 days
  app.get("/api/businesses/:id/snippet-status", async (req, res) => {
    const businessId = parseInt(req.params.id);
    if (isNaN(businessId)) return res.status(400).json({ error: "Invalid business ID" });

    const business = await storage.getBusiness(businessId);
    if (!business) return res.status(404).json({ error: "Business not found" });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const recentClicks = db.select().from(clickEvents)
      .where(sql`business_id = ${businessId} AND timestamp >= ${sevenDaysAgo}`)
      .all();

    const totalClicks = db.select({ count: sql<number>`count(*)` })
      .from(clickEvents)
      .where(sql`business_id = ${businessId}`)
      .get();

    const bySource: Record<string, number> = {};
    for (const c of recentClicks) {
      const src = c.utmSource || "direct";
      bySource[src] = (bySource[src] || 0) + 1;
    }

    const lastClick = db.select().from(clickEvents)
      .where(sql`business_id = ${businessId}`)
      .orderBy(sql`timestamp desc`)
      .limit(1)
      .get();

    res.json({
      businessId,
      active: (totalClicks?.count ?? 0) > 0,
      clicksLast7Days: recentClicks.length,
      totalClicks: totalClicks?.count ?? 0,
      bySource,
      lastClickAt: lastClick?.timestamp ?? null,
    });
  });

  // POST /api/businesses/:id/schema-recommendations — generate structured data recommendations
  app.post("/api/businesses/:id/schema-recommendations", async (req, res) => {
    const businessId = parseInt(req.params.id);
    const biz = await storage.getBusiness(businessId);
    if (!biz) return res.status(404).json({ message: "Business not found" });

    const industryTypeMap: Record<string, string> = {
      restaurant: "Restaurant",
      healthcare: "MedicalBusiness",
      legal: "LegalService",
      "real estate": "RealEstateAgent",
      fitness: "HealthClub",
      beauty: "BeautySalon",
      automotive: "AutoRepair",
    };

    const industry = (biz.industry || "").toLowerCase();
    const schemaOrgType = industryTypeMap[industry] || "LocalBusiness";

    const name = biz.name || "Your Business";
    const description = biz.description || `${name} — a trusted ${biz.industry || "local"} business.`;
    const website = biz.website || "https://www.example.com";
    const location = biz.location || "";
    const services = (biz as any).services || "";
    const targetAudience = (biz as any).targetAudience || (biz as any).target_audience || "";
    const uniqueSellingPoints = (biz as any).uniqueSellingPoints || (biz as any).unique_selling_points || "";

    const recommendations: any[] = [];

    // 1. LocalBusiness (always, high priority)
    const localBusinessSchema = {
      "@context": "https://schema.org",
      "@type": schemaOrgType,
      name,
      description,
      url: website,
      ...(location ? { address: { "@type": "PostalAddress", streetAddress: location } } : {}),
      ...(services ? { makesOffer: services.split(",").map((s: string) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name: s.trim() } })) } : {}),
    };
    recommendations.push({
      schemaType: "LocalBusiness",
      description: `Helps AI assistants find and recommend your business for local searches. Uses the specific schema.org type "${schemaOrgType}" based on your industry.`,
      priority: "high",
      code: `<script type="application/ld+json">\n${JSON.stringify(localBusinessSchema, null, 2)}\n</script>`,
      implemented: false,
    });

    // 2. Organization (always, high priority)
    const orgSchema = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name,
      url: website,
      description,
      ...(location ? { address: { "@type": "PostalAddress", streetAddress: location } } : {}),
    };
    recommendations.push({
      schemaType: "Organization",
      description: "Establishes your brand identity for AI systems and knowledge graphs. This helps AI assistants confidently reference your organization.",
      priority: "high",
      code: `<script type="application/ld+json">\n${JSON.stringify(orgSchema, null, 2)}\n</script>`,
      implemented: false,
    });

    // 3. Service (if services exist, one per service)
    if (services) {
      const serviceList = services.split(",").map((s: string) => s.trim()).filter(Boolean);
      for (const svc of serviceList) {
        const svcSchema = {
          "@context": "https://schema.org",
          "@type": "Service",
          name: svc,
          provider: { "@type": "Organization", name },
          ...(location ? { areaServed: location } : {}),
          ...(description ? { description: `${svc} provided by ${name}.` } : {}),
        };
        recommendations.push({
          schemaType: "Service",
          description: `Helps AI assistants understand and recommend your "${svc}" service when users ask about it.`,
          priority: "high",
          code: `<script type="application/ld+json">\n${JSON.stringify(svcSchema, null, 2)}\n</script>`,
          implemented: false,
        });
      }
    }

    // 4. FAQ (always recommend, medium priority)
    const faqSchema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `What services does ${name} offer?`,
          acceptedAnswer: { "@type": "Answer", text: services || `${name} offers a range of professional ${biz.industry || ""} services. Visit ${website} for details.` },
        },
        {
          "@type": "Question",
          name: `Where is ${name} located?`,
          acceptedAnswer: { "@type": "Answer", text: location || `Visit ${website} for location and contact information.` },
        },
        {
          "@type": "Question",
          name: `Why choose ${name}?`,
          acceptedAnswer: { "@type": "Answer", text: uniqueSellingPoints || `${name} is a trusted ${biz.industry || "local"} business committed to quality service.` },
        },
      ],
    };
    recommendations.push({
      schemaType: "FAQ",
      description: "FAQ schema makes your answers directly quotable by AI assistants. Create a dedicated FAQ page and add this markup.",
      priority: "medium",
      code: `<script type="application/ld+json">\n${JSON.stringify(faqSchema, null, 2)}\n</script>`,
      implemented: false,
    });

    // 5. AggregateRating / Review (always recommend, medium priority)
    const reviewSchema = {
      "@context": "https://schema.org",
      "@type": schemaOrgType,
      name,
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue: "4.8",
        reviewCount: "50",
        bestRating: "5",
      },
    };
    recommendations.push({
      schemaType: "Review",
      description: "Aggregate rating schema helps AI assistants highlight your star ratings and review count, boosting trust signals.",
      priority: "medium",
      code: `<script type="application/ld+json">\n${JSON.stringify(reviewSchema, null, 2)}\n</script>\n\n<!-- NOTE: Replace ratingValue and reviewCount with your actual values -->`,
      implemented: false,
    });

    // 6. BreadcrumbList (always, low priority)
    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: website },
        { "@type": "ListItem", position: 2, name: "Services", item: `${website}/services` },
        { "@type": "ListItem", position: 3, name: "About", item: `${website}/about` },
      ],
    };
    recommendations.push({
      schemaType: "BreadcrumbList",
      description: "Helps AI crawlers understand your site structure and navigate between pages, improving overall discoverability.",
      priority: "low",
      code: `<script type="application/ld+json">\n${JSON.stringify(breadcrumbSchema, null, 2)}\n</script>`,
      implemented: false,
    });

    res.json({ recommendations });
  });

  // Start nightly 2 AM scan scheduler
  startNightlyScheduler();

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
