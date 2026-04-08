import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, Search, Star, MapPin, FileText, Clock, Trophy } from "lucide-react";
import { InfoTip } from "@/components/info-tip";

interface ScoreCategory {
  name: string;
  score: number;
  icon: any;
  tips: string[];
  color: string;
  tooltip: string;
}

function analyzeContent(name: string, description: string): ScoreCategory[] {
  const text = `${name} ${description}`.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  const uniqueWords = new Set(words);

  // Specificity
  const adjectives = ["best", "top", "premium", "unique", "exclusive", "custom", "specialized", "award", "certified", "expert", "leading", "innovative", "professional", "quality", "superior"];
  const adjCount = adjectives.filter(a => text.includes(a)).length;
  const wordCount = words.length;
  let specificityScore = Math.min(100, (wordCount >= 30 ? 25 : wordCount * 0.8) + (uniqueWords.size / words.length * 30) + (adjCount * 10));
  const specificityTips: string[] = [];
  if (wordCount < 30) specificityTips.push("Add more detail — aim for at least 30 words in your description");
  if (adjCount < 2) specificityTips.push("Include unique adjectives like 'award-winning', 'certified', or 'specialized'");
  if (uniqueWords.size / words.length < 0.7) specificityTips.push("Use more varied vocabulary to stand out in AI responses");

  // Review Signals
  const reviewKeywords = ["review", "testimonial", "rated", "stars", "customer", "feedback", "recommend", "trusted", "verified", "satisfaction", "guarantee"];
  const reviewCount = reviewKeywords.filter(k => text.includes(k)).length;
  let reviewScore = Math.min(100, reviewCount * 15 + (text.includes("5 star") || text.includes("5-star") ? 20 : 0));
  const reviewTips: string[] = [];
  if (reviewCount < 2) reviewTips.push("Mention customer reviews or testimonials in your description");
  if (!text.includes("rated") && !text.includes("star")) reviewTips.push("Include star ratings or review scores (e.g., '4.8 stars on Google')");
  if (!text.includes("trusted") && !text.includes("verified")) reviewTips.push("Use trust signals like 'trusted by 500+ customers'");

  // Local Signals
  const localKeywords = ["address", "street", "avenue", "city", "state", "zip", "downtown", "near", "located", "location", "neighborhood", "area", "local", "community", "region"];
  const localCount = localKeywords.filter(k => text.includes(k)).length;
  let localScore = Math.min(100, localCount * 15 + (/\d{5}/.test(text) ? 20 : 0));
  const localTips: string[] = [];
  if (localCount < 2) localTips.push("Include your city, neighborhood, or street address");
  if (!/\d{5}/.test(text)) localTips.push("Add your zip code for better local AI matching");
  if (!text.includes("near") && !text.includes("located")) localTips.push("Use location phrases like 'located in' or 'serving the [area] community'");

  // Structured Info
  const structuredKeywords = ["hours", "open", "close", "price", "cost", "phone", "email", "contact", "book", "schedule", "appointment", "menu", "service", "offer"];
  const structuredCount = structuredKeywords.filter(k => text.includes(k)).length;
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(text);
  const hasEmail = /@/.test(text);
  let structuredScore = Math.min(100, structuredCount * 12 + (hasPhone ? 15 : 0) + (hasEmail ? 15 : 0));
  const structuredTips: string[] = [];
  if (!hasPhone) structuredTips.push("Include a phone number for direct contact");
  if (structuredCount < 3) structuredTips.push("Mention hours, pricing, or services offered");
  if (!text.includes("book") && !text.includes("schedule")) structuredTips.push("Add booking or scheduling information if applicable");

  // Content Freshness
  const currentYear = "2026";
  const hasYear = text.includes(currentYear) || text.includes("2025");
  const freshKeywords = ["new", "updated", "latest", "current", "now", "today", "recently", "modern", "fresh"];
  const freshCount = freshKeywords.filter(k => text.includes(k)).length;
  let freshnessScore = Math.min(100, (hasYear ? 35 : 0) + freshCount * 15);
  const freshnessTips: string[] = [];
  if (!hasYear) freshnessTips.push(`Include the current year (${currentYear}) to signal freshness to AI`);
  if (freshCount < 2) freshnessTips.push("Use time-sensitive words like 'updated', 'latest', or 'new in 2026'");

  // Competitive Edge
  const edgeKeywords = ["only", "first", "exclusive", "patented", "proprietary", "award", "winning", "ranked", "best", "leading", "pioneering", "innovative", "unique"];
  const edgeCount = edgeKeywords.filter(k => text.includes(k)).length;
  const hasNumbers = /\d+%|\d+ years|\d+\+/.test(text);
  let edgeScore = Math.min(100, edgeCount * 15 + (hasNumbers ? 20 : 0));
  const edgeTips: string[] = [];
  if (edgeCount < 2) edgeTips.push("Highlight what makes you unique — awards, patents, or 'only' claims");
  if (!hasNumbers) edgeTips.push("Include specific numbers (e.g., '10+ years experience', '500+ clients served')");

  return [
    { name: "Specificity", score: Math.round(specificityScore), icon: Search, tips: specificityTips, color: "text-blue-500", tooltip: "How detailed and unique your business description is. Vague descriptions get overlooked by AI." },
    { name: "Review Signals", score: Math.round(reviewScore), icon: Star, tips: reviewTips, color: "text-amber-500", tooltip: "Whether your description mentions reviews, ratings, or testimonials. AI platforms heavily weight social proof." },
    { name: "Local Signals", score: Math.round(localScore), icon: MapPin, tips: localTips, color: "text-green-500", tooltip: "Whether your description includes location details like city, address, or neighborhood. Critical for 'near me' AI searches." },
    { name: "Structured Info", score: Math.round(structuredScore), icon: FileText, tips: structuredTips, color: "text-purple-500", tooltip: "Whether you include practical details like hours, pricing, phone number, and email. AI platforms favor complete information." },
    { name: "Content Freshness", score: Math.round(freshnessScore), icon: Clock, tips: freshnessTips, color: "text-sky-500", tooltip: "Whether your content references current dates or recent events. AI platforms prefer up-to-date information." },
    { name: "Competitive Edge", score: Math.round(edgeScore), icon: Trophy, tips: edgeTips, color: "text-rose-500", tooltip: "Whether you highlight what makes you unique — awards, certifications, guarantees, or exclusive offerings." },
  ];
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-400";
  if (score >= 40) return "text-orange-600 dark:text-orange-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Work";
  return "Poor";
}

export default function Optimizer() {
  const [businessName, setBusinessName] = useState("");
  const [description, setDescription] = useState("");
  const [results, setResults] = useState<ScoreCategory[] | null>(null);

  const handleAnalyze = () => {
    if (!businessName.trim() || !description.trim()) return;
    setResults(analyzeContent(businessName, description));
  };

  const overallScore = results ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length) : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-semibold" data-testid="text-optimizer-title">Prompt Optimizer</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyze your business description for AI search visibility</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Lightbulb className="w-5 h-5 text-primary" />
            AI Visibility Scorer<InfoTip text="Analyzes your business description to predict how well AI search engines can find and recommend your business. Higher scores mean better AI visibility." />
          </CardTitle>
          <CardDescription>Enter your business name and description to see how well it performs for AI search engines</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Business Name</label>
            <Input
              data-testid="input-optimizer-name"
              placeholder="e.g., Sunset Bistro"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Business Description / Website Content</label>
            <Textarea
              data-testid="input-optimizer-description"
              placeholder="Paste your business description, about page content, or meta description here..."
              rows={6}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button
            data-testid="button-analyze"
            onClick={handleAnalyze}
            disabled={!businessName.trim() || !description.trim()}
          >
            Analyze Visibility
          </Button>
        </CardContent>
      </Card>

      {results && (
        <>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">Overall AI Visibility Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold font-serif ${getScoreColor(overallScore)}`} data-testid="text-overall-score">{overallScore}</span>
                    <span className="text-lg text-muted-foreground">/ 100</span>
                  </div>
                  <Badge variant={overallScore >= 60 ? "default" : "destructive"} className="mt-1" data-testid="badge-score-label">
                    {getScoreLabel(overallScore)}
                  </Badge>
                </div>
                <div className="w-32 h-32 relative">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="8"
                      strokeDasharray={`${overallScore * 2.51} 251`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {results.map((category) => (
              <Card key={category.name}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <category.icon className={`w-4 h-4 ${category.color}`} />
                    <span className="font-medium text-sm">{category.name}<InfoTip text={category.tooltip} /></span>
                    <span className={`ml-auto font-bold ${getScoreColor(category.score)}`} data-testid={`text-score-${category.name.toLowerCase().replace(/\s/g, "-")}`}>
                      {category.score}
                    </span>
                  </div>
                  <Progress value={category.score} className="h-2 mb-3" />
                  {category.tips.length > 0 && (
                    <ul className="space-y-1.5">
                      {category.tips.map((tip, i) => (
                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                          <span className="text-primary mt-0.5 shrink-0">-</span>
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {category.tips.length === 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400">Great job! This category is well optimized.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
