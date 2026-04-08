import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { insertBusinessSchema, type InsertBusiness } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertBusiness) => {
      const res = await apiRequest("POST", "/api/businesses", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/businesses"] });
      toast({ title: "Business added", description: "Demo tracking data has been generated." });
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
      <p className="text-sm text-muted-foreground mb-6">Enter your business details and we'll generate AI search tracking data with optimized prompt suggestions.</p>

      <Card>
        <CardContent className="p-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-5">
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
                        placeholder="Briefly describe what your business does, its unique selling points, and target audience..."
                        rows={3}
                        {...field}
                        data-testid="input-description"
                      />
                    </FormControl>
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
