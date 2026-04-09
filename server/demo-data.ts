/**
 * Demo Data Generator
 * Creates a realistic sample business with populated data across all features
 * so clients can see the full app experience without needing API keys.
 */

import { db } from "./storage";
import {
  businesses, platforms, searchRecords, optimizedPrompts, referrals,
  competitors, aiSnapshots, alerts, contentGaps, locations,
  scanJobs, userBusinesses,
} from "@shared/schema";
import { sql, eq } from "drizzle-orm";

const DEMO_BUSINESS_NAME = "Sunrise Dental Care";
const DEMO_MARKER = "[DEMO]"; // tag in description to identify demo data

// ── Helpers ──────────────────────────────────────────────────────────────────
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function isoAgo(n: number, hour?: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  if (hour !== undefined) d.setHours(hour, randomInt(0, 59), randomInt(0, 59));
  return d.toISOString();
}

// ── Demo queries (realistic dental/healthcare queries) ───────────────────────
const DEMO_QUERIES = [
  "best dentist near me",
  "top rated dental clinic in Austin",
  "affordable dental care Austin TX",
  "family dentist recommendations",
  "emergency dentist open now Austin",
  "teeth whitening services near me",
  "best dental implant provider Austin",
  "pediatric dentist recommendations Austin",
  "Invisalign provider near Austin TX",
  "root canal specialist Austin",
  "dental cleaning and checkup Austin",
  "cosmetic dentistry Austin reviews",
  "Sunrise Dental Care reviews",
  "Is Sunrise Dental Care worth it?",
  "dentist with Saturday hours Austin",
  "dental insurance accepted Austin TX",
  "best dentist for anxious patients",
  "same day dental crown Austin",
  "holistic dentist Austin TX",
  "Compare Austin dental clinics",
  "Sunrise Dental Care vs Bright Smiles",
  "dental veneers cost Austin",
  "wisdom teeth removal Austin TX",
  "best teeth cleaning service 2026",
];

const DEMO_PLATFORMS = ["ChatGPT", "Perplexity", "Google Gemini", "Claude"];

const DEMO_COMPETITORS = [
  { name: "Bright Smiles Dental", website: "https://brightsmilesdental.com", notes: "Major local competitor, strong Google presence" },
  { name: "Austin Family Dentistry", website: "https://austinfamilydentistry.com", notes: "Established practice, multiple locations" },
  { name: "ClearView Dental", website: "https://clearviewdental.com", notes: "Focus on cosmetic dentistry" },
  { name: "Lone Star Dental Group", website: "https://lonestardental.com", notes: "Large group practice, insurance-friendly" },
  { name: "Hill Country Smiles", website: "https://hillcountrysmiles.com", notes: "Newer practice, growing fast on social media" },
];

const DEMO_PROMPTS = [
  { prompt: "What's the best dentist in Austin for families?", category: "discovery", score: 85, tip: "This query triggers family-focused recommendations. Ensure your website prominently features family dentistry services and patient testimonials from families." },
  { prompt: "Compare dental clinics in Austin TX", category: "comparison", score: 72, tip: "Comparison queries look for differentiators. Highlight unique services like same-day crowns, extended hours, or sedation dentistry on your site." },
  { prompt: "Sunrise Dental Care reviews and ratings", category: "recommendation", score: 91, tip: "Brand queries show strong awareness. Maintain positive reviews on Google and Yelp to reinforce what AI models surface." },
  { prompt: "affordable teeth whitening near me", category: "local", score: 68, tip: "Price-sensitive queries benefit from transparent pricing pages. Consider adding a 'Pricing' section to help AI cite specific costs." },
  { prompt: "emergency dental care open weekends Austin", category: "discovery", score: 77, tip: "Urgency queries favor businesses with clear hours. Add structured data (schema.org) for your business hours including weekends." },
];

const DEMO_CONTENT_GAPS = [
  { query: "sedation dentistry Austin", category: "Service Page", currentlyRanking: 0, recommendedContent: "Create a dedicated sedation dentistry page with patient FAQs, types of sedation offered, and insurance coverage details.", contentType: "Landing Page", priority: "high" },
  { query: "dental implants cost guide", category: "Educational", currentlyRanking: 0, recommendedContent: "Publish a comprehensive dental implant cost guide covering types, financing options, and insurance. AI models love citing detailed cost breakdowns.", contentType: "Blog Post", priority: "high" },
  { query: "kids first dental visit tips", category: "Educational", currentlyRanking: 0, recommendedContent: "Write a parent's guide to first dental visits. This captures top-of-funnel traffic that AI chatbots frequently answer.", contentType: "Blog Post", priority: "medium" },
  { query: "Invisalign vs braces for adults", category: "Comparison", currentlyRanking: 0, recommendedContent: "Create a comparison page. AI models frequently cite pros/cons tables for these queries.", contentType: "Landing Page", priority: "medium" },
  { query: "dental anxiety tips", category: "Trust Building", currentlyRanking: 1, recommendedContent: "Expand your existing content with patient video testimonials about overcoming dental anxiety at your practice.", contentType: "Video + Blog", priority: "low" },
];

const DEMO_ALERTS = [
  { type: "mention_spike", message: "Mention rate increased 23% this week across Perplexity and Gemini — your Google Business Profile updates may be driving this.", severity: "info" },
  { type: "negative_mention", message: "Negative sentiment detected on ChatGPT for query 'dental clinic complaints Austin' — consider responding to recent Google reviews.", severity: "warning" },
  { type: "competitor_gain", message: "Bright Smiles Dental is now mentioned more frequently than you on Claude for 'best Austin dentist' queries.", severity: "warning" },
  { type: "new_opportunity", message: "You're not appearing for 'sedation dentistry Austin' — this is a high-value query with low competition.", severity: "info" },
  { type: "positive_trend", message: "3 consecutive weeks of improving visibility on Google Gemini. Your blog content strategy is working.", severity: "info" },
];

// ── Main generator ───────────────────────────────────────────────────────────
export async function generateDemoData(userId: number): Promise<{ businessId: number }> {
  // Clean up any existing demo data first
  await clearDemoData();

  // 1. Create demo business
  const biz = db.insert(businesses).values({
    name: DEMO_BUSINESS_NAME,
    description: `${DEMO_MARKER} A modern family dental practice in Austin, TX offering comprehensive dental care including cosmetic dentistry, emergency services, and pediatric dentistry.`,
    industry: "Healthcare",
    website: "https://sunrisedentalcare.com",
    location: "Austin, TX",
    keywords: "dentist, dental care, teeth whitening, dental implants, Invisalign, family dentist",
    services: "General Dentistry, Cosmetic Dentistry, Dental Implants, Teeth Whitening, Invisalign, Pediatric Dentistry, Emergency Dental Care",
    targetAudience: "families, adults seeking cosmetic dentistry, anxious patients, seniors",
    uniqueSellingPoints: "Same-day crowns, Saturday hours, sedation dentistry, transparent pricing",
    competitors: "Bright Smiles Dental, Austin Family Dentistry, ClearView Dental, Lone Star Dental Group",
    customQueries: "best dentist in Austin TX\nSunrise Dental Care reviews\naffordable dental implants Austin",
  }).returning().get();

  const businessId = biz.id;

  // Assign business to user
  db.insert(userBusinesses).values({ userId, businessId }).run();

  // 2. Get platform IDs
  const allPlatforms = db.select().from(platforms).all();
  const platformMap: Record<string, number> = {};
  for (const p of allPlatforms) {
    platformMap[p.name] = p.id;
  }

  // 3. Generate 30 days of search records (realistic patterns)
  const searchRecordsToInsert: any[] = [];
  const snapshotsToInsert: any[] = [];

  for (let day = 0; day < 30; day++) {
    const date = daysAgo(day);
    // Run ~8 queries per day, across different platforms
    const dailyQueries = DEMO_QUERIES.sort(() => Math.random() - 0.5).slice(0, randomInt(6, 12));

    for (const query of dailyQueries) {
      // Each query runs on 2-4 platforms
      const queryPlatforms = DEMO_PLATFORMS.sort(() => Math.random() - 0.5).slice(0, randomInt(2, 4));

      // Decide if this query should show a mention (weighted by query type)
      const isBrandQuery = query.toLowerCase().includes("sunrise");
      const isLocalQuery = query.toLowerCase().includes("austin");
      const baseMentionChance = isBrandQuery ? 0.85 : isLocalQuery ? 0.45 : 0.30;

      // Simulate improving trend — more mentions in recent days
      const recencyBoost = Math.max(0, (30 - day) / 100); // 0-0.30

      for (const platName of queryPlatforms) {
        const platformId = platformMap[platName];
        if (!platformId) continue;

        // Grounded platforms (Perplexity, Gemini) are more likely to mention
        const isGrounded = platName === "Perplexity" || platName === "Google Gemini";
        const mentionChance = baseMentionChance + recencyBoost + (isGrounded ? 0.10 : 0);
        const mentioned = Math.random() < mentionChance;

        const position = mentioned ? randomInt(1, 6) : null;
        const sentiment = mentioned
          ? (Math.random() < 0.65 ? "positive" : Math.random() < 0.8 ? "neutral" : "negative")
          : pick(["neutral", "neutral", "negative"]);
        const confidence = mentioned
          ? (Math.random() < 0.5 ? "high" : Math.random() < 0.7 ? "medium" : "low")
          : (Math.random() < 0.6 ? "high" : "medium");
        const crossValidated = queryPlatforms.length >= 2 ? (Math.random() < 0.8 ? 1 : 0) : null;

        searchRecordsToInsert.push({
          businessId,
          platformId,
          query,
          mentioned: mentioned ? 1 : 0,
          position,
          sentiment,
          confidence,
          sourceType: isGrounded ? "grounded" : "knowledge",
          crossValidated,
          date,
        });

        // Create AI snapshot for ~40% of records
        if (Math.random() < 0.4) {
          const responseText = mentioned
            ? generateMentionResponse(platName, query)
            : generateNoMentionResponse(platName, query);
          snapshotsToInsert.push({
            businessId,
            platformId,
            query,
            responseText,
            sentiment,
            mentionedAccurate: mentioned ? 1 : 0,
            flaggedIssues: crossValidated === 0 ? "Outlier: disagrees with other platforms" : null,
            date,
          });
        }
      }
    }
  }

  // Batch insert search records
  for (const record of searchRecordsToInsert) {
    db.insert(searchRecords).values(record).run();
  }
  for (const snap of snapshotsToInsert) {
    db.insert(aiSnapshots).values(snap).run();
  }

  // 4. Competitors
  for (const comp of DEMO_COMPETITORS) {
    db.insert(competitors).values({ businessId, ...comp }).run();
  }

  // 5. Optimized prompts
  for (const prompt of DEMO_PROMPTS) {
    db.insert(optimizedPrompts).values({ businessId, ...prompt }).run();
  }

  // 6. Content gaps
  for (const gap of DEMO_CONTENT_GAPS) {
    db.insert(contentGaps).values({ businessId, ...gap }).run();
  }

  // 7. Alerts (recent dates)
  DEMO_ALERTS.forEach((alert, i) => {
    db.insert(alerts).values({
      businessId,
      type: alert.type,
      message: alert.message,
      severity: alert.severity,
      isRead: i > 2 ? 1 : 0,
      date: daysAgo(i * 2),
    }).run();
  });

  // 8. Locations
  db.insert(locations).values({ businessId, name: "Main Office", address: "4521 Congress Ave, Austin, TX 78745" }).run();
  db.insert(locations).values({ businessId, name: "North Austin", address: "8900 Burnet Rd, Austin, TX 78758" }).run();

  // 9. Referrals (simulate some click-through traffic)
  const landingPages = ["/", "/services", "/about", "/contact", "/teeth-whitening", "/dental-implants"];
  const convTypes = ["contact_form", "phone_call", "booking", null, null, null];
  const devices = ["desktop", "mobile", "mobile", "tablet"];

  for (let day = 0; day < 21; day++) {
    const date = daysAgo(day);
    const numReferrals = randomInt(0, 4);
    for (let r = 0; r < numReferrals; r++) {
      const platName = pick(DEMO_PLATFORMS);
      const platformId = platformMap[platName] ?? 1;
      const convType = pick(convTypes);
      db.insert(referrals).values({
        businessId,
        platformId,
        query: pick(DEMO_QUERIES),
        landingPage: pick(landingPages),
        utmSource: platName.toLowerCase().replace(/\s/g, "-"),
        utmMedium: "ai-referral",
        utmCampaign: "organic",
        converted: convType ? 1 : 0,
        conversionType: convType,
        sessionDuration: randomInt(15, 300),
        pagesViewed: randomInt(1, 6),
        deviceType: pick(devices),
        date,
        timestamp: isoAgo(day, randomInt(8, 22)),
      }).run();
    }
  }

  // 10. A completed scan job
  db.insert(scanJobs).values({
    businessId,
    status: "completed",
    totalQueries: searchRecordsToInsert.length,
    completedQueries: searchRecordsToInsert.length,
    startedAt: isoAgo(0, 2),
    completedAt: isoAgo(0, 2),
  }).run();

  console.log(`[Demo] Generated demo data for "${DEMO_BUSINESS_NAME}" (business #${businessId}): ${searchRecordsToInsert.length} search records, ${snapshotsToInsert.length} snapshots`);

  return { businessId };
}

// ── Clear demo data ──────────────────────────────────────────────────────────
export async function clearDemoData(): Promise<void> {
  // Find demo businesses by the marker in description
  const demoBizzes = db.select({ id: businesses.id })
    .from(businesses)
    .where(sql`${businesses.description} LIKE ${"%" + DEMO_MARKER + "%"}`)
    .all();

  for (const biz of demoBizzes) {
    const id = biz.id;
    db.delete(searchRecords).where(eq(searchRecords.businessId, id)).run();
    db.delete(optimizedPrompts).where(eq(optimizedPrompts.businessId, id)).run();
    db.delete(referrals).where(eq(referrals.businessId, id)).run();
    db.delete(competitors).where(eq(competitors.businessId, id)).run();
    db.delete(aiSnapshots).where(eq(aiSnapshots.businessId, id)).run();
    db.delete(alerts).where(eq(alerts.businessId, id)).run();
    db.delete(contentGaps).where(eq(contentGaps.businessId, id)).run();
    db.delete(locations).where(eq(locations.businessId, id)).run();
    db.delete(scanJobs).where(eq(scanJobs.businessId, id)).run();
    db.delete(userBusinesses).where(eq(userBusinesses.businessId, id)).run();
    db.delete(businesses).where(eq(businesses.id, id)).run();
  }
}

// ── Fake AI response generators ──────────────────────────────────────────────
function generateMentionResponse(platform: string, query: string): string {
  const responses = [
    `Based on reviews and reputation, **Sunrise Dental Care** in Austin, TX is one of the top-rated dental practices in the area. They offer comprehensive services including general dentistry, cosmetic procedures, and emergency care. Patients frequently praise their same-day crown service and Saturday availability. Other notable options include Bright Smiles Dental and Austin Family Dentistry.`,
    `Here are some highly rated dental clinics in Austin, TX:\n\n1. **Sunrise Dental Care** - Known for family-friendly care, transparent pricing, and modern technology including same-day crowns. Located on Congress Ave.\n2. **Bright Smiles Dental** - Popular for cosmetic dentistry\n3. **Austin Family Dentistry** - Multiple locations across Austin\n4. **ClearView Dental** - Specializes in veneers and whitening`,
    `Sunrise Dental Care has strong reviews across multiple platforms. Patients highlight their gentle approach with anxious patients, extended Saturday hours, and the convenience of same-day crowns. They accept most major dental insurance plans. Their Congress Ave location is their main office, with a second location in North Austin.`,
    `For ${query.replace(/"/g, "")}, I'd recommend considering Sunrise Dental Care in Austin. They have a reputation for quality care and patient comfort. Their team offers sedation dentistry options for patients with dental anxiety, and they're known for transparent pricing without hidden fees.`,
    `Several dental practices serve the Austin area well. Sunrise Dental Care stands out for their comprehensive services including dental implants, Invisalign, and pediatric dentistry. Their patients report short wait times and a welcoming environment. They're located on Congress Avenue with convenient parking.`,
  ];
  return pick(responses);
}

function generateNoMentionResponse(platform: string, query: string): string {
  const responses = [
    `Here are some popular dental options in the Austin area:\n\n1. **Bright Smiles Dental** - Well-known for cosmetic procedures\n2. **Austin Family Dentistry** - Great for families with multiple locations\n3. **ClearView Dental** - Specializes in aesthetic dentistry\n4. **Lone Star Dental Group** - Accepts most insurance plans\n\nI'd recommend checking recent Google reviews and confirming availability before booking.`,
    `When looking for dental care in Austin, consider factors like insurance acceptance, location, hours, and patient reviews. Several well-reviewed practices include Bright Smiles Dental, Austin Family Dentistry, and Lone Star Dental Group. Check their websites for current availability and services offered.`,
    `I don't have specific verified information about that particular query, but I can suggest looking at review sites like Yelp, Google Reviews, and Healthgrades to find top-rated dental providers in Austin, TX. Look for practices with high ratings, recent reviews, and the specific services you need.`,
  ];
  return pick(responses);
}
