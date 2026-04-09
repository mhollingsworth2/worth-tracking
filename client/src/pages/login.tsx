import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, Loader2, AlertCircle, Play } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

export default function Login() {
  const { login, loginWithDemo } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleDemo = async () => {
    setError("");
    setDemoLoading(true);
    try {
      await loginWithDemo();
    } catch (err: any) {
      setError(err.message || "Failed to load demo");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, hsl(214, 42%, 18%) 0%, hsl(214, 42%, 28%) 100%)" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: "hsl(196, 36%, 54%)" }}>
            <Search className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-serif font-semibold text-white" data-testid="text-login-title">Worth Tracking</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(196, 30%, 75%)" }}>AI Search Visibility Platform</p>
        </div>

        <Card className="border-0 shadow-2xl">
          <CardHeader className="pb-4 pt-6 text-center">
            <p className="text-sm text-muted-foreground">Sign in to your account</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2" data-testid="text-login-error">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-xs">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  data-testid="input-username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  data-testid="input-password"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={!username.trim() || !password.trim() || loading}
                data-testid="button-login"
              >
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Sign In
              </Button>
            </form>

            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-3 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleDemo}
              disabled={demoLoading}
              data-testid="button-demo"
            >
              {demoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {demoLoading ? "Loading demo..." : "Try Interactive Demo"}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center mt-2">
              See the platform in action with sample data — no account needed
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs mt-6" style={{ color: "hsl(196, 25%, 55%)" }}>
          Powered by Worth Creative
        </p>
      </div>
    </div>
  );
}
