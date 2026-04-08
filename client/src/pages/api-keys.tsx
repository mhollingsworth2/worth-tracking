import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Bot, Brain, Sparkles, Search, CheckCircle, XCircle, Loader2, Trash2, Key, DollarSign, AlertTriangle, ShieldCheck, Pause, Play } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { InfoTip } from "@/components/info-tip";
import type { ApiKey } from "@shared/schema";

const PROVIDERS = [
  { id: "openai", name: "OpenAI", platform: "ChatGPT", icon: Bot, color: "#10a37f" },
  { id: "anthropic", name: "Anthropic", platform: "Claude", icon: Brain, color: "#d97706" },
  { id: "google", name: "Google", platform: "Google Gemini", icon: Sparkles, color: "#4285f4" },
  { id: "perplexity", name: "Perplexity", platform: "Perplexity", icon: Search, color: "#20808d" },
];

export default function ApiKeysPage() {
  const { toast } = useToast();
  const { data: apiKeys } = useQuery<ApiKey[]>({ queryKey: ["/api/api-keys"] });

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-serif font-semibold" data-testid="text-page-title">API Keys</h1>
        <p className="text-sm text-muted-foreground mt-1">Connect AI platform API keys to enable real search scans.</p>
      </div>

      <BudgetTracker />

      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const existing = apiKeys?.find((k) => k.provider === provider.id);
          return (
            <ProviderCard
              key={provider.id}
              provider={provider}
              existing={existing}
            />
          );
        })}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  existing,
}: {
  provider: typeof PROVIDERS[number];
  existing: ApiKey | undefined;
}) {
  const { toast } = useToast();
  const [keyInput, setKeyInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/api-keys", { provider: provider.id, apiKey: keyInput });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setKeyInput("");
      setTestResult(null);
      toast({ title: `${provider.name} key saved` });
    },
    onError: (err: any) => {
      toast({ title: "Error saving key", description: err.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/api-keys/${provider.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/api-keys"] });
      setTestResult(null);
      toast({ title: `${provider.name} key removed` });
    },
  });

  const handleTest = async () => {
    if (!keyInput.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/api-keys/test", { provider: provider.id, apiKey: keyInput });
      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  const Icon = provider.icon;
  const connected = !!existing;

  return (
    <Card data-testid={`card-provider-${provider.id}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${provider.color}15` }}>
              <Icon className="w-5 h-5" style={{ color: provider.color }} />
            </div>
            <div>
              <CardTitle className="text-sm font-medium">{provider.name}</CardTitle>
              <CardDescription className="text-xs">{provider.platform}</CardDescription>
            </div>
          </div>
          {connected ? (
            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-0">
              <CheckCircle className="w-3 h-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-muted-foreground">
              Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected && (
          <div className="flex items-center justify-between bg-muted/50 rounded-md px-3 py-2">
            <span className="text-sm text-muted-foreground font-mono">{existing.apiKey}</span>
            <Button
              variant="ghost" size="sm"
              className="text-destructive hover:text-destructive h-7"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              data-testid={`button-remove-${provider.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Remove
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            type="password"
            placeholder={connected ? "Enter new key to update..." : "Enter API key..."}
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            className="flex-1"
            data-testid={`input-key-${provider.id}`}
          />
          <Button
            variant="outline" size="sm"
            onClick={handleTest}
            disabled={!keyInput.trim() || testing}
            data-testid={`button-test-${provider.id}`}
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test"}
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!keyInput.trim() || saveMutation.isPending}
            data-testid={`button-save-${provider.id}`}
          >
            Save
          </Button>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-md ${testResult.success ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" : "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"}`} data-testid={`test-result-${provider.id}`}>
            {testResult.success ? (
              <>
                <CheckCircle className="w-4 h-4 shrink-0" />
                Connection successful
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 shrink-0" />
                {testResult.error || "Connection failed"}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BudgetTracker() {
  const { toast } = useToast();
  const { data: usage } = useQuery<any>({ queryKey: ["/api/usage/today"] });
  const { data: budget } = useQuery<any>({ queryKey: ["/api/settings/budget"] });
  const [editBudget, setEditBudget] = useState("");
  const [editing, setEditing] = useState(false);

  const budgetMutation = useMutation({
    mutationFn: async (data: { dailyBudget?: string; autoPauseEnabled?: boolean }) => {
      await apiRequest("PATCH", "/api/settings/budget", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/budget"] });
      queryClient.invalidateQueries({ queryKey: ["/api/usage/today"] });
      setEditing(false);
      toast({ title: "Budget updated" });
    },
  });

  const dailyBudget = parseFloat(budget?.dailyBudget ?? "10.00");
  const totalSpend = usage?.totalSpend ?? 0;
  const pctUsed = usage?.pctUsed ?? 0;
  const callCount = usage?.callCount ?? 0;
  const status = usage?.status ?? "ok";
  const autoPause = budget?.autoPauseEnabled ?? 1;

  const StatusIcon = status === "exceeded" ? AlertTriangle : status === "warning" ? AlertTriangle : ShieldCheck;
  const statusColor = status === "exceeded" ? "text-red-500" : status === "warning" ? "text-amber-500" : "text-green-500";
  const progressColor = status === "exceeded" ? "bg-red-500" : status === "warning" ? "bg-amber-500" : "";

  return (
    <Card data-testid="card-budget-tracker">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-medium">Daily API Budget<InfoTip text="Tracks how much you're spending on AI platform API calls today. Each scan costs a few fractions of a cent per query per platform." /></CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-4 h-4 ${statusColor}`} />
            <span className={`text-sm font-medium ${statusColor}`}>
              ${totalSpend.toFixed(3)} / ${dailyBudget.toFixed(2)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span>{callCount} API calls today</span>
            <span>{pctUsed}% of budget</span>
          </div>
          <div className="h-2.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${progressColor || "bg-primary"}`}
              style={{ width: `${Math.min(pctUsed, 100)}%` }}
            />
          </div>
          {status === "warning" && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Approaching daily budget limit
            </p>
          )}
          {status === "exceeded" && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Daily budget exceeded. {autoPause ? "Scans are paused." : "Scans will continue."}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 pt-2 border-t">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Budget limit:</span>
            {editing ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">$</span>
                <Input
                  type="number" step="1" min="1" max="1000"
                  value={editBudget}
                  onChange={(e) => setEditBudget(e.target.value)}
                  className="w-24 h-8 text-sm"
                  data-testid="input-budget"
                />
                <Button size="sm" className="h-7 text-xs" onClick={() => budgetMutation.mutate({ dailyBudget: editBudget })} data-testid="button-save-budget">
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditBudget(dailyBudget.toString()); setEditing(true); }} data-testid="button-edit-budget">
                ${dailyBudget.toFixed(2)}/day
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Auto-pause at limit</span>
            <Switch
              checked={!!autoPause}
              onCheckedChange={(checked) => budgetMutation.mutate({ autoPauseEnabled: checked })}
              data-testid="switch-auto-pause"
            />
          </div>
        </div>

        {usage?.byProvider && Object.keys(usage.byProvider).length > 0 && (
          <div className="pt-2 border-t">
            <span className="text-xs text-muted-foreground">Today's breakdown:</span>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {Object.entries(usage.byProvider as Record<string, { calls: number; cost: number }>).map(([provider, data]) => (
                <div key={provider} className="flex items-center justify-between text-xs bg-muted/50 rounded px-2 py-1.5">
                  <span className="capitalize">{provider}</span>
                  <span className="text-muted-foreground">{data.calls} calls / ${data.cost.toFixed(3)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
