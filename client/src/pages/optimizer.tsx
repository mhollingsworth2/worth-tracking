import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Globe, MapPin, Star, FileText, Code2, Trophy, CheckCircle, XCircle, ExternalLink, Lightbulb } from "lucide-react";
import { InfoTip } from "@/components/info-tip";

interface AuditCategory {
  name: string;
  score: number;
  tips: string[];
  details: string;
}

interface AuditResult {
  businessName: string;
  website: string | null;
  pagesScraped: number;
  pagesFound: string[];
  overallScore: number;
  categories: AuditCategory[];
  scanStats: { mentionRate: number; avgPosition: number | null; totalQueries: number } | null;
}

interface Business {
  id: number;
  name: string;
  website: string | null;
  location: string | null;
  industry: string | null;
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

function getProgressColor(score: number): string {
  if (score >= 80) return "[&>div]:bg-green-500";
  if (score >= 60) return "[&>div]:bg-amber-500";
  if (score >= 40) return "[&>div]:bg-orange-500";
  return "[&>div]:bg-red-500";
}

const CATEGORY_ICONS: Record<string, any> = {
  "Local Signals": MapPin,
  "Review & Trust Signals": Star,
  "Schema & Structured Data": Code2,
  "Content Quality": FileText,
  "Competitive Edge": Trophy,
};

const CATEGORY_COLORS: Record<string, string> = {
  "Local Signals": "text-green-500",
  "Review & Trust Signals": "text-amber-500",
  "Schema & Structured Data": "text-purple-500",
  "Content Quality": "text-blue-500",
  "Competitive Edge": "text-rose-500",
};

export default function Optimizer() {
  const [selectedBiz, setSelectedBiz] = useState<string>("");
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: businesses } = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
    queryFn: async () => { const res = await fetch("/api/businesses"); return res.json(); },
  });

  const runAudit = async () => {
    if (!selectedBiz) return;
    setLoading(true);
    setError(null);
    setAuditResult(null);
    try {
      const res = await fetch(`/api/businesses/${selectedBiz}/visibility-audit`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Audit failed");
      }
      const data = await res.json();
      setAuditResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selectedBusiness = businesses?.find(b => b.id.toString() === selectedBiz);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-semibold" data-testid="text-optimizer-title">AI Visibility Audit</h1>
        <p className="text-sm text-muted-foreground mt-1">Scrapes your website and analyzes it for AI search visibility signals</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="w-5 h-5 text-primary" />
            Website Analysis
            <InfoTip text="Scrapes your actual website (homepage, about, services, contact, reviews pages) and checks for signals that AI platforms use to recommend businesses — schema markup, local SEO, trust signals, content quality, and competitive differentiators." />
          </CardTitle>
          <CardDescription>Select a business to audit its website for AI visibility</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-3">
            <Select value={selectedBiz} onValueChange={setSelectedBiz}>
              <SelectTrigger className="flex-1" data-testid="select-business">
                <SelectValue placeholder="Select a business..." />
              </SelectTrigger>
              <SelectContent>
                {businesses?.map(b => (
                  <SelectItem key={b.id} value={b.id.toString()}>
                    {b.name} {b.location ? `— ${b.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={runAudit}
              disabled={!selectedBiz || loading}
              data-testid="button-analyze"
            >
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Lightbulb className="w-4 h-4 mr-1.5" />}
              {loading ? "Scraping & Analyzing..." : "Run Audit"}
            </Button>
          </div>

          {selectedBusiness && (
            <div className="flex gap-3 text-xs text-muted-foreground">
              {selectedBusiness.website && (
                <span className="flex items-center gap-1">
                  <Globe className="w-3 h-3" />
                  <a href={selectedBusiness.website.startsWith("http") ? selectedBusiness.website : `https://${selectedBusiness.website}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {selectedBusiness.website}
                  </a>
                  <ExternalLink className="w-2.5 h-2.5" />
                </span>
              )}
              {selectedBusiness.location && (
                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{selectedBusiness.location}</span>
              )}
              {!selectedBusiness.website && (
                <span className="text-amber-600">No website configured — add one in business settings for a full audit</span>
              )}
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg">{error}</div>
          )}
        </CardContent>
      </Card>

      {auditResult && (
        <>
          {/* Overall Score */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">AI Visibility Score</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-4xl font-bold font-serif ${getScoreColor(auditResult.overallScore)}`} data-testid="text-overall-score">
                      {auditResult.overallScore}
                    </span>
                    <span className="text-lg text-muted-foreground">/ 100</span>
                  </div>
                  <Badge variant={auditResult.overallScore >= 60 ? "default" : "destructive"} className="mt-1" data-testid="badge-score-label">
                    {getScoreLabel(auditResult.overallScore)}
                  </Badge>
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p><strong>{auditResult.pagesScraped}</strong> pages scraped from your website</p>
                    {auditResult.scanStats && (
                      <p>Latest scan: <strong>{auditResult.scanStats.mentionRate}%</strong> mention rate across {auditResult.scanStats.totalQueries} queries</p>
                    )}
                  </div>
                </div>
                <div className="w-32 h-32 relative">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
                    <circle
                      cx="50" cy="50" r="40" fill="none"
                      stroke={auditResult.overallScore >= 80 ? "#22c55e" : auditResult.overallScore >= 60 ? "#f59e0b" : auditResult.overallScore >= 40 ? "#f97316" : "#ef4444"}
                      strokeWidth="8"
                      strokeDasharray={`${auditResult.overallScore * 2.51} 251`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">{auditResult.overallScore}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pages found */}
          {auditResult.pagesFound.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="text-xs font-medium mb-2">Pages analyzed:</p>
                <div className="flex flex-wrap gap-1.5">
                  {auditResult.pagesFound.map((url, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-mono">
                      {url.replace(/^https?:\/\//, "").replace(/^www\./, "")}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Category cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {auditResult.categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.name] || FileText;
              const color = CATEGORY_COLORS[category.name] || "text-blue-500";
              return (
                <Card key={category.name}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`w-4 h-4 ${color}`} />
                      <span className="font-medium text-sm">{category.name}</span>
                      <span className={`ml-auto font-bold text-lg ${getScoreColor(category.score)}`} data-testid={`text-score-${category.name.toLowerCase().replace(/\s+/g, "-")}`}>
                        {category.score}
                      </span>
                    </div>
                    <Progress value={category.score} className={`h-2 mb-3 ${getProgressColor(category.score)}`} />

                    {/* What was found */}
                    {category.details && (
                      <div className="mb-2">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Found on your site</p>
                        <div className="flex flex-wrap gap-1">
                          {category.details.split(", ").filter(Boolean).map((d, i) => (
                            <Badge key={i} variant="outline" className="text-xs text-green-600 border-green-300 dark:border-green-800">
                              {d}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recommendations */}
                    {category.tips.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Recommendations</p>
                        <ul className="space-y-1.5">
                          {category.tips.map((tip, i) => (
                            <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                              <XCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />
                              <span>{tip}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {category.tips.length === 0 && (
                      <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle className="w-3 h-3" /> Great job! This category is well optimized.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
