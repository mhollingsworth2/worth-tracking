import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus, TrendingUp, Eye, Search, ArrowRight } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import type { Business } from "@shared/schema";

function StatCard({ label, value, icon: Icon, loading, tooltip }: { label: string; value: string | number; icon: any; loading: boolean; tooltip?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          {loading ? <Skeleton className="h-6 w-16 mb-1" /> : <p className="text-xl font-semibold" data-testid={`text-stat-${label.toLowerCase().replace(/\s/g, "-")}`}>{value}</p>}
          <p className="text-xs text-muted-foreground">{label}{tooltip && <InfoTip text={tooltip} />}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: businesses, isLoading } = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }

  const hasBiz = businesses && businesses.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" data-testid="text-page-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor how your businesses appear across AI search platforms</p>
        </div>
        <Link href="/add">
          <Button size="sm" data-testid="button-add-business">
            <Plus className="w-4 h-4 mr-1.5" />
            Add Business
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Businesses Tracked" value={businesses?.length ?? 0} icon={Building2} loading={isLoading} tooltip="The number of businesses you're monitoring across AI search platforms." />
        <StatCard label="AI Platforms" value={6} icon={Search} loading={false} tooltip="The AI search engines being tracked: ChatGPT, Perplexity, Gemini, Claude, Copilot, and Meta AI." />
        <StatCard label="Prompt Categories" value={5} icon={TrendingUp} loading={false} tooltip="Types of AI search queries analyzed: discovery, comparison, recommendation, local, and review." />
      </div>

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

function BusinessCard({ business }: { business: Business }) {
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/businesses", business.id, "stats"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${business.id}/stats`);
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
          {stats && (
            <div className="flex items-center gap-3 flex-wrap">
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
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
