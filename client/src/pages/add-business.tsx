import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { insertBusinessSchema, type InsertBusiness } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link } from "wouter";

const industries = [
  "Restaurant",
  "Technology",
  "Healthcare",
  "Retail",
  "Finance",
  "Education",
  "Real Estate",
  "Legal",
  "Marketing",
  "Fitness",
  "Beauty",
  "Automotive",
  "Construction",
  "Consulting",
  "Cleaning Services",
  "Other",
];

export default function AddBusiness() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const form = useForm<InsertBusiness>({
    resolver: zodResolver(insertBusinessSchema),
    defaultValues: {
      name: "",
      description: "",
      industry: "",
      website: "",
      location: "",
      keywords: "",
      services: "",
      targetAudience: "",
      uniqueSellingPoints: "",
      competitors: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertBusiness) => {
      const res = await apiRequest("POST", "/api/businesses", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      toast({ title: "Business added", description: "An AI scan is running in the background — real data will appear shortly." });
      navigate(`/business/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" data-testid="button-back">
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          Back
        </Button>
      </Link>

      <h1 className="text-xl font-semibold mb-1" data-testid="text-page-title">Add a Business</h1>
      <p className="text-sm text-muted-foreground mb-6">The more detail you provide, the better we can track your AI visibility with targeted queries.</p>

      <Card>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-5">

              {/* ── Core fields ──────────────────────────── */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Blue Bottle Coffee" {...field} data-testid="input-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Industry</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-industry">
                          <SelectValue placeholder="Select an industry" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {industries.map((ind) => (
                          <SelectItem key={ind} value={ind} data-testid={`option-${ind.toLowerCase()}`}>{ind}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="What does your business do? What makes it special?"
                        rows={3}
                        {...field}
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormDescription>Used to understand your business — not sent to AI platforms directly.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} value={field.value ?? ""} data-testid="input-website" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="location"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Location (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. San Francisco, CA" {...field} value={field.value ?? ""} data-testid="input-location" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* ── Rich context fields ──────────────────── */}
              <div className="border-t pt-5 mt-2">
                <p className="text-sm font-medium mb-1">AI Search Context</p>
                <p className="text-xs text-muted-foreground mb-4">These fields help us generate smarter, more targeted scan queries. Fill in what you can — all optional.</p>

                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="services"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Services / Products</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. deep cleaning, move-out cleaning, office cleaning, carpet shampooing"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-services"
                          />
                        </FormControl>
                        <FormDescription>Comma-separated list of what you offer.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="keywords"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Search Keywords</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. eco-friendly cleaning, same-day service, licensed and insured"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-keywords"
                          />
                        </FormControl>
                        <FormDescription>Terms you want to rank for in AI search results.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="targetAudience"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Target Audience</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. homeowners, property managers, small businesses, new parents"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-target-audience"
                          />
                        </FormControl>
                        <FormDescription>Who are your ideal customers?</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="uniqueSellingPoints"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>What Makes You Different</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="e.g. We use all-natural products, offer a 100% satisfaction guarantee, and have been family-owned for 15 years"
                            rows={2}
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-usp"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="competitors"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Known Competitors</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Merry Maids, Molly Maid, The Cleaning Authority"
                            {...field}
                            value={field.value ?? ""}
                            data-testid="input-competitors"
                          />
                        </FormControl>
                        <FormDescription>We'll include comparison queries against these names.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={mutation.isPending} data-testid="button-submit">
                {mutation.isPending ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                {mutation.isPending ? "Creating..." : "Start Tracking"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
