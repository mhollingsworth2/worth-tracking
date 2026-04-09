import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, AlertTriangle, Info, AlertCircle, Check, Filter } from "lucide-react";
import { InfoTip } from "@/components/info-tip";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import type { Alert } from "@shared/schema";

const severityConfig: Record<string, { icon: any; color: string; badge: string }> = {
  critical: { icon: AlertCircle, color: "text-red-500", badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  warning: { icon: AlertTriangle, color: "text-amber-500", badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  info: { icon: Info, color: "text-blue-500", badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const typeLabels: Record<string, string> = {
  mention_drop: "Mention Drop",
  competitor_outrank: "Competitor Outrank",
  platform_missing: "Platform Missing",
  accuracy_issue: "Accuracy Issue",
  anomaly: "Anomaly Detected",
};

export default function Alerts() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<string>("all");

  const { data: alertsData, isLoading } = useQuery<Alert[]>({
    queryKey: ["/api/alerts"],
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/alerts/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread-count"] });
    },
  });

  const filtered = (alertsData ?? []).filter((a) => {
    if (severityFilter !== "all" && a.severity !== severityFilter) return false;
    if (typeFilter !== "all" && a.type !== typeFilter) return false;
    if (readFilter === "unread" && a.isRead === 1) return false;
    if (readFilter === "read" && a.isRead === 0) return false;
    return true;
  });

  const unreadCount = (alertsData ?? []).filter(a => a.isRead === 0).length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-serif font-semibold flex items-center gap-2" data-testid="text-alerts-title">
            <Bell className="w-6 h-6 text-primary" />
            Alerts<InfoTip text="Notifications about important changes in your AI search visibility — like dropping mention rates, competitors outranking you, or inaccurate information being shared." />
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-1" data-testid="badge-unread-count">{unreadCount}</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor changes in your AI search visibility</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-muted-foreground" />
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-severity-filter">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="info">Info</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" data-testid="select-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="mention_drop">Mention Drop</SelectItem>
            <SelectItem value="competitor_outrank">Competitor Outrank</SelectItem>
            <SelectItem value="platform_missing">Platform Missing</SelectItem>
            <SelectItem value="accuracy_issue">Accuracy Issue</SelectItem>
            <SelectItem value="anomaly">Anomaly Detected</SelectItem>
          </SelectContent>
        </Select>

        <Select value={readFilter} onValueChange={setReadFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-read-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="unread">Unread</SelectItem>
            <SelectItem value="read">Read</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Bell className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No alerts match your filters</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {filtered.map((alert) => {
          const config = severityConfig[alert.severity] || severityConfig.info;
          const Icon = config.icon;
          return (
            <Card key={alert.id} className={alert.isRead === 0 ? "border-l-4 border-l-primary" : "opacity-75"}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={config.badge} data-testid={`badge-severity-${alert.id}`}>
                        {alert.severity}
                      </Badge>
                      <Badge variant="outline" data-testid={`badge-type-${alert.id}`}>
                        {typeLabels[alert.type] || alert.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground ml-auto">{alert.date}</span>
                    </div>
                    <p className="text-sm" data-testid={`text-alert-message-${alert.id}`}>{alert.message}</p>
                  </div>
                  {alert.isRead === 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markReadMutation.mutate(alert.id)}
                      data-testid={`button-mark-read-${alert.id}`}
                      className="shrink-0"
                    >
                      <Check className="w-4 h-4 mr-1" />
                      Mark Read
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
