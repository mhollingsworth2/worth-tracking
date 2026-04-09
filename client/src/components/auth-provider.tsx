import { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { SafeUser } from "@shared/schema";

interface AuthContextType {
  user: SafeUser | null;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  loginWithDemo: () => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
  isDemo: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing session on mount (cookie-based)
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Not authenticated");
      })
      .then((data: SafeUser) => {
        setUser(data);
        // Detect demo user on session restore
        if (data.username === "demo") setIsDemo(true);
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
    setIsDemo(false);
  }, []);

  const loginWithDemo = useCallback(async () => {
    const res = await fetch("/api/auth/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to load demo");
    }
    const data = await res.json();
    setToken(data.token);
    setUser(data.user);
    setIsDemo(true);
  }, []);

  const logout = useCallback(async () => {
    if (isDemo) {
      // Clean up demo data on logout
      await fetch("/api/auth/demo/clear", { method: "POST", credentials: "include" }).catch(() => {});
    }
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setToken(null);
    setIsDemo(false);
  }, [isDemo]);

  const isAdmin = user?.role === "admin";

  return (
    <AuthContext.Provider value={{ user, token, login, loginWithDemo, logout, isAdmin, isDemo, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
