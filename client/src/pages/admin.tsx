import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Shield, UserPlus, Trash2, Building2, X, Loader2, Users,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { SafeUser, Business } from "@shared/schema";

export default function AdminPage() {
  const { toast } = useToast();
  const { data: allUsers } = useQuery<SafeUser[]>({ queryKey: ["/api/admin/users"] });
  const { data: allBusinesses } = useQuery<Business[]>({ queryKey: ["/api/businesses"] });

  const customers = allUsers?.filter((u) => u.role === "customer") ?? [];
  const customerCount = customers.length;

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-serif font-semibold flex items-center gap-2" data-testid="text-admin-title">
          <Shield className="w-5 h-5 text-primary" />
          Admin Panel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Manage customer accounts and business assignments.</p>
      </div>

      <CreateCustomerForm customerCount={customerCount} />

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            All Users
          </h2>
          <Badge variant="secondary" data-testid="badge-customer-count">{customerCount}/5 customers</Badge>
        </div>

        {allUsers?.map((user) => (
          <UserCard key={user.id} user={user} businesses={allBusinesses ?? []} />
        ))}
      </div>
    </div>
  );
}

function CreateCustomerForm({ customerCount }: { customerCount: number }) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/admin/users", { username, password, displayName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setUsername("");
      setPassword("");
      setDisplayName("");
      toast({ title: "Customer created" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const atLimit = customerCount >= 5;

  return (
    <Card data-testid="card-create-customer">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          Create Customer Account
        </CardTitle>
        <CardDescription className="text-xs">
          {atLimit ? "Maximum 5 customers reached." : `${customerCount}/5 customer accounts used.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Username</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              disabled={atLimit}
              data-testid="input-new-username"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              disabled={atLimit}
              data-testid="input-new-password"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Display Name</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display Name"
              disabled={atLimit}
              data-testid="input-new-display-name"
            />
          </div>
        </div>
        <Button
          className="mt-3"
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={atLimit || !username.trim() || !password.trim() || !displayName.trim() || createMutation.isPending}
          data-testid="button-create-customer"
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <UserPlus className="w-4 h-4 mr-1" />}
          Create Customer
        </Button>
      </CardContent>
    </Card>
  );
}

function UserCard({ user, businesses }: { user: SafeUser; businesses: Business[] }) {
  const { toast } = useToast();
  const [assignBizId, setAssignBizId] = useState("");

  const { data: assignedIds } = useQuery<number[]>({
    queryKey: ["/api/admin/users", user.id, "businesses"],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${user.id}/businesses`, { credentials: "include" });
      return res.json();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/admin/users/${user.id}`, { isActive: !user.isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/admin/users/${user.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (businessId: number) => {
      await apiRequest("POST", `/api/admin/users/${user.id}/assign-business`, { businessId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", user.id, "businesses"] });
      setAssignBizId("");
      toast({ title: "Business assigned" });
    },
  });

  const unassignMutation = useMutation({
    mutationFn: async (businessId: number) => {
      await apiRequest("DELETE", `/api/admin/users/${user.id}/assign-business/${businessId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", user.id, "businesses"] });
      toast({ title: "Business unassigned" });
    },
  });

  const assigned = assignedIds ?? [];
  const assignedBizzes = businesses.filter((b) => assigned.includes(b.id));
  const unassignedBizzes = businesses.filter((b) => !assigned.includes(b.id));

  return (
    <Card data-testid={`card-user-${user.id}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium text-primary">
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{user.displayName}</span>
                <Badge variant={user.role === "admin" ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
                  {user.role}
                </Badge>
                {!user.isActive && (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Inactive</Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">@{user.username}</span>
            </div>
          </div>

          {user.role === "customer" && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Active</span>
                <Switch
                  checked={!!user.isActive}
                  onCheckedChange={() => toggleMutation.mutate()}
                  data-testid={`switch-active-${user.id}`}
                />
              </div>
              <Button
                variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                data-testid={`button-delete-user-${user.id}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>

        {user.role === "customer" && (
          <div className="space-y-2 pt-2 border-t">
            <span className="text-xs text-muted-foreground font-medium">Assigned Businesses:</span>
            {assignedBizzes.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {assignedBizzes.map((biz) => (
                  <Badge key={biz.id} variant="secondary" className="text-xs flex items-center gap-1 pr-1">
                    <Building2 className="w-3 h-3" />
                    {biz.name}
                    <button
                      onClick={() => unassignMutation.mutate(biz.id)}
                      className="ml-0.5 hover:bg-muted rounded p-0.5"
                      data-testid={`button-unassign-${user.id}-${biz.id}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No businesses assigned</p>
            )}

            {unassignedBizzes.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <Select value={assignBizId} onValueChange={setAssignBizId}>
                  <SelectTrigger className="h-8 text-xs w-48" data-testid={`select-assign-${user.id}`}>
                    <SelectValue placeholder="Assign a business..." />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedBizzes.map((biz) => (
                      <SelectItem key={biz.id} value={String(biz.id)}>{biz.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm" className="h-8 text-xs"
                  disabled={!assignBizId || assignMutation.isPending}
                  onClick={() => assignMutation.mutate(parseInt(assignBizId))}
                  data-testid={`button-assign-${user.id}`}
                >
                  Assign
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
