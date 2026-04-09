import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { Moon, Sun, Bell, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import Dashboard from "@/pages/dashboard";
import AddBusiness from "@/pages/add-business";
import BusinessDetail from "@/pages/business-detail";
import Optimizer from "@/pages/optimizer";
import Alerts from "@/pages/alerts";
import ApiKeys from "@/pages/api-keys";
import Admin from "@/pages/admin";
import Agency from "@/pages/agency";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} data-testid="button-theme-toggle" className="h-8 w-8">
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function AlertBell() {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/alerts/unread-count"],
  });
  const count = data?.count ?? 0;

  return (
    <a href="#/alerts" data-testid="button-alerts-bell">
      <Button variant="ghost" size="icon" className="h-8 w-8 relative">
        <Bell className="w-4 h-4" />
        {count > 0 && (
          <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-1 text-[10px] flex items-center justify-center" data-testid="badge-alert-count">
            {count}
          </Badge>
        )}
      </Button>
    </a>
  );
}

function AppRouter() {
  const { isAdmin } = useAuth();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/add" component={AddBusiness} />
      <Route path="/optimizer" component={Optimizer} />
      <Route path="/alerts" component={Alerts} />
      {isAdmin && <Route path="/api-keys" component={ApiKeys} />}
      {isAdmin && <Route path="/admin" component={Admin} />}
      {isAdmin && <Route path="/agency" component={Agency} />}
      <Route path="/business/:id" component={BusinessDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function DemoBanner() {
  const { isDemo, logout } = useAuth();
  if (!isDemo) return null;

  return (
    <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm shrink-0">
      <div className="flex items-center gap-2">
        <Play className="w-4 h-4" />
        <span className="font-medium">Demo Mode</span>
        <span className="hidden sm:inline opacity-90">— You're viewing sample data for a fictional dental practice. All data is generated for demonstration purposes.</span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="text-white hover:bg-white/20 h-7 px-2 text-xs"
        onClick={logout}
      >
        <X className="w-3 h-3 mr-1" />
        Exit Demo
      </Button>
    </div>
  );
}

function AuthenticatedApp() {
  return (
    <Router hook={useHashLocation}>
      <SidebarProvider>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <DemoBanner />
            <header className="flex items-center justify-between gap-2 p-2 border-b shrink-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="flex items-center gap-1">
                <AlertBell />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto">
              <AppRouter />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </Router>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AppContent />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
