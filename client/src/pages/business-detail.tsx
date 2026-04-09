import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link, useLocation } from "wouter";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Switch as SwitchUI } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ArrowLeft, Eye, TrendingUp, Hash, Layers, Trash2,
  CheckCircle, XCircle, Lightbulb, Target, MapPin, MessageSquare, Star, Search,
  Bot, Sparkles, Brain, Cpu, Globe,
  MousePointerClick, ArrowRightLeft, Clock, FileText,
  ExternalLink, Copy, Smartphone, Monitor, Tablet,
  Phone, ShoppingCart, UserPlus, Mail, CalendarCheck,
  Info, Download, Users, Camera, AlertTriangle, Plus, X, Settings, ChevronDown, ChevronUp,
  Zap, Loader2, Code2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InfoTip } from "@/components/info-tip";
import { SnippetModal } from "@/components/SnippetModal";
import type { Business, SearchRecord, OptimizedPrompt, Platform, Referral, Competitor, AiSnapshot, ContentGap, Location as BizLocation } from "@shared/schema";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, CartesianGrid, Cell, PieChart, Pie, Legend,
} from "recharts";

const platformIcons: Record<string, any> = {
  ChatGPT: Bot,
  Perplexity: Search,
  "Google Gemini": Sparkles,
  Claude: Brain,
  Copilot: Cpu,
  "Meta AI": Globe,
};

const categoryConfig: Record<string, { icon: any; label: string; color: string }> = {
  discovery: { icon: Search, label: "Discovery", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  comparison: { icon: Layers, label: "Comparison", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  recommendation: { icon: Star, label: "Recommendation", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  local: { icon: MapPin, label: "Local", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  review: { icon: MessageSquare, label: "Review", color: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400" },
};

const conversionIcons: Record<string, any> = {
  contact_form: Mail,
  purchase: ShoppingCart,
  signup: UserPlus,
  phone_call: Phone,
  booking: CalendarCheck,
};

const conversionLabels: Record<string, string> = {
  contact_form: "Contact Form",
  purchase: "Purchase",
  signup: "Sign Up",
  phone_call: "Phone Call",
  booking: "Booking",
};

const CONVERSION_COLORS = ["hsl(43, 52%, 54%)", "hsl(196, 36%, 64%)", "hsl(41, 60%, 67%)", "hsl(214, 42%, 24%)", "hsl(35, 60%, 55%)"];

const sentimentConfig: Record<string, { color: string; badge: string }> = {
  positive: { color: "text-green-500", badge: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  neutral: { color: "text-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  negative: { color: "text-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
};

const contentTypeBadge: Record<string, string> = {
  blog_post: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  faq: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  schema_markup: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  landing_page: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  review_response: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
};

const contentTypeLabel: Record<string, string> = {
  blog_post: "Blog Post",
  faq: "FAQ",
  schema_markup: "Schema Markup",
  landing_page: "Landing Page",
  review_response: "Review Response",
};

const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

function KPICard({ label, value, subtitle, icon: Icon, loading, tooltip }: {
  label: string; value: string | number; subtitle?: string; icon: any; loading: boolean; tooltip?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xs text-muted-foreground font-medium">{label}{tooltip && <InfoTip text={tooltip} />}</span>
        </div>
        {loading ? <Skeleton className="h-7 w-20" /> : (
          <p className="text-lg font-semibold" data-testid={`text-kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>
        )}
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// ── Schema Markup Recommendations Component ──────────────────────────────────
function SchemaRecommendations({ businessId }: { businessId: number }) {
  const { toast } = useToast();
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  const { data, isLoading } = useQuery<{ recommendations: Array<{
    schemaType: string;
    description: string;
    priority: "high" | "medium" | "low";
    code: string;
    implemented: boolean;
  }> }>({
    queryKey: ["/api/businesses", businessId, "schema-recommendations"],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/businesses/${businessId}/schema-recommendations`);
      return res.json();
    },
  });

  const toggleExpand = (index: number) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast({ title: "Copied!", description: "Schema markup copied to clipboard." });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  const priorityBadge: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Code2 className="w-4 h-4 text-primary" />
          Schema Markup &amp; Structured Data Recommendations
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Add these JSON-LD snippets to your website's &lt;head&gt; to improve AI discoverability.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : data?.recommendations && data.recommendations.length > 0 ? (
          <div className="space-y-4">
            {data.recommendations.map((rec, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{rec.schemaType}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${priorityBadge[rec.priority]}`}>
                      {rec.priority}
                    </Badge>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => copyCode(rec.code)}>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    Copy
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{rec.description}</p>
                <Collapsible open={expandedCards.has(idx)} onOpenChange={() => toggleExpand(idx)}>
                  <CollapsibleTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs w-full justify-between">
                      {expandedCards.has(idx) ? "Hide Code" : "View Code"}
                      {expandedCards.has(idx) ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <pre className="mt-2 p-3 bg-muted/50 rounded-md text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      {rec.code}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">No schema recommendations available.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function BusinessDetail() {
  const [, params] = useRoute("/business/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = parseInt(params?.id ?? "0");

  // ---- Existing queries ----
  const { data: business, isLoading: bizLoading } = useQuery<Business>({
    queryKey: ["/api/businesses", id],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}`); return res.json(); },
  });

  const { data: stats, isLoading: statsLoading } = useQuery<any>({
    queryKey: ["/api/businesses", id, "stats"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/stats`); return res.json(); },
  });

  const { data: trend } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "trend"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/trend`); return res.json(); },
  });

  const { data: platformBreakdown } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "platform-breakdown"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/platform-breakdown`); return res.json(); },
  });

  const { data: records } = useQuery<SearchRecord[]>({
    queryKey: ["/api/businesses", id, "records"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/records`); return res.json(); },
  });

  const { data: prompts } = useQuery<OptimizedPrompt[]>({
    queryKey: ["/api/businesses", id, "prompts"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/prompts`); return res.json(); },
  });

  const { data: allPlatforms } = useQuery<Platform[]>({ queryKey: ["/api/platforms"] });

  // ---- Referral queries ----
  const { data: referralStats, isLoading: refStatsLoading } = useQuery<any>({
    queryKey: ["/api/businesses", id, "referral-stats"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/referral-stats`); return res.json(); },
  });

  const { data: referralTrend } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "referral-trend"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/referral-trend`); return res.json(); },
  });

  const { data: referralsByPlatform } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "referrals-by-platform"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/referrals-by-platform`); return res.json(); },
  });

  const { data: conversionsByType } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "conversions-by-type"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/conversions-by-type`); return res.json(); },
  });

  const { data: topReferralQueries } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "top-referral-queries"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/top-referral-queries`); return res.json(); },
  });

  const { data: allReferrals } = useQuery<Referral[]>({
    queryKey: ["/api/businesses", id, "referrals"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/referrals`); return res.json(); },
  });

  // ---- NEW queries ----
  const { data: competitorsData } = useQuery<Competitor[]>({
    queryKey: ["/api/businesses", id, "competitors"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/competitors`); return res.json(); },
  });

  const { data: snapshotsData } = useQuery<AiSnapshot[]>({
    queryKey: ["/api/businesses", id, "snapshots"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/snapshots`); return res.json(); },
  });

  const { data: contentGapsData } = useQuery<ContentGap[]>({
    queryKey: ["/api/businesses", id, "content-gaps"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/content-gaps`); return res.json(); },
  });

  const { data: locationsData } = useQuery<BizLocation[]>({
    queryKey: ["/api/businesses", id, "locations"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/locations`); return res.json(); },
  });

  const { data: queryPerf } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "query-performance"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/query-performance`); return res.json(); },
  });

  const { data: visibilityScores } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "visibility-scores"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/visibility-scores`); return res.json(); },
  });

  // Poll scan jobs to detect background scans (e.g. auto-scan on creation)
  const { data: scanJobs } = useQuery<any[]>({
    queryKey: ["/api/businesses", id, "scan-jobs"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${id}/scan-jobs`); return res.json(); },
    refetchInterval: 5000, // poll every 5s while visible
  });
  const activeScan = scanJobs?.find((j: any) => j.status === "running");

  // Auto-refresh all data once a background scan completes
  const prevScanStatus = useRef<string>("");
  const latestStatus = scanJobs?.[0]?.status ?? "";
  useEffect(() => {
    if (prevScanStatus.current === "running" && latestStatus === "completed") {
      // Scan just finished — refresh everything
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", id] });
    }
    prevScanStatus.current = latestStatus;
  }, [latestStatus, id]);

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/businesses/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      toast({ title: "Business deleted" });
      navigate("/");
    },
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/businesses/${id}/scan`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", id] });
      toast({
        title: "Scan complete",
        description: `Scanned ${data.totalQueries} queries across ${data.platforms} platforms. Found ${data.mentions} mentions.`,
      });
    },
    onError: (err: any) => {
      const msg = err.message || "Scan failed";
      if (msg.includes("No API keys")) {
        toast({ title: "No API keys configured", description: "Add keys in the API Keys page.", variant: "destructive" });
      } else {
        toast({ title: "Scan failed", description: msg, variant: "destructive" });
      }
    },
  });

  // Snippet modal state
  const [snippetOpen, setSnippetOpen] = useState(false);

  // Manual log search state
  const [logOpen, setLogOpen] = useState(false);
  const [logPlatform, setLogPlatform] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [logResponse, setLogResponse] = useState("");
  const [logMentioned, setLogMentioned] = useState(false);

  const logSearchMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/businesses/${id}/log-search`, {
        platformName: logPlatform,
        query: logQuery,
        responseText: logResponse || undefined,
        mentioned: logMentioned,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", id] });
      setLogPlatform("");
      setLogQuery("");
      setLogResponse("");
      setLogMentioned(false);
      toast({ title: "Search logged successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Error logging search", description: err.message, variant: "destructive" });
    },
  });

  const getPlatformName = (platformId: number) =>
    allPlatforms?.find((p) => p.id === platformId)?.name ?? "Unknown";

  if (bizLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Business not found.</p>
        <Link href="/"><Button variant="ghost" className="mt-2">Go back</Button></Link>
      </div>
    );
  }

  const trendData = trend?.map((t) => ({
    ...t,
    date: new Date(t.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
  })) ?? [];

  const refTrendData = referralTrend?.map((t) => ({
    ...t,
    date: new Date(t.date).toLocaleDateString("en", { month: "short", day: "numeric" }),
  })) ?? [];

  const convPieData = conversionsByType?.map((c, i) => ({
    name: conversionLabels[c.conversionType] || c.conversionType,
    value: c.count,
    fill: CONVERSION_COLORS[i % CONVERSION_COLORS.length],
  })) ?? [];

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="icon" className="shrink-0" data-testid="button-back">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-serif font-semibold" data-testid="text-business-name">{business.name}</h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <Badge variant="secondary" className="text-xs">{business.industry}</Badge>
                {business.location && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{business.location}</span>}
                {business.ga4Id && <Badge variant="outline" className="text-xs">GA4 Connected</Badge>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
              data-testid="button-run-scan"
            >
              {scanMutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Zap className="w-4 h-4 mr-1.5" />}
              {scanMutation.isPending ? "Scanning..." : "Run AI Scan"}
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => window.open(`/api/businesses/${id}/export/summary-csv`, "_blank")}
              data-testid="button-export-summary"
            >
              <Download className="w-4 h-4 mr-1.5" />
              Export Summary
            </Button>
            <Button
              variant="ghost" size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              data-testid="button-delete"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              Delete
            </Button>
          </div>
        </div>

        {/* Scan-in-progress banner */}
        {activeScan && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-primary/30 bg-primary/5">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">AI scan in progress...</p>
              <p className="text-xs text-muted-foreground">
                {activeScan.completedQueries} / {activeScan.totalQueries} queries completed — data updates live
              </p>
            </div>
          </div>
        )}

        {/* Empty state when no data yet and no scan running */}
        {!activeScan && stats?.totalSearches === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center border rounded-lg">
            <Search className="w-10 h-10 text-muted-foreground mb-3" />
            <h3 className="font-semibold mb-1">No search data yet</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Click "Run AI Scan" to query AI platforms and see how your business appears in real search results.
            </p>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Total Searches" value={stats?.totalSearches ?? 0} icon={Search} loading={statsLoading} tooltip="How many times AI platforms were queried with searches relevant to your business." />
          <KPICard label="AI Mentions" value={stats?.totalMentions ?? 0} icon={Eye} loading={statsLoading} tooltip="How many of those searches resulted in the AI actually mentioning your business by name." />
          <KPICard label="Mention Rate" value={`${stats?.mentionRate ?? 0}%`} icon={TrendingUp} loading={statsLoading} subtitle="Of all searches" tooltip="The percentage of AI searches where your business was mentioned. Higher is better — aim for 50%+." />
          <KPICard label="Avg Position" value={stats?.avgPosition ?? "N/A"} icon={Hash} loading={statsLoading} subtitle="When mentioned" tooltip="When your business is mentioned, where it appears in the AI's response. 1 means you're mentioned first." />
        </div>

        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap h-auto gap-1" data-testid="tabs-nav">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="trends" className="gap-1.5" data-testid="tab-trends">
              <TrendingUp className="w-3.5 h-3.5" />
              Trends
            </TabsTrigger>
            <TabsTrigger value="referrals" data-testid="tab-referrals">
              <MousePointerClick className="w-3.5 h-3.5 mr-1.5" />
              Referrals
            </TabsTrigger>
            <TabsTrigger value="competitors" data-testid="tab-competitors">
              <Users className="w-3.5 h-3.5 mr-1.5" />
              Competitors
            </TabsTrigger>
            <TabsTrigger value="snapshots" data-testid="tab-snapshots">
              <Camera className="w-3.5 h-3.5 mr-1.5" />
              AI Snapshots
            </TabsTrigger>
            <TabsTrigger value="content-gaps" data-testid="tab-content-gaps">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              Content Gaps
            </TabsTrigger>
            <TabsTrigger value="prompts" data-testid="tab-prompts">AI SEO Prompts</TabsTrigger>
            <TabsTrigger value="records" data-testid="tab-records">Search Log</TabsTrigger>
            <TabsTrigger value="settings" data-testid="tab-settings">
              <Settings className="w-3.5 h-3.5 mr-1.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* ========== OVERVIEW TAB ========== */}
          <TabsContent value="overview" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Mention Trend (30 days)<InfoTip text="Shows how often your business is mentioned by AI platforms over the last 30 days. The solid line is mentions, the dashed line is total searches." /></CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                  {trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trendData}>
                        <defs>
                          <linearGradient id="mentionGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                        <Area type="monotone" dataKey="mentions" stroke="hsl(var(--chart-1))" fill="url(#mentionGrad)" strokeWidth={2} name="Mentions" />
                        <Area type="monotone" dataKey="total" stroke="hsl(var(--chart-3))" fill="none" strokeWidth={1.5} strokeDasharray="4 4" name="Searches" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No data yet</div>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Platform Breakdown<InfoTip text="How well your business performs on each AI platform. The percentage shows your mention rate per platform." /></CardTitle>
                </CardHeader>
                <CardContent>
                  {platformBreakdown && platformBreakdown.length > 0 ? (
                    <div className="space-y-3">
                      {platformBreakdown.map((p: any) => {
                        const PIcon = platformIcons[p.platformName] || Globe;
                        const rate = p.total > 0 ? Math.round((p.mentions / p.total) * 100) : 0;
                        return (
                          <div key={p.platformId} className="flex items-center gap-3" data-testid={`platform-${p.platformName}`}>
                            <PIcon className="w-4 h-4 shrink-0" style={{ color: p.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-sm font-medium truncate">{p.platformName}</span>
                                <span className="text-xs text-muted-foreground">{rate}%</span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{ width: `${rate}%`, backgroundColor: p.color }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No platform data</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top Search Queries<InfoTip text="The most common AI queries related to your business. Green checkmarks mean you were mentioned in most searches for that query." /></CardTitle>
              </CardHeader>
              <CardContent>
                {records && records.length > 0 ? (
                  <div className="space-y-1">
                    {getTopQueries(records).map((q, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}</span>
                          <span className="text-sm truncate">{q.query}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-xs text-muted-foreground">{q.count} searches</span>
                          {q.mentionRate >= 50 ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-orange-400" />}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No search records yet</p>}
              </CardContent>
            </Card>

            {/* ── Visibility Scores (per-platform 0–100) ────────────── */}
            {visibilityScores && visibilityScores.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Platform Visibility Scores
                    <InfoTip text="Composite score: 50% mention rate + 20% position + 15% cross-validation + 15% source reliability. Grounded (web search) platforms are weighted higher than knowledge-only." />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {visibilityScores.map((v: any) => {
                      const PIcon = platformIcons[v.platformName] || Globe;
                      return (
                        <div key={v.platformId} className="flex items-center gap-3 p-3 rounded-lg border" data-testid={`visibility-${v.platformName}`}>
                          <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ backgroundColor: `${v.color}18` }}>
                            <PIcon className="w-5 h-5" style={{ color: v.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium">{v.platformName}</span>
                                {v.isGrounded ? (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-medium">LIVE WEB</span>
                                ) : (
                                  <span className="text-[9px] px-1 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 font-medium">KNOWLEDGE</span>
                                )}
                              </div>
                              <span className="text-lg font-bold tabular-nums" style={{ color: v.color }}>{v.score}</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v.score}%`, backgroundColor: v.color }} />
                            </div>
                            <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
                              <span>{v.mentionRate}% mention rate</span>
                              <span>{v.avgPosition ? `Pos ${v.avgPosition}` : "—"}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                              {v.validatedMentions > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400">{v.validatedMentions} verified</span>
                              )}
                              {v.outlierMentions > 0 && (
                                <span className="text-amber-600 dark:text-amber-400">{v.outlierMentions} outlier</span>
                              )}
                              {v.highConfMentions > 0 && (
                                <span>{v.highConfMentions} high-conf</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── Query Performance Table ────────────────────────── */}
            {queryPerf && queryPerf.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Query Performance
                    <InfoTip text="Detailed breakdown of every query: how often you're mentioned, your average position, and how many platforms covered." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                        <th className="pb-2 pr-4 font-medium">Query</th>
                        <th className="pb-2 pr-4 font-medium text-center">Runs</th>
                        <th className="pb-2 pr-4 font-medium text-center">Mentions</th>
                        <th className="pb-2 pr-4 font-medium text-center">Rate</th>
                        <th className="pb-2 pr-4 font-medium text-center">Avg Pos</th>
                        <th className="pb-2 pr-4 font-medium text-center">Sentiment</th>
                        <th className="pb-2 pr-4 font-medium text-center">Confidence</th>
                        <th className="pb-2 pr-4 font-medium text-center">Validation</th>
                        <th className="pb-2 font-medium text-center">Platforms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queryPerf.slice(0, 25).map((q: any, i: number) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 max-w-[300px] truncate">{q.query}</td>
                          <td className="py-2 pr-4 text-center tabular-nums">{q.runs}</td>
                          <td className="py-2 pr-4 text-center tabular-nums">{q.mentions}</td>
                          <td className="py-2 pr-4 text-center">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full ${
                              q.mentionRate >= 75 ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : q.mentionRate >= 40 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            }`}>
                              {q.mentionRate}%
                            </span>
                          </td>
                          <td className="py-2 pr-4 text-center tabular-nums">{q.avgPosition ?? "—"}</td>
                          <td className="py-2 pr-4 text-center">
                            {q.positiveSentiment > 0 || q.negativeSentiment > 0 ? (
                              <div className="flex items-center justify-center gap-1">
                                {q.positiveSentiment > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                    +{q.positiveSentiment}
                                  </span>
                                )}
                                {q.negativeSentiment > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                    -{q.negativeSentiment}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-center">
                            {q.highConfidence > 0 || q.mediumConfidence > 0 || q.lowConfidence > 0 ? (
                              <div className="flex items-center justify-center gap-1">
                                {q.highConfidence > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" title="High confidence">
                                    {q.highConfidence}H
                                  </span>
                                )}
                                {q.mediumConfidence > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="Medium confidence">
                                    {q.mediumConfidence}M
                                  </span>
                                )}
                                {q.lowConfidence > 0 && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" title="Low confidence">
                                    {q.lowConfidence}L
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {q.crossValidated > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" title="Cross-validated (platforms agree)">
                                  {q.crossValidated}<CheckCircle className="w-3 h-3 inline ml-0.5" />
                                </span>
                              )}
                              {q.outliers > 0 && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title="Outlier (disagrees with majority)">
                                  {q.outliers}<AlertTriangle className="w-3 h-3 inline ml-0.5" />
                                </span>
                              )}
                              {q.crossValidated === 0 && q.outliers === 0 && (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className="tabular-nums">{q.platformsCovered}</span>
                              {q.groundedRuns > 0 && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" title={`${q.groundedRuns} grounded, ${q.knowledgeRuns} knowledge-only`}>
                                  {q.groundedRuns}G
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ========== REFERRALS TAB ========== */}
          <TabsContent value="referrals" className="space-y-6 mt-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => window.open(`/api/businesses/${id}/export/referral-csv`, "_blank")} data-testid="button-export-referrals">
                <Download className="w-4 h-4 mr-1.5" />
                Export CSV
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPICard label="Click-throughs" value={referralStats?.totalReferrals ?? 0} icon={MousePointerClick} loading={refStatsLoading} subtitle="From AI mentions" tooltip="How many people visited your website after seeing your business mentioned by an AI platform." />
              <KPICard label="Click Rate" value={`${referralStats?.clickThroughRate ?? 0}%`} icon={ArrowRightLeft} loading={refStatsLoading} subtitle="Mentions to Visits" tooltip="What percentage of AI mentions resulted in someone actually visiting your website." />
              <KPICard label="Conversions" value={referralStats?.totalConversions ?? 0} icon={Target} loading={refStatsLoading} subtitle="Completed actions" tooltip="How many website visitors from AI searches took a meaningful action — like filling out a contact form, making a purchase, or calling." />
              <KPICard label="Conv. Rate" value={`${referralStats?.conversionRate ?? 0}%`} icon={TrendingUp} loading={refStatsLoading} subtitle="Visits to Actions" tooltip="The percentage of AI-referred visitors who converted into leads or customers." />
              <KPICard label="Avg Session" value={formatDuration(referralStats?.avgSessionDuration ?? 0)} icon={Clock} loading={refStatsLoading} subtitle="Time on site" tooltip="How long AI-referred visitors typically spend browsing your website." />
              <KPICard label="Pages/Visit" value={referralStats?.avgPagesViewed ?? 0} icon={FileText} loading={refStatsLoading} subtitle="Avg. depth" tooltip="How many pages AI-referred visitors view per visit. More pages usually means higher interest." />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">AI Search Conversion Funnel<InfoTip text="The journey from AI mention to website visit to customer action. Shows where you're losing potential customers." /></CardTitle>
                <CardDescription className="text-xs">How AI mentions convert into website visits and customer actions</CardDescription>
              </CardHeader>
              <CardContent>
                <ConversionFunnel
                  mentions={stats?.totalMentions ?? 0}
                  clickThroughs={referralStats?.totalReferrals ?? 0}
                  conversions={referralStats?.totalConversions ?? 0}
                />
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Card className="lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Referral Visits vs Conversions<InfoTip text="Daily breakdown of website visits from AI platforms versus actual conversions." /></CardTitle>
                </CardHeader>
                <CardContent className="h-64">
                  {refTrendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={refTrendData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                        <Bar dataKey="visits" fill="hsl(var(--chart-3))" name="Visits" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="conversions" fill="hsl(var(--chart-1))" name="Conversions" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No referral data yet</div>}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Conversion Types<InfoTip text="What actions AI-referred visitors take on your site — contact forms, purchases, sign-ups, phone calls, or bookings." /></CardTitle>
                </CardHeader>
                <CardContent>
                  {convPieData.length > 0 ? (
                    <div>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={convPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                              {convPieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                            </Pie>
                            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="space-y-2 mt-2">
                        {convPieData.map((item, i) => {
                          const CIcon = conversionIcons[conversionsByType?.[i]?.conversionType] || Target;
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 text-sm">
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.fill }} />
                                <CIcon className="w-3.5 h-3.5 text-muted-foreground" />
                                <span className="text-sm">{item.name}</span>
                              </div>
                              <span className="text-xs font-mono text-muted-foreground">{item.value}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : <p className="text-sm text-muted-foreground py-4 text-center">No conversions yet</p>}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Referrals by AI Platform<InfoTip text="Which AI platforms send the most visitors to your website and which drive the most conversions." /></CardTitle>
              </CardHeader>
              <CardContent>
                {referralsByPlatform && referralsByPlatform.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {referralsByPlatform.map((p: any) => {
                      const PIcon = platformIcons[p.platformName] || Globe;
                      const convRate = p.visits > 0 ? Math.round((p.conversions / p.visits) * 100) : 0;
                      return (
                        <div key={p.platformId} className="border rounded-lg p-4 space-y-2" data-testid={`ref-platform-${p.platformName}`}>
                          <div className="flex items-center gap-2">
                            <PIcon className="w-4 h-4" style={{ color: p.color }} />
                            <span className="text-sm font-medium">{p.platformName}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-center">
                            <div><p className="text-base font-semibold">{p.visits}</p><p className="text-xs text-muted-foreground">Visits</p></div>
                            <div><p className="text-base font-semibold">{p.conversions}</p><p className="text-xs text-muted-foreground">Converted</p></div>
                            <div><p className="text-base font-semibold">{convRate}%</p><p className="text-xs text-muted-foreground">Conv. Rate</p></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No referral data</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Top Queries Driving Traffic<InfoTip text="The specific AI search queries that send the most visitors to your website. Higher conversion rates mean that query attracts serious buyers." /></CardTitle>
              </CardHeader>
              <CardContent>
                {topReferralQueries && topReferralQueries.length > 0 ? (
                  <div className="space-y-1">
                    {topReferralQueries.map((q: any, i: number) => {
                      const convRate = q.visits > 0 ? Math.round((q.conversions / q.visits) * 100) : 0;
                      return (
                        <div key={i} className="flex items-center justify-between gap-4 py-2.5 px-1 rounded-md hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-xs text-muted-foreground font-mono w-5 text-right shrink-0">{i + 1}</span>
                            <span className="text-sm truncate">{q.query}</span>
                          </div>
                          <div className="flex items-center gap-4 shrink-0">
                            <div className="text-right">
                              <span className="text-xs font-medium">{q.visits} visits</span>
                              <span className="text-xs text-muted-foreground ml-2">{q.conversions} conv.</span>
                            </div>
                            <Badge variant={convRate >= 20 ? "default" : "secondary"} className="text-xs min-w-[3.5rem] justify-center">{convRate}%</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No referral queries yet</p>}
              </CardContent>
            </Card>

            <UTMGenerator businessId={id} businessWebsite={business.website} platforms={allPlatforms ?? []} />

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent Referral Activity<InfoTip text="A live feed of every website visit from an AI search, showing the query, platform, landing page, and whether they converted." /></CardTitle>
              </CardHeader>
              <CardContent>
                {allReferrals && allReferrals.length > 0 ? (
                  <div className="space-y-1 max-h-[400px] overflow-y-auto">
                    {allReferrals.slice(0, 40).map((ref) => {
                      const DeviceIcon = ref.deviceType === "mobile" ? Smartphone : ref.deviceType === "tablet" ? Tablet : Monitor;
                      const ConvIcon = ref.conversionType ? (conversionIcons[ref.conversionType] || Target) : null;
                      return (
                        <div key={ref.id} className="flex items-center gap-3 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors" data-testid={`referral-${ref.id}`}>
                          <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                            {ref.converted ? <CheckCircle className="w-4 h-4 text-green-500" /> : <MousePointerClick className="w-4 h-4 text-blue-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{ref.query}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <Badge variant="outline" className="text-xs h-5 px-1.5">{getPlatformName(ref.platformId)}</Badge>
                              <span className="text-xs text-muted-foreground flex items-center gap-1"><DeviceIcon className="w-3 h-3" />{ref.landingPage}</span>
                              {ref.converted && ConvIcon && (
                                <Badge className="text-xs h-5 px-1.5 gap-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100">
                                  <ConvIcon className="w-3 h-3" />{conversionLabels[ref.conversionType!] || ref.conversionType}
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">{formatDuration(ref.sessionDuration ?? 0)} &middot; {ref.pagesViewed}p</span>
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(ref.date).toLocaleDateString("en", { month: "short", day: "numeric" })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No referrals recorded</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== COMPETITORS TAB ========== */}
          <TabsContent value="competitors" className="space-y-6 mt-4">
            <CompetitorsSection businessId={id} competitors={competitorsData ?? []} stats={stats} />
          </TabsContent>

          {/* ========== AI SNAPSHOTS TAB ========== */}
          <TabsContent value="snapshots" className="space-y-6 mt-4">
            <SnapshotsSection snapshots={snapshotsData ?? []} getPlatformName={getPlatformName} />
          </TabsContent>

          {/* ========== CONTENT GAPS TAB ========== */}
          <TabsContent value="content-gaps" className="space-y-6 mt-4">
            <ContentGapsSection gaps={contentGapsData ?? []} />
          </TabsContent>

          {/* ========== PROMPTS TAB ========== */}
          <TabsContent value="prompts" className="space-y-6 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  AI SEO Optimized Prompts
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  These prompts represent the types of AI queries where your business should appear.
                </p>
              </CardHeader>
              <CardContent>
                {prompts && prompts.length > 0 ? (
                  <div className="space-y-4">
                    {prompts.map((prompt) => {
                      const cat = categoryConfig[prompt.category] || categoryConfig.discovery;
                      const CatIcon = cat.icon;
                      return (
                        <div key={prompt.id} className="border rounded-lg p-4 space-y-3" data-testid={`prompt-${prompt.id}`}>
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cat.color}`}>
                              <CatIcon className="w-3 h-3" />{cat.label}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-muted-foreground">Score</span>
                              <div className="flex items-center gap-1">
                                <div className="h-2 w-16 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${prompt.score}%`, backgroundColor: prompt.score >= 75 ? "#22c55e" : prompt.score >= 50 ? "#f59e0b" : "#ef4444" }} />
                                </div>
                                <span className="text-xs font-mono font-medium">{prompt.score}</span>
                              </div>
                            </div>
                          </div>
                          <p className="text-sm font-medium bg-muted/50 rounded-md px-3 py-2 font-mono">"{prompt.prompt}"</p>
                          <div className="flex items-start gap-2 text-xs text-muted-foreground bg-primary/5 rounded-md px-3 py-2">
                            <Target className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                            <span>{prompt.tip}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No optimized prompts generated yet</p>}
              </CardContent>
            </Card>

            {/* Schema Markup Recommendations */}
            <SchemaRecommendations businessId={id} />
          </TabsContent>

          {/* ========== RECORDS TAB ========== */}
          <TabsContent value="records" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => window.open(`/api/businesses/${id}/export/search-csv`, "_blank")} data-testid="button-export-search">
                <Download className="w-4 h-4 mr-1.5" />
                Export CSV
              </Button>
            </div>

            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <CardHeader className="cursor-pointer pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Plus className="w-4 h-4 text-primary" />
                        Log a Search Manually
                      </CardTitle>
                      {logOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </CardHeader>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="space-y-4 pt-0">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Platform</Label>
                        <Select value={logPlatform} onValueChange={setLogPlatform}>
                          <SelectTrigger data-testid="select-log-platform">
                            <SelectValue placeholder="Select platform" />
                          </SelectTrigger>
                          <SelectContent>
                            {allPlatforms?.map((p) => (
                              <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Query</Label>
                        <Input
                          placeholder="What did you search for?"
                          value={logQuery}
                          onChange={(e) => setLogQuery(e.target.value)}
                          data-testid="input-log-query"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">AI Response (optional)</Label>
                      <Textarea
                        placeholder="Paste the AI response text here..."
                        value={logResponse}
                        onChange={(e) => setLogResponse(e.target.value)}
                        rows={3}
                        data-testid="textarea-log-response"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <SwitchUI
                          checked={logMentioned}
                          onCheckedChange={setLogMentioned}
                          data-testid="switch-log-mentioned"
                        />
                        <Label className="text-sm">Business was mentioned</Label>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => logSearchMutation.mutate()}
                        disabled={!logPlatform || !logQuery.trim() || logSearchMutation.isPending}
                        data-testid="button-log-search"
                      >
                        {logSearchMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                        Log Search
                      </Button>
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Recent Search Activity<InfoTip text="A chronological log of every AI search tracked for your business, showing which platform, the query, and whether you were mentioned." /></CardTitle>
              </CardHeader>
              <CardContent>
                {records && records.length > 0 ? (
                  <div className="space-y-1 max-h-[500px] overflow-y-auto">
                    {records.slice(0, 50).map((record) => (
                      <div key={record.id} className="flex items-center gap-3 py-2 px-1 rounded-md hover:bg-muted/50 transition-colors" data-testid={`record-${record.id}`}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0">
                          {record.mentioned ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{record.query}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className="text-xs h-5 px-1.5">{getPlatformName(record.platformId)}</Badge>
                            {record.position && <span className="text-xs text-muted-foreground">Position #{record.position}</span>}
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {new Date(record.date).toLocaleDateString("en", { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground py-4 text-center">No search records</p>}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ========== TRENDS TAB ========== */}
          <TabsContent value="trends" className="space-y-6 mt-4">
            <QueryTrendsSection businessId={id} />
          </TabsContent>

          {/* ========== SETTINGS TAB ========== */}
          <TabsContent value="settings" className="space-y-6 mt-4">
            <PlatformHealthCard />
            <AIContextSettings businessId={id} business={business} />
            {/* Embed Click Tracker */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-primary" />
                  Click Tracker Snippet
                </CardTitle>
                <CardDescription className="text-xs">
                  Embed a lightweight JS snippet on your website to track clicks from AI search platforms.
                  No dependencies, no personal data, async and non-blocking.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button size="sm" onClick={() => setSnippetOpen(true)} className="gap-2">
                  <Code2 className="w-4 h-4" />
                  Embed Click Tracker
                </Button>
              </CardContent>
            </Card>

            <GA4Settings businessId={id} currentGa4Id={business.ga4Id ?? ""} />
            <LocationsSection businessId={id} locations={locationsData ?? []} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Snippet modal — rendered outside ScrollArea to avoid z-index issues */}
      {business && (
        <SnippetModal
          businessId={id}
          businessName={business.name}
          open={snippetOpen}
          onOpenChange={setSnippetOpen}
        />
      )}
    </ScrollArea>
  );
}

/* ============ QUERY TRENDS SECTION ============ */
function QueryTrendsSection({ businessId }: { businessId: number }) {
  const [selectedQuery, setSelectedQuery] = useState<string>("__all__");
  const [days, setDays] = useState(30);

  const { data, isLoading } = useQuery<{
    trends: { query: string; dataPoints: { date: string; mentionRate: number; avgPosition: number | null; total: number }[] }[];
  }>({
    queryKey: ["/api/businesses", businessId, "query-trends", { days }],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${businessId}/query-trends?days=${days}`);
      if (!res.ok) throw new Error("Failed to fetch query trends");
      return res.json();
    },
  });

  const trends = data?.trends ?? [];
  const queryOptions = trends.map((t) => t.query);

  // Build chart data
  let chartData: { date: string; mentionRate: number; avgPosition?: number | null }[] = [];
  if (selectedQuery === "__all__" && trends.length > 0) {
    const dateMap: Record<string, { totalMentionRate: number; count: number }> = {};
    for (const t of trends) {
      for (const dp of t.dataPoints) {
        if (!dateMap[dp.date]) dateMap[dp.date] = { totalMentionRate: 0, count: 0 };
        dateMap[dp.date].totalMentionRate += dp.mentionRate;
        dateMap[dp.date].count += 1;
      }
    }
    chartData = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, mentionRate: Math.round(v.totalMentionRate / v.count) }));
  } else {
    const match = trends.find((t) => t.query === selectedQuery);
    chartData = match?.dataPoints ?? [];
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          Query Trends Over Time
        </CardTitle>
        <CardDescription className="text-xs">Track how your mention rate and position change over time for each query.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Select value={selectedQuery} onValueChange={setSelectedQuery}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select a query" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Queries (aggregate)</SelectItem>
              {queryOptions.map((q) => (
                <SelectItem key={q} value={q}>{q}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(days)} onValueChange={(v) => setDays(parseInt(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="14">Last 14 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <Skeleton className="h-[300px] w-full" />
        ) : chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No trend data available for the selected period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={(v: string) => {
                  const d = new Date(v + "T00:00:00");
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11 }}
                domain={[0, 100]}
                tickFormatter={(v: number) => `${v}%`}
                label={{ value: "Mention Rate", angle: -90, position: "insideLeft", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
              />
              {selectedQuery !== "__all__" && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  reversed
                  domain={[1, "auto"]}
                  label={{ value: "Avg Position", angle: 90, position: "insideRight", style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" } }}
                />
              )}
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value: number, name: string) => {
                  if (name === "mentionRate") return [`${value}%`, "Mention Rate"];
                  if (name === "avgPosition") return [value, "Avg Position"];
                  return [value, name];
                }}
                labelFormatter={(label: string) => {
                  const d = new Date(label + "T00:00:00");
                  return d.toLocaleDateString();
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="mentionRate"
                stroke="hsl(var(--primary))"
                fill="hsl(var(--primary))"
                fillOpacity={0.15}
                strokeWidth={2}
                dot={{ r: 3 }}
                name="mentionRate"
              />
              {selectedQuery !== "__all__" && (
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgPosition"
                  stroke="hsl(var(--chart-2, 220 70% 50%))"
                  fill="hsl(var(--chart-2, 220 70% 50%))"
                  fillOpacity={0.08}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name="avgPosition"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ============ COMPETITORS SECTION ============ */
function CompetitorsSection({ businessId, competitors, stats }: { businessId: number; competitors: Competitor[]; stats: any }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const { toast } = useToast();

  const { data: compVisibility } = useQuery<any[]>({
    queryKey: ["/api/businesses", businessId, "competitor-visibility"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${businessId}/competitor-visibility`); return res.json(); },
    enabled: competitors.length > 0,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/businesses/${businessId}/competitors`, { name, website: website || null, businessId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "competitor-visibility"] });
      setName("");
      setWebsite("");
      toast({ title: "Competitor added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/competitors/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "competitor-visibility"] });
    },
  });

  const myMentionRate = stats?.mentionRate ?? 0;
  const hasCompVisData = compVisibility && compVisibility.some((c: any) => c.totalQueries > 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Add Competitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            <Input
              placeholder="Competitor name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-[200px]"
              data-testid="input-competitor-name"
            />
            <Input
              placeholder="Website (optional)"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="flex-1 min-w-[200px]"
              data-testid="input-competitor-website"
            />
            <Button onClick={() => addMutation.mutate()} disabled={!name.trim() || addMutation.isPending} data-testid="button-add-competitor">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {competitors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Mention Rate Comparison<InfoTip text="Side-by-side comparison of how often each competitor gets mentioned versus your business. If a competitor has a higher rate, they're more visible to AI users." /></CardTitle>
            <CardDescription className="text-xs">Your mention rate vs competitors across AI platforms</CardDescription>
          </CardHeader>
          <CardContent>
            {hasCompVisData ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium w-32 truncate">You</span>
                  <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full flex items-center justify-end pr-2" style={{ width: `${Math.max(myMentionRate, 2)}%` }}>
                      <span className="text-xs font-medium text-primary-foreground">{myMentionRate}%</span>
                    </div>
                  </div>
                </div>
                {competitors.map((comp) => {
                  const vis = compVisibility?.find((c: any) => c.competitorId === comp.id);
                  const compRate = vis?.mentionRate ?? 0;
                  const isHigher = compRate > myMentionRate;
                  return (
                    <div key={comp.id} data-testid={`competitor-${comp.id}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-sm w-32 truncate">{comp.name}</span>
                        <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full flex items-center justify-end pr-2 ${isHigher ? "bg-destructive/80" : "bg-emerald-500/80"}`}
                            style={{ width: `${Math.max(compRate, 2)}%` }}
                          >
                            <span className="text-xs font-medium text-white">{compRate}%</span>
                          </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => deleteMutation.mutate(comp.id)} data-testid={`button-delete-competitor-${comp.id}`}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      {vis && vis.platformBreakdown.length > 0 && (
                        <div className="ml-32 pl-3 mt-1 flex flex-wrap gap-2">
                          {vis.platformBreakdown.map((pb: any) => (
                            <span key={pb.platformName} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: pb.color }} />
                              {pb.platformName}: {pb.mentionRate}%
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">Competitor scans run automatically -- data will appear after the next scan</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {competitors.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Competitor Details<InfoTip text="Background information on each competitor you're tracking." /></CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {competitors.map((comp) => {
                const vis = compVisibility?.find((c: any) => c.competitorId === comp.id);
                return (
                  <div key={comp.id} className="flex items-center justify-between border rounded-lg p-3">
                    <div>
                      <p className="text-sm font-medium">{comp.name}</p>
                      {comp.website && <p className="text-xs text-muted-foreground">{comp.website}</p>}
                      {comp.notes && <p className="text-xs text-muted-foreground mt-0.5">{comp.notes}</p>}
                      {vis && vis.totalQueries > 0 && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {vis.mentions}/{vis.totalQueries} mentions | Avg position: {vis.avgPosition ?? "N/A"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {competitors.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No competitors tracked yet. Add one above to start comparing.</p>
          </CardContent>
        </Card>
      )}

      {competitors.length > 0 && <CompetitorPromptIntel businessId={businessId} />}
    </>
  );
}

/* ============ COMPETITIVE PROMPT INTELLIGENCE ============ */
type ContentBrief = {
  title: string;
  contentType: string;
  wordCount: number;
  outline: { heading: string; points: string[] }[];
  keywords: string[];
  callToAction: string;
  rationale: string;
};

function ContentBriefCard({ brief }: { brief: ContentBrief }) {
  const contentTypeLabels: Record<string, string> = {
    blog_post: "Blog Post", faq: "FAQ Page", landing_page: "Landing Page",
    guide: "Guide", comparison: "Comparison", case_study: "Case Study",
  };

  return (
    <div className="mt-2 border rounded-lg p-4 bg-muted/30 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold">{brief.title}</h4>
        <div className="flex gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[10px]">{contentTypeLabels[brief.contentType] || brief.contentType}</Badge>
          <Badge variant="outline" className="text-[10px]">{brief.wordCount} words</Badge>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium mb-1.5">Outline</p>
        <div className="space-y-2">
          {brief.outline.map((section, j) => (
            <div key={j}>
              <p className="text-xs font-medium text-primary">{section.heading}</p>
              <ul className="list-disc list-inside ml-2">
                {section.points.map((point, k) => (
                  <li key={k} className="text-[11px] text-muted-foreground">{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium mb-1">Keywords</p>
        <div className="flex flex-wrap gap-1">
          {brief.keywords.map((kw) => (
            <Badge key={kw} variant="outline" className="text-[10px]">{kw}</Badge>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium mb-0.5">Call to Action</p>
        <p className="text-xs text-muted-foreground">{brief.callToAction}</p>
      </div>

      <div className="border-t pt-2">
        <p className="text-xs font-medium mb-0.5">Why This Will Help</p>
        <p className="text-xs text-muted-foreground">{brief.rationale}</p>
      </div>
    </div>
  );
}

function CompetitorPromptIntel({ businessId }: { businessId: number }) {
  const [filter, setFilter] = useState<"all" | "losing" | "winning" | "tied">("all");
  const [briefs, setBriefs] = useState<Record<string, ContentBrief>>({});
  const [expandedBriefs, setExpandedBriefs] = useState<Record<string, boolean>>({});
  const [loadingBriefs, setLoadingBriefs] = useState<Record<string, boolean>>({});

  const generateBrief = async (query: string) => {
    setLoadingBriefs((prev) => ({ ...prev, [query]: true }));
    try {
      const res = await fetch(`/api/businesses/${businessId}/content-brief`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to generate brief");
      }
      const brief: ContentBrief = await res.json();
      setBriefs((prev) => ({ ...prev, [query]: brief }));
      setExpandedBriefs((prev) => ({ ...prev, [query]: true }));
    } catch (err: any) {
      console.error("Content brief generation failed:", err.message);
    } finally {
      setLoadingBriefs((prev) => ({ ...prev, [query]: false }));
    }
  };

  const { data, isLoading } = useQuery<{
    queries: {
      query: string;
      myMentionRate: number;
      myMentions: number;
      myTotal: number;
      myAvgPosition: number | null;
      mySentiment: string | null;
      competitors: { name: string; mentionRate: number; mentions: number; total: number; avgPosition: number | null }[];
      gap: number;
      status: "winning" | "losing" | "tied" | "no_data";
    }[];
    recommendations: { query: string; competitors: string[]; tip: string; priority: "high" | "medium" | "low" }[];
    summary: { totalQueries: number; winning: number; losing: number; tied: number };
  }>({
    queryKey: ["/api/businesses", businessId, "competitor-prompts"],
    queryFn: async () => { const res = await fetch(`/api/businesses/${businessId}/competitor-prompts`); return res.json(); },
  });

  if (isLoading) return <Card><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>;
  if (!data || data.queries.length === 0) return null;

  const filtered = filter === "all" ? data.queries.filter(q => q.status !== "no_data") : data.queries.filter(q => q.status === filter);

  return (
    <>
      {/* Recommendations Card */}
      {data.recommendations.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              Ranking Improvement Tips
              <InfoTip text="AI-generated recommendations based on queries where your competitors outrank you. Implement these to close visibility gaps." />
            </CardTitle>
            <CardDescription className="text-xs">Actionable steps to outrank competitors on key queries</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recommendations.map((rec, i) => (
                <div key={i} className="border rounded-lg p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono flex-1">{rec.query}</code>
                    <Badge variant={rec.priority === "high" ? "destructive" : rec.priority === "medium" ? "default" : "secondary"} className="text-[10px] shrink-0">
                      {rec.priority}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rec.competitors.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px]">{c}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{rec.tip}</p>
                  <div className="flex items-center gap-2 pt-1">
                    {briefs[rec.query] ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setExpandedBriefs((prev) => ({ ...prev, [rec.query]: !prev[rec.query] }))}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        {expandedBriefs[rec.query] ? "Hide Brief" : "Show Brief"}
                        {expandedBriefs[rec.query] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={loadingBriefs[rec.query]}
                        onClick={() => generateBrief(rec.query)}
                      >
                        {loadingBriefs[rec.query] ? (
                          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</>
                        ) : (
                          <><Sparkles className="w-3.5 h-3.5" /> Generate Brief</>
                        )}
                      </Button>
                    )}
                  </div>
                  {briefs[rec.query] && expandedBriefs[rec.query] && (
                    <ContentBriefCard brief={briefs[rec.query]} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Query-by-Query Comparison */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-primary" />
                Query-by-Query Comparison
                <InfoTip text="Compare your mention rate against competitors for each search query. 'Gap' shows how far ahead or behind the best competitor is." />
              </CardTitle>
              <CardDescription className="text-xs mt-1">See exactly which queries competitors win and where you lead</CardDescription>
            </div>
          </div>
          {/* Summary badges */}
          <div className="flex gap-2 mt-2 flex-wrap">
            <Badge
              variant={filter === "all" ? "default" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setFilter("all")}
            >
              All ({data.summary.totalQueries})
            </Badge>
            <Badge
              variant={filter === "losing" ? "destructive" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setFilter("losing")}
            >
              Losing ({data.summary.losing})
            </Badge>
            <Badge
              variant={filter === "winning" ? "default" : "outline"}
              className={`cursor-pointer text-xs ${filter === "winning" ? "bg-emerald-600" : ""}`}
              onClick={() => setFilter("winning")}
            >
              Winning ({data.summary.winning})
            </Badge>
            <Badge
              variant={filter === "tied" ? "secondary" : "outline"}
              className="cursor-pointer text-xs"
              onClick={() => setFilter("tied")}
            >
              Tied ({data.summary.tied})
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No queries match this filter.</p>
          ) : (
            <div className="space-y-3">
              {filtered.slice(0, 25).map((q, i) => (
                <div key={i} className="border rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">{q.query}</code>
                    <Badge
                      variant={q.status === "losing" ? "destructive" : q.status === "winning" ? "default" : "secondary"}
                      className={`text-[10px] shrink-0 ${q.status === "winning" ? "bg-emerald-600" : ""}`}
                    >
                      {q.status === "losing" ? `−${q.gap}%` : q.status === "winning" ? `+${Math.abs(q.gap)}%` : "Tied"}
                    </Badge>
                  </div>
                  {/* Bars */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] w-24 truncate font-medium">You</span>
                      <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.max(q.myMentionRate, 2)}%` }}
                        />
                      </div>
                      <span className="text-[10px] w-10 text-right font-medium">{q.myMentionRate}%</span>
                    </div>
                    {q.competitors.map((c) => {
                      const isAhead = c.mentionRate > q.myMentionRate;
                      return (
                        <div key={c.name} className="flex items-center gap-2">
                          <span className="text-[10px] w-24 truncate text-muted-foreground">{c.name}</span>
                          <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${isAhead ? "bg-destructive/70" : "bg-emerald-500/70"}`}
                              style={{ width: `${Math.max(c.mentionRate, 2)}%` }}
                            />
                          </div>
                          <span className="text-[10px] w-10 text-right text-muted-foreground">{c.mentionRate}%</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* Position & sentiment row */}
                  <div className="flex gap-3 mt-2 text-[10px] text-muted-foreground">
                    {q.myAvgPosition && <span>Your avg position: #{q.myAvgPosition}</span>}
                    {q.mySentiment && (
                      <span className={q.mySentiment === "positive" ? "text-emerald-600" : q.mySentiment === "negative" ? "text-destructive" : ""}>
                        Sentiment: {q.mySentiment}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length > 25 && (
                <p className="text-xs text-muted-foreground text-center">Showing top 25 of {filtered.length} queries</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ============ AI SNAPSHOTS SECTION ============ */
function SnapshotsSection({ snapshots, getPlatformName }: { snapshots: AiSnapshot[]; getPlatformName: (id: number) => string }) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <>
      {snapshots.length > 0 ? (
        <div className="space-y-3">
          {snapshots.map((snap) => {
            const sConfig = sentimentConfig[snap.sentiment] || sentimentConfig.neutral;
            const PIcon = platformIcons[getPlatformName(snap.platformId)] || Globe;
            const issues = snap.flaggedIssues ? JSON.parse(snap.flaggedIssues) as string[] : [];
            const isExpanded = expanded === snap.id;

            return (
              <Card key={snap.id} data-testid={`snapshot-${snap.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <PIcon className="w-5 h-5 mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium">{snap.query}</span>
                        <Badge className={sConfig.badge} data-testid={`badge-sentiment-${snap.id}`}>{snap.sentiment}</Badge>
                        {snap.mentionedAccurate ? (
                          <Badge variant="outline" className="text-xs text-green-600 border-green-300">Accurate</Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-red-600 border-red-300">Inaccurate</Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">{snap.date}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {isExpanded ? snap.responseText : snap.responseText.slice(0, 150) + (snap.responseText.length > 150 ? "..." : "")}
                      </p>
                      {snap.responseText.length > 150 && (
                        <Button variant="ghost" size="sm" className="mt-1 h-6 text-xs px-2" onClick={() => setExpanded(isExpanded ? null : snap.id)} data-testid={`button-expand-${snap.id}`}>
                          {isExpanded ? <><ChevronUp className="w-3 h-3 mr-1" />Less</> : <><ChevronDown className="w-3 h-3 mr-1" />More</>}
                        </Button>
                      )}
                      {issues.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {issues.map((issue, i) => (
                            <Badge key={i} variant="destructive" className="text-xs">{issue}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <Camera className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No AI snapshots recorded yet</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/* ============ CONTENT GAPS SECTION ============ */
function ContentGapsSection({ gaps }: { gaps: ContentGap[] }) {
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const sorted = [...gaps]
    .filter(g => typeFilter === "all" || g.contentType === typeFilter)
    .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));

  const priorityBadge: Record<string, string> = {
    high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-content-type-filter">
            <SelectValue placeholder="Content Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="blog_post">Blog Post</SelectItem>
            <SelectItem value="faq">FAQ</SelectItem>
            <SelectItem value="schema_markup">Schema Markup</SelectItem>
            <SelectItem value="landing_page">Landing Page</SelectItem>
            <SelectItem value="review_response">Review Response</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {sorted.length > 0 ? (
        <div className="space-y-3">
          {sorted.map((gap) => (
            <Card key={gap.id} data-testid={`content-gap-${gap.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge className={priorityBadge[gap.priority] || priorityBadge.medium}>{gap.priority}</Badge>
                      <Badge className={contentTypeBadge[gap.contentType] || ""}>{contentTypeLabel[gap.contentType] || gap.contentType}</Badge>
                      {gap.currentlyRanking ? (
                        <Badge variant="outline" className="text-xs text-green-600">Currently Ranking</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs text-red-600">Not Ranking</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium mb-1">{gap.query}</p>
                    <p className="text-xs text-muted-foreground">{gap.recommendedContent}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No content gaps identified</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/* ============ AI SEARCH CONTEXT SETTINGS ============ */
function PlatformHealthCard() {
  const { data: health, isLoading } = useQuery<{ provider: string; successCount: number; errorCount: number; successRate: number; avgResponseTime: number }[]>({
    queryKey: ["/api/platform-health"],
    queryFn: async () => { const res = await fetch("/api/platform-health"); return res.json(); },
  });

  const providerLabels: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Google Gemini", perplexity: "Perplexity" };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          Platform Health (Last 7 Days)
          <InfoTip text="Tracks the success rate and speed of each AI platform over the past 7 days. Green means reliable, yellow means occasional issues, red means frequent failures." />
        </CardTitle>
        <CardDescription className="text-xs">API reliability and response times</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : !health || health.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No health data yet — run a scan to start tracking.</p>
        ) : (
          <div className="space-y-3">
            {health.map((h) => (
              <div key={h.provider} className="flex items-center gap-3">
                <span className="text-sm w-28 truncate font-medium">{providerLabels[h.provider] ?? h.provider}</span>
                <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${h.successRate >= 90 ? "bg-emerald-500" : h.successRate >= 70 ? "bg-amber-500" : "bg-destructive"}`}
                    style={{ width: `${Math.max(h.successRate, 3)}%` }}
                  />
                </div>
                <span className={`text-xs font-medium w-12 text-right ${h.successRate >= 90 ? "text-emerald-600" : h.successRate >= 70 ? "text-amber-600" : "text-destructive"}`}>
                  {h.successRate}%
                </span>
                <span className="text-[10px] text-muted-foreground w-16 text-right">{h.avgResponseTime}ms</span>
                <span className="text-[10px] text-muted-foreground w-16 text-right">{h.successCount}✓ {h.errorCount}✗</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AIContextSettings({ businessId, business }: { businessId: number; business: Business }) {
  const [services, setServices] = useState((business as any).services ?? "");
  const [keywords, setKeywords] = useState((business as any).keywords ?? "");
  const [targetAudience, setTargetAudience] = useState((business as any).targetAudience ?? (business as any).target_audience ?? "");
  const [uniqueSellingPoints, setUniqueSellingPoints] = useState((business as any).uniqueSellingPoints ?? (business as any).unique_selling_points ?? "");
  const [knownCompetitors, setKnownCompetitors] = useState((business as any).competitors ?? (business as any).known_competitors ?? "");
  const [customQueries, setCustomQueries] = useState((business as any).customQueries ?? (business as any).custom_queries ?? "");
  const { toast } = useToast();

  const queryCount = customQueries.split("\n").filter((l: string) => l.trim()).length;

  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/businesses/${businessId}`, {
        services: services || null,
        keywords: keywords || null,
        targetAudience: targetAudience || null,
        uniqueSellingPoints: uniqueSellingPoints || null,
        competitors: knownCompetitors || null,
        customQueries: customQueries || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId] });
      toast({ title: "AI search context updated", description: "Next scan will use the new context for smarter queries." });
    },
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-0.5">AI Search Context</h3>
          <p className="text-xs text-muted-foreground">These fields help generate smarter, more targeted scan queries. The more detail you provide, the better your visibility tracking.</p>
        </div>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Services / Products</Label>
            <Input
              value={services}
              onChange={(e) => setServices(e.target.value)}
              placeholder="e.g. deep cleaning, move-out cleaning, office cleaning"
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">Comma-separated list of what you offer</p>
          </div>

          <div>
            <Label className="text-xs">Search Keywords</Label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. eco-friendly cleaning, same-day service, licensed and insured"
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">Terms you want to rank for in AI search</p>
          </div>

          <div>
            <Label className="text-xs">Target Audience</Label>
            <Input
              value={targetAudience}
              onChange={(e) => setTargetAudience(e.target.value)}
              placeholder="e.g. homeowners, property managers, small businesses"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">What Makes You Different</Label>
            <Textarea
              value={uniqueSellingPoints}
              onChange={(e) => setUniqueSellingPoints(e.target.value)}
              placeholder="e.g. All-natural products, 100% satisfaction guarantee, family-owned for 15 years"
              rows={2}
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-xs">Known Competitors</Label>
            <Input
              value={knownCompetitors}
              onChange={(e) => setKnownCompetitors(e.target.value)}
              placeholder="e.g. Merry Maids, Molly Maid, The Cleaning Authority"
              className="mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">We'll include comparison queries against these names</p>
          </div>

          <div>
            <Label className="text-xs">Custom Search Queries ({queryCount})</Label>
            <Textarea
              value={customQueries}
              onChange={(e) => setCustomQueries(e.target.value)}
              placeholder={"Move out cleaning\nHome deep clean\nHouse cleaning tips\nWhat is the best house cleaning service in Elmhurst IL\n..."}
              rows={8}
              className="mt-1 font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">One query per line. These exact queries will be sent to each AI platform during every scan. They run first, before auto-generated queries.</p>
          </div>
        </div>

        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
          Save Context
        </Button>
      </CardContent>
    </Card>
  );
}

/* ============ GA4 SETTINGS ============ */
function GA4Settings({ businessId, currentGa4Id }: { businessId: number; currentGa4Id: string }) {
  const [ga4Id, setGa4Id] = useState(currentGa4Id);
  const { toast } = useToast();

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/businesses/${businessId}`, { ga4Id: ga4Id || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId] });
      toast({ title: "GA4 settings saved" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Settings className="w-4 h-4 text-primary" />
          GA4 Integration
        </CardTitle>
        <CardDescription className="text-xs">Connect your Google Analytics 4 measurement ID</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">GA4 Measurement ID</label>
            <Input
              placeholder="G-XXXXXXXXXX"
              value={ga4Id}
              onChange={(e) => setGa4Id(e.target.value)}
              data-testid="input-ga4-id"
            />
          </div>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-ga4">
            Save
          </Button>
        </div>
        {ga4Id && (
          <div className="mt-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs text-green-600 dark:text-green-400">Connected: {ga4Id}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============ LOCATIONS SECTION ============ */
function LocationsSection({ businessId, locations }: { businessId: number; locations: BizLocation[] }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const { toast } = useToast();

  const addMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/businesses/${businessId}/locations`, { name, address, businessId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "locations"] });
      setName("");
      setAddress("");
      toast({ title: "Location added" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses", businessId, "locations"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <MapPin className="w-4 h-4 text-primary" />
          Locations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <Input
            placeholder="Location name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 min-w-[150px]"
            data-testid="input-location-name"
          />
          <Input
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="flex-1 min-w-[200px]"
            data-testid="input-location-address"
          />
          <Button onClick={() => addMutation.mutate()} disabled={!name.trim() || !address.trim() || addMutation.isPending} data-testid="button-add-location">
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </div>

        {locations.length > 0 ? (
          <div className="space-y-2">
            {locations.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between border rounded-lg p-3" data-testid={`location-${loc.id}`}>
                <div>
                  <p className="text-sm font-medium">{loc.name}</p>
                  <p className="text-xs text-muted-foreground">{loc.address}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteMutation.mutate(loc.id)} data-testid={`button-delete-location-${loc.id}`}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-2">No locations added yet</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ============ CONVERSION FUNNEL ============ */
function ConversionFunnel({ mentions, clickThroughs, conversions }: { mentions: number; clickThroughs: number; conversions: number }) {
  const maxVal = Math.max(mentions, 1);
  const steps = [
    { label: "AI Mentions", value: mentions, icon: Eye, pct: 100 },
    { label: "Website Visits", value: clickThroughs, icon: MousePointerClick, pct: mentions > 0 ? Math.round((clickThroughs / mentions) * 100) : 0 },
    { label: "Conversions", value: conversions, icon: Target, pct: mentions > 0 ? Math.round((conversions / mentions) * 100) : 0 },
  ];

  return (
    <div className="flex flex-col sm:flex-row items-stretch gap-3">
      {steps.map((step, i) => (
        <div key={i} className="flex-1 relative">
          <div
            className="rounded-lg p-4 flex flex-col items-center justify-center text-center transition-all"
            style={{
              backgroundColor: i === 0 ? "hsl(var(--chart-3) / 0.12)" : i === 1 ? "hsl(var(--chart-1) / 0.12)" : "hsl(160 60% 40% / 0.12)",
              minHeight: "5rem",
            }}
          >
            <step.icon className="w-5 h-5 mb-1.5" style={{ color: i === 0 ? "hsl(var(--chart-3))" : i === 1 ? "hsl(var(--chart-1))" : "hsl(160, 60%, 40%)" }} />
            <p className="text-lg font-semibold">{step.value}</p>
            <p className="text-xs text-muted-foreground">{step.label}</p>
            {i > 0 && <p className="text-xs font-medium mt-0.5" style={{ color: i === 1 ? "hsl(var(--chart-1))" : "hsl(160, 60%, 40%)" }}>{step.pct}% of mentions</p>}
          </div>
          {i < steps.length - 1 && (
            <div className="hidden sm:flex absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 z-10 w-6 h-6 rounded-full bg-background border items-center justify-center">
              <ArrowRightLeft className="w-3 h-3 text-muted-foreground" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============ UTM GENERATOR ============ */
function UTMGenerator({ businessId, businessWebsite, platforms }: { businessId: number; businessWebsite: string | null; platforms: Platform[] }) {
  const [baseUrl, setBaseUrl] = useState(businessWebsite || "https://");
  const [platform, setPlatform] = useState("");
  const [campaign, setCampaign] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/businesses/${businessId}/generate-utm`, { baseUrl, platform, campaign: campaign || undefined });
      return res.json();
    },
    onSuccess: (data) => { setGeneratedUrl(data.url); },
    onError: (err: Error) => { toast({ title: "Error", description: err.message, variant: "destructive" }); },
  });

  const copyUrl = () => {
    navigator.clipboard.writeText(generatedUrl).then(() => {
      toast({ title: "Copied to clipboard" });
    }).catch(() => {
      toast({ title: "Copy failed", variant: "destructive" });
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ExternalLink className="w-4 h-4 text-primary" />
          UTM Tracking Link Generator
        </CardTitle>
        <CardDescription className="text-xs">
          Create tracked URLs to measure when visitors arrive from your AI-optimized content.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Website URL</label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://yourbusiness.com" data-testid="input-utm-url" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">AI Platform</label>
            <Select onValueChange={setPlatform} value={platform}>
              <SelectTrigger data-testid="select-utm-platform"><SelectValue placeholder="Select platform" /></SelectTrigger>
              <SelectContent>
                {platforms.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Campaign (optional)</label>
            <Input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="e.g. spring-2026" data-testid="input-utm-campaign" />
          </div>
        </div>
        <Button onClick={() => generateMutation.mutate()} disabled={!baseUrl || !platform || generateMutation.isPending} size="sm" data-testid="button-generate-utm">
          Generate Tracking URL
        </Button>
        {generatedUrl && (
          <div className="flex items-center gap-2 bg-muted/50 rounded-md p-3">
            <code className="text-xs flex-1 break-all text-foreground" data-testid="text-generated-utm">{generatedUrl}</code>
            <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={copyUrl} data-testid="button-copy-utm">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============ HELPERS ============ */
function getTopQueries(records: SearchRecord[]) {
  const queryMap = new Map<string, { count: number; mentions: number }>();
  for (const r of records) {
    const existing = queryMap.get(r.query) || { count: 0, mentions: 0 };
    existing.count++;
    if (r.mentioned) existing.mentions++;
    queryMap.set(r.query, existing);
  }
  return Array.from(queryMap.entries())
    .map(([query, data]) => ({ query, count: data.count, mentionRate: Math.round((data.mentions / data.count) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}
