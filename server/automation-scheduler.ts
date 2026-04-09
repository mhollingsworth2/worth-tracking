/**
 * Automation Scheduler — runs recurring background tasks for all businesses.
 *
 * Controlled by environment variables:
 *   AUTOMATION_ENABLED          (default: "true")
 *   AUTOMATION_NEWS_INTERVAL    (default: "daily")
 *   AUTOMATION_GA4_INTERVAL     (default: "daily")
 *   AUTOMATION_PRICING_INTERVAL (default: "weekly")
 *
 * All tasks are fire-and-forget; failures are logged but never crash the app.
 */

import { db } from "./storage";
import { automationJobs, automationSettings, businesses } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { scrapeWebsite } from "./website-scraper";
import { discoverCompetitors } from "./competitor-discovery";
import { monitorNews } from "./news-monitor";
import { fetchGA4Data } from "./ga4-integration";
import { monitorCompetitorPricing } from "./pricing-monitor";
import { storage } from "./storage";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isEnabled(): boolean {
  const val = process.env.AUTOMATION_ENABLED ?? "true";
  return val.toLowerCase() !== "false" && val !== "0";
}

function getInterval(envVar: string, defaultVal: "daily" | "weekly" | "monthly"): string {
  return process.env[envVar] ?? defaultVal;
}

function intervalToMs(interval: string): number {
  switch (interval) {
    case "hourly":  return 60 * 60 * 1000;
    case "daily":   return 24 * 60 * 60 * 1000;
    case "weekly":  return 7 * 24 * 60 * 60 * 1000;
    case "monthly": return 30 * 24 * 60 * 60 * 1000;
    default:        return 24 * 60 * 60 * 1000;
  }
}

async function upsertJob(
  businessId: number,
  jobType: string,
  status: "running" | "completed" | "failed",
  errorMessage?: string
): Promise<void> {
  const now = new Date().toISOString();
  const existing = db
    .select()
    .from(automationJobs)
    .where(
      sql`${automationJobs.businessId} = ${businessId} AND ${automationJobs.jobType} = ${jobType}`
    )
    .get();

  if (existing) {
    db.update(automationJobs)
      .set({ status, lastRun: now, errorMessage: errorMessage ?? null })
      .where(eq(automationJobs.id, existing.id))
      .run();
  } else {
    db.insert(automationJobs)
      .values({ businessId, jobType, status, lastRun: now })
      .run();
  }
}

function getSettings(businessId: number) {
  return db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.businessId, businessId))
    .get();
}

// ── Per-business task runners ─────────────────────────────────────────────────

async function runWebsiteScrape(biz: { id: number; name: string; website: string | null }) {
  if (!biz.website) return;
  const settings = getSettings(biz.id);
  if (settings && !settings.scraperEnabled) return;

  await upsertJob(biz.id, "scrape_website", "running");
  try {
    await scrapeWebsite(biz.website);
    db.update(businesses)
      .set({ websiteLastScraped: new Date().toISOString() })
      .where(eq(businesses.id, biz.id))
      .run();
    await upsertJob(biz.id, "scrape_website", "completed");
    console.log(`[Automation] Website scraped for "${biz.name}"`);
  } catch (err: any) {
    await upsertJob(biz.id, "scrape_website", "failed", err.message);
    console.warn(`[Automation] Website scrape failed for "${biz.name}":`, err.message);
  }
}

async function runCompetitorDiscovery(biz: {
  id: number;
  name: string;
  industry: string;
  location: string | null;
}) {
  const settings = getSettings(biz.id);
  if (settings && !settings.competitorDiscoveryEnabled) return;

  await upsertJob(biz.id, "discover_competitors", "running");
  try {
    const result = await discoverCompetitors(
      biz.name,
      biz.industry,
      biz.location ?? "",
    );

    if (result.error) {
      await upsertJob(biz.id, "discover_competitors", "failed", result.error);
      return;
    }

    // Persist new competitors (avoid duplicates by website domain)
    const existing = await storage.getCompetitors(biz.id);
    const existingDomains = new Set(
      existing.map((c) => {
        try { return new URL(c.website ?? "").hostname.replace(/^www\./, ""); }
        catch { return c.website ?? ""; }
      })
    );

    for (const comp of result.competitors) {
      let domain = "";
      try { domain = new URL(comp.website).hostname.replace(/^www\./, ""); }
      catch { domain = comp.website; }

      if (!existingDomains.has(domain)) {
        await storage.createCompetitor({
          businessId: biz.id,
          name: comp.name,
          website: comp.website,
          notes: comp.snippet,
        });
        existingDomains.add(domain);
      }
    }

    db.update(businesses)
      .set({ competitorsLastDiscovered: new Date().toISOString() })
      .where(eq(businesses.id, biz.id))
      .run();

    await upsertJob(biz.id, "discover_competitors", "completed");
    console.log(
      `[Automation] Competitor discovery done for "${biz.name}": ${result.competitors.length} found`
    );
  } catch (err: any) {
    await upsertJob(biz.id, "discover_competitors", "failed", err.message);
    console.warn(`[Automation] Competitor discovery failed for "${biz.name}":`, err.message);
  }
}

async function runNewsMonitor(biz: { id: number; name: string; industry: string }) {
  const settings = getSettings(biz.id);
  if (settings && !settings.newsEnabled) return;

  await upsertJob(biz.id, "news_monitor", "running");
  try {
    const result = await monitorNews(biz.name, biz.industry);

    if (result.error) {
      await upsertJob(biz.id, "news_monitor", "failed", result.error);
      return;
    }

    // Create an alert for each news item found
    const today = new Date().toISOString().split("T")[0];
    for (const item of result.items) {
      await storage.createAlert({
        businessId: biz.id,
        type: "news_mention",
        message: `News: "${item.title}" — ${item.source} (${item.publishedAt.slice(0, 10)})`,
        severity: "info",
        date: today,
      });
    }

    await upsertJob(biz.id, "news_monitor", "completed");
    console.log(
      `[Automation] News monitor done for "${biz.name}": ${result.items.length} items`
    );
  } catch (err: any) {
    await upsertJob(biz.id, "news_monitor", "failed", err.message);
    console.warn(`[Automation] News monitor failed for "${biz.name}":`, err.message);
  }
}

async function runGA4Sync(biz: { id: number; name: string }) {
  const settings = getSettings(biz.id);
  if (!settings?.ga4PropertyId || !settings?.ga4ApiKey) return;

  await upsertJob(biz.id, "ga4_sync", "running");
  try {
    const result = await fetchGA4Data(
      settings.ga4PropertyId,
      settings.ga4ApiKey,
      "30d"
    );

    if (result.error) {
      await upsertJob(biz.id, "ga4_sync", "failed", result.error);
      return;
    }

    await upsertJob(biz.id, "ga4_sync", "completed");
    console.log(
      `[Automation] GA4 sync done for "${biz.name}": ${result.rows.length} rows`
    );
  } catch (err: any) {
    await upsertJob(biz.id, "ga4_sync", "failed", err.message);
    console.warn(`[Automation] GA4 sync failed for "${biz.name}":`, err.message);
  }
}

async function runPricingMonitor(biz: { id: number; name: string }) {
  const settings = getSettings(biz.id);
  if (settings && !settings.pricingEnabled) return;

  await upsertJob(biz.id, "pricing_monitor", "running");
  try {
    const comps = await storage.getCompetitors(biz.id);
    const withWebsites = comps.filter((c) => c.website);
    if (withWebsites.length === 0) {
      await upsertJob(biz.id, "pricing_monitor", "completed");
      return;
    }

    await monitorCompetitorPricing(
      withWebsites.map((c) => ({ name: c.name, website: c.website! }))
    );

    await upsertJob(biz.id, "pricing_monitor", "completed");
    console.log(`[Automation] Pricing monitor done for "${biz.name}"`);
  } catch (err: any) {
    await upsertJob(biz.id, "pricing_monitor", "failed", err.message);
    console.warn(`[Automation] Pricing monitor failed for "${biz.name}":`, err.message);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let schedulerStarted = false;

export function startAutomationScheduler(): void {
  if (!isEnabled()) {
    console.log("[Automation] Scheduler disabled via AUTOMATION_ENABLED=false");
    return;
  }
  if (schedulerStarted) return;
  schedulerStarted = true;

  const newsInterval    = getInterval("AUTOMATION_NEWS_INTERVAL",    "daily");
  const ga4Interval     = getInterval("AUTOMATION_GA4_INTERVAL",     "daily");
  const pricingInterval = getInterval("AUTOMATION_PRICING_INTERVAL", "weekly");

  console.log(
    `[Automation] Scheduler started — news:${newsInterval} ga4:${ga4Interval} pricing:${pricingInterval}`
  );

  // Daily: news + GA4
  setInterval(async () => {
    const allBiz = await storage.getBusinesses();
    for (const biz of allBiz) {
      await runNewsMonitor(biz);
      await runGA4Sync(biz);
    }
  }, intervalToMs(newsInterval));

  // Weekly: website re-scrape + competitor discovery
  setInterval(async () => {
    const allBiz = await storage.getBusinesses();
    for (const biz of allBiz) {
      await runWebsiteScrape(biz);
      await runCompetitorDiscovery(biz);
    }
  }, intervalToMs("weekly"));

  // Pricing interval (configurable, default weekly)
  setInterval(async () => {
    const allBiz = await storage.getBusinesses();
    for (const biz of allBiz) {
      await runPricingMonitor(biz);
    }
  }, intervalToMs(pricingInterval));
}

// Export individual runners so API endpoints can trigger them on-demand
export {
  runWebsiteScrape,
  runCompetitorDiscovery,
  runNewsMonitor,
  runGA4Sync,
  runPricingMonitor,
};
