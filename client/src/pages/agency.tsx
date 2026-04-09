import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Building2, Palette, Users, UserPlus, FileText, Loader2, Save, Eye,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Business, AgencySettings } from "@shared/schema";

interface AgencyClient {
  id: number;
  username: string;
  displayName: string;
  role: string;
  isActive: number;
  createdAt: string;
  assignedBusinessCount: number;
  assignedBusinessIds: number[];
}

interface ClientReport {
  business: { name: string; industry: string };
  mentionRate: number;
  avgPosition: number;
  topPlatform: string;
  trend: string;
  weekOverWeek: string;
  topQueries: { query: string; mentionRate: number }[];
  recommendations: string[];
  generatedAt: string;
}

export default function AgencyPage() {
  return (
    <div className="p-6 max-w-5xl space-y-8">
      <div>
        <h1 className="text-xl font-serif font-semibold flex items-center gap-2">
          <Palette className="w-5 h-5 text-primary" />
          Agency Mode
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your white-label branding, client accounts, and generate client-facing reports.
        </p>
      </div>

      <BrandingSection />
      <ClientManagementSection />
      <ClientReportsSection />
    </div>
  );
}

// ── Branding Section ──────────────────────────────────────────────────────────

function BrandingSection() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<AgencySettings | null>({
    queryKey: ["/api/agency/settings"],
  });

  const [agencyName, setAgencyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [customDomain, setCustomDomain] = useState("");
  const [footerText, setFooterText] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Initialize form when settings load
  if (settings && !initialized) {
    setAgencyName(settings.agencyName || "");
    setLogoUrl(settings.logoUrl || "");
    setPrimaryColor(settings.primaryColor || "#6366f1");
    setCustomDomain(settings.customDomain || "");
    setFooterText(settings.footerText || "");
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", "/api/agency/settings", {
        agencyName,
        logoUrl: logoUrl || null,
        primaryColor,
        customDomain: customDomain || null,
        footerText: footerText || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agency/settings"] });
      toast({ title: "Branding saved" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading branding settings...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Palette className="w-4 h-4 text-primary" />
          Agency Branding
        </CardTitle>
        <CardDescription className="text-xs">
          Customize the look and feel for your client-facing views.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Agency Name</Label>
            <Input
              value={agencyName}
              onChange={(e) => setAgencyName(e.target.value)}
              placeholder="My Agency"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Logo URL</Label>
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Primary Color</Label>
            <div className="flex items-center gap-2">
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#6366f1"
                className="flex-1"
              />
              <div
                className="w-10 h-10 rounded-md border shrink-0"
                style={{ backgroundColor: primaryColor }}
                title={primaryColor}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Custom Domain</Label>
            <Input
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="reports.youragency.com"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Footer Text</Label>
          <Input
            value={footerText}
            onChange={(e) => setFooterText(e.target.value)}
            placeholder="Powered by Your Agency Name"
          />
        </div>

        {/* Branding preview */}
        {agencyName && (
          <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Preview</p>
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-8 h-8 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-8 h-8 rounded flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: primaryColor }}>
                  {agencyName.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="font-semibold" style={{ color: primaryColor }}>{agencyName}</span>
            </div>
            {footerText && (
              <p className="text-xs text-muted-foreground border-t pt-2 mt-2">{footerText}</p>
            )}
          </div>
        )}

        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={!agencyName.trim() || saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Save Branding
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Client Management Section ─────────────────────────────────────────────────

function ClientManagementSection() {
  const { toast } = useToast();
  const { data: clients } = useQuery<AgencyClient[]>({ queryKey: ["/api/agency/clients"] });
  const { data: allBusinesses } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });

  const [showForm, setShowForm] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [selectedBizIds, setSelectedBizIds] = useState<number[]>([]);

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/agency/clients", {
        username,
        password,
        displayName,
        businessIds: selectedBizIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agency/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setDisplayName("");
      setUsername("");
      setPassword("");
      setSelectedBizIds([]);
      setShowForm(false);
      toast({ title: "Client created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleBiz = (id: number) => {
    setSelectedBizIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Client Management
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {clients?.length ?? 0} client account{(clients?.length ?? 0) !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            <UserPlus className="w-4 h-4 mr-1" />
            {showForm ? "Cancel" : "Add Client"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
            <p className="text-xs font-medium">New Client Account</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Display Name</Label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Client Name" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" />
              </div>
            </div>
            {allBusinesses && allBusinesses.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Assign Businesses</Label>
                <div className="flex flex-wrap gap-2">
                  {allBusinesses.map((biz) => (
                    <button
                      key={biz.id}
                      type="button"
                      onClick={() => toggleBiz(biz.id)}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors ${
                        selectedBizIds.includes(biz.id)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      <Building2 className="w-3 h-3" />
                      {biz.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Button
              size="sm"
              onClick={() => createMutation.mutate()}
              disabled={!displayName.trim() || !username.trim() || !password.trim() || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
              Create Client
            </Button>
          </div>
        )}

        {/* Clients table */}
        {clients && clients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Name</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Username</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Businesses</th>
                  <th className="pb-2 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium">{client.displayName}</td>
                    <td className="py-2.5 text-muted-foreground">@{client.username}</td>
                    <td className="py-2.5">
                      <Badge variant="secondary" className="text-xs">
                        <Building2 className="w-3 h-3 mr-1" />
                        {client.assignedBusinessCount}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <Badge variant={client.isActive ? "default" : "outline"} className="text-xs">
                        {client.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No client accounts yet. Click "Add Client" to create one.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Client Reports Section ────────────────────────────────────────────────────

function ClientReportsSection() {
  const { data: allBusinesses } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" />
          Client Reports
        </CardTitle>
        <CardDescription className="text-xs">
          Generate simplified, client-facing report cards for any tracked business.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {allBusinesses && allBusinesses.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-2">
              {allBusinesses.map((biz) => (
                <Button
                  key={biz.id}
                  size="sm"
                  variant={selectedBizId === biz.id ? "default" : "outline"}
                  onClick={() => setSelectedBizId(selectedBizId === biz.id ? null : biz.id)}
                >
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  {biz.name}
                </Button>
              ))}
            </div>
            {selectedBizId && <ReportCard businessId={selectedBizId} />}
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic">No businesses to generate reports for.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportCard({ businessId }: { businessId: number }) {
  const { data: report, isLoading, error } = useQuery<ClientReport>({
    queryKey: ["/api/agency/client-report", String(businessId)],
    queryFn: async () => {
      const res = await fetch(`/api/agency/client-report/${businessId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load report");
      return res.json();
    },
  });

  const { data: agencySettings } = useQuery<AgencySettings | null>({
    queryKey: ["/api/agency/settings"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> Generating report...
      </div>
    );
  }

  if (error || !report) {
    return <p className="text-sm text-destructive">Failed to generate report.</p>;
  }

  const trendColor = report.trend === "up" ? "text-green-600" : report.trend === "down" ? "text-red-600" : "text-muted-foreground";
  const brandColor = agencySettings?.primaryColor || "#6366f1";

  return (
    <div className="rounded-lg border bg-background print:border-none" id={`report-${businessId}`}>
      {/* Report header with agency branding */}
      <div className="p-5 border-b" style={{ borderBottomColor: brandColor }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {agencySettings?.logoUrl ? (
              <img src={agencySettings.logoUrl} alt="Logo" className="w-8 h-8 rounded object-contain" />
            ) : agencySettings?.agencyName ? (
              <div className="w-8 h-8 rounded flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: brandColor }}>
                {agencySettings.agencyName.charAt(0).toUpperCase()}
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-base">{report.business.name}</h3>
              <p className="text-xs text-muted-foreground">{report.business.industry} &middot; AI Search Visibility Report</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(report.generatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: brandColor }}>{report.mentionRate}%</p>
          <p className="text-xs text-muted-foreground">Mention Rate</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: brandColor }}>{report.avgPosition || "N/A"}</p>
          <p className="text-xs text-muted-foreground">Avg Position</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: brandColor }}>{report.topPlatform}</p>
          <p className="text-xs text-muted-foreground">Top Platform</p>
        </div>
        <div className="text-center">
          <p className={`text-2xl font-bold ${trendColor}`}>{report.weekOverWeek}</p>
          <p className="text-xs text-muted-foreground">Week over Week</p>
        </div>
      </div>

      {/* Top queries */}
      {report.topQueries.length > 0 && (
        <div className="px-5 pb-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Top Queries</p>
          <div className="space-y-2">
            {report.topQueries.map((q, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="truncate flex-1 mr-3">{q.query}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${q.mentionRate}%`, backgroundColor: brandColor }} />
                  </div>
                  <span className="text-xs font-medium w-8 text-right">{q.mentionRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {report.recommendations.length > 0 && (
        <div className="px-5 pb-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Recommendations</p>
          <ul className="space-y-1.5">
            {report.recommendations.map((rec, i) => (
              <li key={i} className="text-sm flex items-start gap-2">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5" style={{ backgroundColor: brandColor }}>
                  {i + 1}
                </span>
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer */}
      {agencySettings?.footerText && (
        <div className="px-5 py-3 border-t text-xs text-muted-foreground text-center">
          {agencySettings.footerText}
        </div>
      )}
    </div>
  );
}
