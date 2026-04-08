import { BarChart3, Building2, Lightbulb, Plus, Bell, Search, KeyRound, Shield, LogOut } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth-provider";
import type { Business } from "@shared/schema";

const navItems = [
  { title: "Dashboard", url: "/", icon: BarChart3, adminOnly: false },
  { title: "Add Business", url: "/add", icon: Plus, adminOnly: false },
  { title: "Prompt Optimizer", url: "/optimizer", icon: Lightbulb, adminOnly: false },
  { title: "API Keys", url: "/api-keys", icon: KeyRound, adminOnly: true },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAdmin, logout } = useAuth();

  const { data: businesses, isLoading } = useQuery<Business[]>({
    queryKey: ["/api/businesses"],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/alerts/unread-count"],
  });
  const unreadCount = unreadData?.count ?? 0;

  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);

  return (
    <Sidebar>
      <SidebarHeader className="p-4 pb-2">
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Search className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight font-serif" data-testid="text-app-title">Worth Tracking</h1>
              <p className="text-xs text-muted-foreground leading-tight">AI Search Visibility</p>
            </div>
          </div>
        </Link>
        {user && (
          <div className="flex items-center gap-2 mt-3 px-1">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{user.displayName}</p>
            </div>
            <Badge variant={isAdmin ? "default" : "secondary"} className="text-[10px] h-4 px-1.5 shrink-0" data-testid="badge-user-role">
              {user.role}
            </Badge>
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location === "/admin"}>
                    <Link href="/admin" data-testid="link-admin">
                      <Shield className="w-4 h-4" />
                      <span>Admin Panel</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={location === "/alerts"}>
                  <Link href="/alerts" data-testid="link-alerts">
                    <Bell className="w-4 h-4" />
                    <span>Alerts</span>
                    {unreadCount > 0 && (
                      <Badge variant="destructive" className="ml-auto h-5 min-w-[1.25rem] px-1.5 text-xs" data-testid="badge-sidebar-alerts">
                        {unreadCount}
                      </Badge>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tracked Businesses</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isLoading && (
                <>
                  <SidebarMenuItem><Skeleton className="h-8 w-full" /></SidebarMenuItem>
                  <SidebarMenuItem><Skeleton className="h-8 w-full" /></SidebarMenuItem>
                </>
              )}
              {businesses?.map((biz) => (
                <SidebarMenuItem key={biz.id}>
                  <SidebarMenuButton asChild isActive={location === `/business/${biz.id}` || location === `/business/${biz.id}/prompts`}>
                    <Link href={`/business/${biz.id}`} data-testid={`link-business-${biz.id}`}>
                      <Building2 className="w-4 h-4" />
                      <span className="truncate">{biz.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {!isLoading && businesses?.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-2">No businesses yet</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground h-8 text-xs"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="w-3.5 h-3.5 mr-2" />
          Logout
        </Button>
        <p className="text-xs text-muted-foreground/60 font-medium tracking-wide uppercase" style={{ fontSize: '0.625rem' }}>Powered by Worth Creative</p>
      </SidebarFooter>
    </Sidebar>
  );
}
