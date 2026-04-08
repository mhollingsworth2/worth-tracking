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
import { Moon, Sun, Bell } from "lucide-react";
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
      <Route path="/business/:id" component={BusinessDetail} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 p-2 border-b shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-1">
              <AlertBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <Router hook={useHashLocation}>
              <AppRouter />
            </Router>
          </main>
        </div>
      </div>
    </SidebarProvider>
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
