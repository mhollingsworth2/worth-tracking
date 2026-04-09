import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Target, TrendingUp, Zap, HelpCircle, Users, ShoppingCart,
  RefreshCw, Search, BarChart2, Lightbulb, ChevronRight,
  CheckCircle2, AlertCircle, Flame, MessageCircleQuestion,
  Swords, BadgeDollarSign,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────

type Category = "all" | "strength" | "opportunity" | "trending" | "question" | "competitor" | "intent";

interface PromptRecommendation {
  prompt: string;
  category: Exclude<Category, "all">;
  mentionRate: number;
  frequency: number;
  score: number;
  reason: string;
  suggestedAction: string;
}

interface RecommendationSummary {
  totalScanned: number;
  strengthCount: number;
  opportunityCount: number;
  trendingCount: number;
  questionCount: number;
  competitorCount: number;
  intentCount: number;
}

interface ApiResponse {
  recommendations: PromptRecommendation[];
  summary: RecommendationSummary;
}

// ── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<
  Exclude<Category, "all">,
  { label: string; icon: any; color: string; badgeClass: string; description: string }
> = {
  strength: {
    label: "Strength",
    icon: CheckCircle2,
    color: "#22c55e",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    description: "You're already winning here",
  },
  opportunity: {
    label: "Opportunity",
    icon: AlertCircle,
    color: "#f97316",
    badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    description: "Gap to fill — competitors are ahead",
  },
  trending: {
    label: "Trending",
    icon: Flame,
    color: "#3b82f6",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    description: "Momentum is building",
  },
  question: {
    label: "Question",
    icon: MessageCircleQuestion,
    color: "#a855f7",
    badgeClass: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    description: "People are asking this in AI search",
  },
  competitor: {
    label: "Competitor",
    icon: Swords,
    color: "#ef4444",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    description: "Competitors dominate this prompt",
  },
  intent: {
    label: "High Intent",
    icon: BadgeDollarSign,
    color: "#eab308",
    badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    description: "Buying signals — people ready to decide",
  },
};

const CATEGORY_TABS: { value: Category; label: string; icon: any }[] = [
  { value: "all",        label: "All",         icon: BarChart2 },
  { value: "strength",   label: "Strengths",   icon: CheckCircle2 },
  { value: "opportunity",label: "Opportunities",icon: AlertCircle },
  { value: "trending",   label: "Trending",    icon: Flame },
  { value: "question",   label: "Questions",   icon: MessageCircleQuestion },
  { value: "competitor", label: "Competitors", icon: Swords },
  { value: "intent",     label: "High Intent", icon: BadgeDollarSign },
];

// ── Score colour ─────────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

// ── Summary stat card ────────────────────────────────────────────────────────

function StatPill({
  label, count, icon: Icon, color,
}: { label: string; count: number; icon: any; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-card">
      <Icon className="w-4 h-4 shrink-0" style={{ color }} />
      <div>
        <p className="text-base font-semibold leading-none">{count}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Recommendation card ──────────────────────────────────────────────────────

function RecommendationCard({
  rec,
  businessId,
  onAddToQueries,
}: {
  rec: PromptRecommendation;
  businessId: number;
  onAddToQueries: (prompt: string) => void;
}) {
  const cfg = CATEGORY_CONFIG[rec.category];
  const CatIcon = cfg.icon;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4 space-y-3">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <CatIcon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} />
            <p className="text-sm font-medium truncate">{rec.prompt}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Badge className={`text-xs ${cfg.badgeClass}`}>{cfg.label}</Badge>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-14 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${rec.score}%`, backgroundColor: scoreColor(rec.score) }}
                />
              </div>
              <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: scoreColor(rec.score) }}>
                {rec.score}/100
              </span>
            </div>
          </div>
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">Mention rate</span>
            <div className="flex items-center gap-1">
              <Progress value={rec.mentionRate} className="w-16 h-1.5" />
              <span className="tabular-nums font-medium">{rec.mentionRate}%</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Search className="w-3 h-3" />
            <span>Scanned <strong className="text-foreground">{rec.frequency}</strong>×</span>
          </div>
        </div>

        {/* Why */}
        <div className="flex items-start gap-2 text-xs bg-muted/50 rounded-md px-3 py-2">
          <BarChart2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{rec.reason}</span>
        </div>

        {/* Action */}
        <div className="flex items-start gap-2 text-xs bg-primary/5 rounded-md px-3 py-2">
          <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>{rec.suggestedAction}</span>
        </div>

        {/* CTA buttons */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => onAddToQueries(rec.prompt)}
          >
            <Target className="w-3 h-3" />
            Add to Custom Queries
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground"
            onClick={() => {
              // Navigate to search log filtered by this prompt
              const url = `/business/${businessId}?tab=records&q=${encodeURIComponent(rec.prompt)}`;
              window.location.href = url;
            }}
          >
            View Scan Results
            <ChevronRight className="w-3 h-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function PromptRecommendations({ businessId }: { businessId: number }) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [searchText, setSearchText] = useState("");

  const { data, isLoading, error } = useQuery<ApiResponse>({
    queryKey: ["/api/businesses", businessId, "prompt-recommendations"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${businessId}/prompt-recommendations?limit=100`);
      if (!res.ok) throw new Error("Failed to load recommendations");
      return res.json();
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/businesses/${businessId}/prompt-recommendations/refresh`,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/businesses", businessId, "prompt-recommendations"],
      });
      toast({ title: "Recommendations refreshed" });
    },
    onError: (err: any) => {
      toast({ title: "Refresh failed", description: err.message, variant: "destructive" });
    },
  });

  const handleAddToQueries = (prompt: string) => {
    // Copy to clipboard as a quick action
    navigator.clipboard.writeText(prompt).then(() => {
      toast({
        title: "Prompt copied",
        description: "Paste it into Custom Queries to start tracking.",
      });
    }).catch(() => {
      toast({ title: "Copied prompt to clipboard" });
    });
  };

  // Filter recommendations
  const filtered = (data?.recommendations ?? []).filter((rec) => {
    const matchesCategory = activeCategory === "all" || rec.category === activeCategory;
    const matchesSearch   = !searchText || rec.prompt.toLowerCase().includes(searchText.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const summary = data?.summary;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-destructive" />
          <p className="text-muted-foreground">Failed to load recommendations. Try refreshing.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!data || data.recommendations.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <Target className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-1">No recommendations yet</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-5">
            Run an AI scan first to collect data. Recommendations are generated automatically
            once scan results are available.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
            Analyse Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatPill label="Strengths"    count={summary.strengthCount}    icon={CheckCircle2}        color="#22c55e" />
          <StatPill label="Opportunities" count={summary.opportunityCount} icon={AlertCircle}         color="#f97316" />
          <StatPill label="Trending"     count={summary.trendingCount}    icon={Flame}               color="#3b82f6" />
          <StatPill label="Questions"    count={summary.questionCount}    icon={MessageCircleQuestion} color="#a855f7" />
          <StatPill label="Competitors"  count={summary.competitorCount}  icon={Swords}              color="#ef4444" />
          <StatPill label="High Intent"  count={summary.intentCount}      icon={BadgeDollarSign}     color="#eab308" />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search prompts…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="h-8"
        >
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Category tabs */}
      <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as Category)}>
        <TabsList className="flex-wrap h-auto gap-1">
          {CATEGORY_TABS.map(({ value, label, icon: Icon }) => {
            const count =
              value === "all"
                ? data.recommendations.length
                : data.recommendations.filter((r) => r.category === value).length;
            return (
              <TabsTrigger key={value} value={value} className="gap-1.5 text-xs">
                <Icon className="w-3.5 h-3.5" />
                {label}
                {count > 0 && (
                  <span className="ml-0.5 text-[10px] font-mono bg-muted rounded-full px-1.5 py-0.5 leading-none">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* Results */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <HelpCircle className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchText
                ? `No prompts match "${searchText}" in this category.`
                : "No prompts in this category yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((rec, i) => (
            <RecommendationCard
              key={`${rec.prompt}-${i}`}
              rec={rec}
              businessId={businessId}
              onAddToQueries={handleAddToQueries}
            />
          ))}
        </div>
      )}

      {/* Footer note */}
      {summary && (
        <p className="text-xs text-muted-foreground text-center pb-2">
          Based on {summary.totalScanned.toLocaleString()} scanned queries · Cached for 24 hours ·{" "}
          <button
            className="underline underline-offset-2 hover:text-foreground transition-colors"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            refresh now
          </button>
        </p>
      )}
    </div>
  );
}
