import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Code2, Copy, CheckCheck, ExternalLink, Activity,
  MousePointerClick, Zap, Shield, Smartphone, Monitor,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface SnippetModalProps {
  businessId: number;
  businessName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SnippetModal({ businessId, businessName, open, onOpenChange }: SnippetModalProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  // Fetch the raw snippet text
  const { data: snippetText, isLoading: snippetLoading } = useQuery<string>({
    queryKey: ["/api/businesses", businessId, "snippet"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${businessId}/snippet`);
      return res.text();
    },
    enabled: open,
  });

  // Fetch snippet status (click counts)
  const { data: status } = useQuery<{
    active: boolean;
    clicksLast7Days: number;
    totalClicks: number;
    bySource: Record<string, number>;
    lastClickAt: string | null;
  }>({
    queryKey: ["/api/businesses", businessId, "snippet-status"],
    queryFn: async () => {
      const res = await fetch(`/api/businesses/${businessId}/snippet-status`);
      return res.json();
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });

  const handleCopy = () => {
    if (!snippetText) return;
    navigator.clipboard.writeText(snippetText).then(() => {
      setCopied(true);
      toast({ title: "Snippet copied to clipboard" });
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      toast({ title: "Copy failed — please select and copy manually", variant: "destructive" });
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Code2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">Embed Click Tracker</DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {businessName} — tracks AI-referred clicks on your website
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-5">

            {/* Status row */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge
                variant={status?.active ? "default" : "secondary"}
                className={`gap-1.5 ${status?.active ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100" : ""}`}
              >
                <Activity className="w-3 h-3" />
                {status?.active ? "Active — clicks detected" : "Not yet active"}
              </Badge>
              {status && status.clicksLast7Days > 0 && (
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <MousePointerClick className="w-3.5 h-3.5" />
                  <strong className="text-foreground">{status.clicksLast7Days}</strong> clicks in the last 7 days
                </span>
              )}
              {status && status.totalClicks > 0 && (
                <span className="text-xs text-muted-foreground">
                  {status.totalClicks} total
                </span>
              )}
            </div>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { icon: Zap, label: "Async — non-blocking" },
                { icon: Shield, label: "No personal data" },
                { icon: Smartphone, label: "Device detection" },
                { icon: Monitor, label: "Works on any site" },
              ].map(({ icon: Icon, label }) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                  <Icon className="w-3 h-3" />
                  {label}
                </span>
              ))}
            </div>

            {/* Snippet code block */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">JavaScript Snippet</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5"
                  onClick={handleCopy}
                  disabled={snippetLoading || !snippetText}
                >
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? "Copied!" : "Copy snippet"}
                </Button>
              </div>
              <div className="relative rounded-lg border bg-muted/40 overflow-hidden">
                {snippetLoading ? (
                  <div className="p-4 text-xs text-muted-foreground animate-pulse">Loading snippet...</div>
                ) : (
                  <pre className="p-4 text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-all font-mono text-foreground/80 max-h-64">
                    {snippetText}
                  </pre>
                )}
              </div>
            </div>

            {/* Installation steps */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium">Installation</h3>
              <ol className="space-y-2.5">
                {[
                  { step: "1", text: "Copy the snippet above using the button." },
                  {
                    step: "2",
                    text: (
                      <>
                        Paste it on your website just before the closing{" "}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">&lt;/body&gt;</code>{" "}
                        tag — in your HTML template, CMS theme, or tag manager.
                      </>
                    ),
                  },
                  { step: "3", text: "Save and deploy your site. No build step required." },
                  {
                    step: "4",
                    text: "Test by visiting your site from a ChatGPT or Perplexity link, then clicking any button or link. The click will appear in the Referrals tab within seconds.",
                  },
                ].map(({ step, text }) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center shrink-0 mt-0.5">
                      {step}
                    </span>
                    <span className="text-muted-foreground leading-relaxed">{text}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* What it tracks */}
            <div className="rounded-lg border p-4 space-y-3 bg-card">
              <h3 className="text-sm font-medium">What it tracks</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
                {[
                  "✓ Clicks on links and buttons",
                  "✓ Referrer (which AI platform sent them)",
                  "✓ Landing page path",
                  "✓ UTM parameters",
                  "✓ Device type (desktop / mobile / tablet)",
                  "✓ Timestamp",
                  "✗ No IP addresses",
                  "✗ No cookies or local storage",
                  "✗ No form data or personal info",
                  "✗ Respects Do Not Track",
                ].map((item) => (
                  <span key={item} className={item.startsWith("✗") ? "text-muted-foreground/60" : ""}>
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* Source breakdown */}
            {status && Object.keys(status.bySource).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Clicks by AI source (last 7 days)</h3>
                <div className="space-y-1.5">
                  {Object.entries(status.bySource)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, count]) => (
                      <div key={source} className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground capitalize">{source}</span>
                        <Badge variant="secondary" className="text-xs tabular-nums">{count}</Badge>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Last click */}
            {status?.lastClickAt && (
              <p className="text-xs text-muted-foreground">
                Last click recorded:{" "}
                <span className="text-foreground">
                  {new Date(status.lastClickAt).toLocaleString("en", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </span>
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-3">
          <a
            href="https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Uses sendBeacon for async delivery
          </a>
          <Button size="sm" onClick={handleCopy} disabled={snippetLoading || !snippetText} className="gap-1.5">
            {copied ? <CheckCheck className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy snippet"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
