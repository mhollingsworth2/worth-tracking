import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, TrendingUp, Eye, Search, ArrowRight, ArrowUpRight, ArrowDownRight, Hash, Minus } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import type { Business } from "@shared/schema";

// ─── Types ──────────────────────────────────────────────────────────────────
interface DashboardSummary {
  businessCount: number;
  totalSearches: number;
  totalMentions: number;
  mentionRate: number;
  avgPosition: number | null;
  topPlatform: { name: string; color: string; mentions: number } | null;
  mentionsThisWeek: number;
  mentionsLastWeek: number;
  weekDelta: number;
}

// ─── Small helpers ──────────────────────────────────────────────────────────
function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-green-600 dark:text-green-400">
        <ArrowUpRight className="w-3 h-3" /> +{delta}%
      </span>
    );
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-red-500 dark:text-red-400">
        <ArrowDownRight className="w-3 h-3" /> {delta}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
      <Minus className="w-3 h-3" /> 0%
    </span>
  );
}

function KpiCell({ label, value, delta, tooltip, loading }: {
  label: string; value: string | number; delta?: number; tooltip?: string; loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-[120px]">
      <span className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">
        {label}{tooltip && <InfoTip text={tooltip} />}
      </span>
      {loading ? <Skeleton className="h-7 w-16" /> : (
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums" data-testid={`text-kpi-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</span>
          {delta !== undefined && <DeltaBadge delta={delta} />}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: businesses, isLoading } = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      </div>
    );
  }

  const hasBiz = businesses && businesses.length > 0;
  const kpiLoading = summaryLoading;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">AI search visibility at a glance</p>
        </div>
        <Link href="/add">
          <Button size="sm" data-testid="button-add-business">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Business
          </Button>
        </Link>
      </div>

      {/* KPI Strip */}
      <Card>
        <CardContent className="py-4 px-5 flex flex-wrap items-center gap-x-8 gap-y-4 divide-x divide-border [&>*:first-child]:pl-0 [&>*]:pl-6">
          <KpiCell label="Businesses" value={summary?.businessCount ?? 0} loading={kpiLoading} tooltip="The number of businesses you're monitoring across AI search platforms." />
          <KpiCell label="Total Searches" value={summary?.totalSearches ?? 0} loading={kpiLoading} tooltip="Total AI search queries tracked across all businesses." />
          <KpiCell label="Mentions" value={summary?.totalMentions ?? 0} delta={summary?.weekDelta} loading={kpiLoading} tooltip="Times your business was organically mentioned. Week-over-week change shown." />
          <KpiCell label="Mention Rate" value={`${summary?.mentionRate ?? 0}%`} loading={kpiLoading} tooltip="Percentage of AI search queries where your business was mentioned." />
          <KpiCell label="Avg Position" value={summary?.avgPosition ?? "—"} loading={kpiLoading} tooltip="Average sentence position when mentioned (1 = first sentence)." />
          {summary?.topPlatform && (
            <KpiCell label="Top Platform" value={summary.topPlatform.name} loading={kpiLoading} tooltip={`${summary.topPlatform.mentions} mentions — your strongest AI channel.`} />
          )}
        </CardContent>
      </Card>

      {/* Business list */}
      {!hasBiz ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <Building2 className="w-7 h-7 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1" data-testid="text-empty-state">No businesses tracked yet</h3>
            <p className="text-sm text-muted-foreground mb-5 max-w-sm">
              Add a business to start tracking its visibility across AI search platforms like ChatGPT, Perplexity, Gemini, and more.
            </p>
            <Link href="/add">
              <Button data-testid="button-add-first">
                <Plus className="w-4 h-4 mr-1.5" />
                Add Your First Business
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Your Businesses</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {businesses?.map((biz) => (
              <BusinessCard key={biz.id} business={biz} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Business Card (with mini visibility bars) ──────────────────────────────
interface VisibilityScore {
  platformName: string;
  color: string;
  score: number;
  mentionRate: number;
}

function BusinessCard({ business }: { business: Business }) {
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/businesses", business.id, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${business.id}/stats`);
      return res.json();
    },
  });

  const { data: visibility } = useQuery<VisibilityScore[]>({
    queryKey: ["/api/businesses", business.id, "visibility-scores"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${business.id}/visibility-scores`);
      return res.json();
    },
  });

  return (
    <Link href={`/business/${business.id}`}>
      <Card className="cursor-pointer transition-all hover:shadow-md group" data-testid={`card-business-${business.id}`}>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{business.name}</h3>
              <p className="text-xs text-muted-foreground">{business.industry}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{business.description}</p>

          {/* Stat badges */}
          {stats && (
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <Badge variant="secondary" className="text-xs gap-1">
                <Eye className="w-3 h-3" />
                {stats.totalMentions} mentions
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1">
                <TrendingUp className="w-3 h-3" />
                {stats.mentionRate}% rate
              </Badge>
              <Badge variant="secondary" className="text-xs gap-1">
                <Search className="w-3 h-3" />
                {stats.totalSearches} searches
              </Badge>
              {stats.avgPosition && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Hash className="w-3 h-3" />
                  Pos {stats.avgPosition}
                </Badge>
              )}
            </div>
          )}

          {/* Mini platform visibility bars */}
          {visibility && visibility.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t">
              {visibility.slice(0, 4).map((v) => (
                <div key={v.platformName} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-20 truncate">{v.platformName}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${v.score}%`, backgroundColor: v.color }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">{v.score}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
