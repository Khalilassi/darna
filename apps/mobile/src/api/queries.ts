import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import type { Schemas } from "@darna/api-client";
import { api, unwrap } from "./client";

export const qk = {
  projects: ["public", "projects"] as const,
  listing: (id: string) => ["listing", id] as const,
  favorites: ["favorites"] as const,
  conversations: ["conversations"] as const,
  messages: (id: string) => ["messages", id] as const,
  viewings: ["viewings"] as const,
  deals: ["deals"] as const,
  deal: (id: string) => ["deal", id] as const,
  notifications: ["notifications"] as const,
  notificationPrefs: ["notifications", "preferences"] as const,
  myProperties: ["properties", "mine"] as const,
  myListings: ["listings", "mine"] as const,
  myListing: (id: string) => ["listings", "mine", id] as const,
  performance: (id: string, days: number) => ["listings", "mine", id, "performance", days] as const,
  verifications: ["verifications"] as const,
  supportCases: ["support"] as const,
  priceHistory: (id: string) => ["listing", id, "price-history"] as const,
  market: (projectId: string, purpose: string, types: string[]) => ["public", "market", projectId, purpose, ...types] as const,
  savedSearches: ["saved-searches"] as const,
  savedSearchResults: (id: string) => ["saved-searches", id, "results"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: qk.projects, staleTime: 10 * 60_000, queryFn: async () => unwrap(await api.GET("/projects")) });
}

export function useListing(id: string) {
  return useQuery({
    queryKey: qk.listing(id),
    queryFn: async () => unwrap(await api.GET("/listings/{listing_id}", { params: { path: { listing_id: id } } })),
  });
}

export function useFavorites() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.favorites,
    enabled: status === "signedIn",
    queryFn: async () => unwrap(await api.GET("/listings/favorites")),
  });
}

export function useFavoriteIds(): Set<string> {
  const q = useFavorites();
  return new Set((q.data ?? []).map((l) => l.id));
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      const params = { params: { path: { listing_id: id } } };
      return unwrap(on ? await api.PUT("/listings/{listing_id}/favorite", params) : await api.DELETE("/listings/{listing_id}/favorite", params));
    },
    onSettled: (_d, _e, v) => {
      void qc.invalidateQueries({ queryKey: qk.favorites });
      void qc.invalidateQueries({ queryKey: qk.listing(v.id) });
    },
  });
}

export function useNotifications(enabled = true) {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.notifications,
    enabled: enabled && status === "signedIn",
    refetchInterval: 30_000,
    queryFn: async () => unwrap(await api.GET("/notifications", { params: { query: { limit: 50 } } })),
  });
}

export function useConversations() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.conversations,
    enabled: status === "signedIn",
    refetchInterval: 15_000,
    queryFn: async () => unwrap(await api.GET("/conversations")),
  });
}

export function useViewings() {
  const { status } = useAuth();
  return useQuery({ queryKey: qk.viewings, enabled: status === "signedIn", queryFn: async () => unwrap(await api.GET("/viewings")) });
}

export function useDeals() {
  const { status } = useAuth();
  return useQuery({ queryKey: qk.deals, enabled: status === "signedIn", queryFn: async () => unwrap(await api.GET("/deals")) });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: qk.deal(id),
    refetchInterval: 20_000,
    queryFn: async () => unwrap(await api.GET("/deals/{deal_id}", { params: { path: { deal_id: id } } })),
  });
}

export function useMyProperties() {
  return useQuery({ queryKey: qk.myProperties, queryFn: async () => unwrap(await api.GET("/properties/mine")) });
}

export function useMyListings() {
  return useQuery({ queryKey: qk.myListings, queryFn: async () => unwrap(await api.GET("/listings/mine")) });
}

export function useMyListing(id: string) {
  return useQuery({
    queryKey: qk.myListing(id),
    queryFn: async () => unwrap(await api.GET("/listings/mine/{listing_id}", { params: { path: { listing_id: id } } })),
  });
}

/** Owner-only daily activity, totals and funnel for one listing (`days` 7..180). */
export function useListingPerformance(id: string, days: number) {
  return useQuery({
    queryKey: qk.performance(id, days),
    queryFn: async () => unwrap(await api.GET("/listings/mine/{listing_id}/performance", { params: { path: { listing_id: id }, query: { days } } })),
  });
}

export function useVerifications() {
  return useQuery({ queryKey: qk.verifications, queryFn: async () => unwrap(await api.GET("/verifications")) });
}

export type PushPrefs = Record<string, boolean>;

export function useNotificationPrefs() {
  const { status } = useAuth();
  return useQuery({
    queryKey: qk.notificationPrefs,
    enabled: status === "signedIn",
    queryFn: async () => unwrap(await api.GET("/notifications/preferences")),
  });
}

/**
 * Toggles one push category. Optimistic: the switch flips at once; on failure only that category is
 * rolled back (other in-flight toggles are kept) and the error is surfaced by the caller.
 */
export function useSetNotificationPref() {
  const qc = useQueryClient();
  const mutationKey = ["setNotificationPref"];
  type Prefs = { push: PushPrefs };
  return useMutation({
    mutationKey,
    mutationFn: async ({ category, enabled }: { category: string; enabled: boolean }) =>
      unwrap(await api.PUT("/notifications/preferences", { body: { push: { [category]: enabled } } })),
    onMutate: async ({ category, enabled }) => {
      await qc.cancelQueries({ queryKey: qk.notificationPrefs });
      const previous = qc.getQueryData<Prefs>(qk.notificationPrefs)?.push[category];
      qc.setQueryData<Prefs>(qk.notificationPrefs, (old) => (old ? { push: { ...old.push, [category]: enabled } } : old));
      return { previous };
    },
    onError: (_e, { category }, ctx) => {
      if (ctx?.previous === undefined) return;
      qc.setQueryData<Prefs>(qk.notificationPrefs, (old) => (old ? { push: { ...old.push, [category]: ctx.previous! } } : old));
    },
    onSuccess: (server, { category }) => {
      qc.setQueryData<Prefs>(qk.notificationPrefs, (old) => (old ? { push: { ...old.push, [category]: server.push[category] ?? old.push[category] } } : server));
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey }) <= 1) void qc.invalidateQueries({ queryKey: qk.notificationPrefs });
    },
  });
}

export function usePriceHistory(id: string) {
  return useQuery({
    queryKey: qk.priceHistory(id),
    queryFn: async () => unwrap(await api.GET("/listings/{listing_id}/price-history", { params: { path: { listing_id: id } } })),
  });
}

export function useMarketSummary(projectId: string | undefined, purpose: "sale" | "rent", propertyTypes: Schemas["PropertyType"][], lang: string) {
  return useQuery({
    // The methodology text is localized by the server (Accept-Language), so the language is part of the key.
    queryKey: [...qk.market(projectId ?? "", purpose, propertyTypes), lang],
    enabled: !!projectId,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(await api.GET("/market/summary", { params: { query: { project_id: projectId!, purpose, property_type: propertyTypes, months: 12 } } })),
  });
}

/** Cash vs installments comparison; `discountRate` is a fraction (0.2 = 20%). Disabled until a rate is set. */
export function useCashComparison(listingId: string, discountRate: number | null, cashPrice: number | null, lang: string) {
  return useQuery({
    queryKey: ["listing", listingId, "compare", discountRate, cashPrice, lang], // assumption text is localized
    enabled: discountRate !== null,
    queryFn: async () =>
      unwrap(
        await api.GET("/listings/{listing_id}/financials/compare", {
          params: { path: { listing_id: listingId }, query: { discount_rate: discountRate!, ...(cashPrice ? { cash_price: cashPrice } : {}) } },
        }),
      ),
  });
}

export function useSavedSearches() {
  const { status } = useAuth();
  return useQuery({ queryKey: qk.savedSearches, enabled: status === "signedIn", queryFn: async () => unwrap(await api.GET("/saved-searches")) });
}

export function useCreateSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas["SavedSearchIn"]) => unwrap(await api.POST("/saved-searches", { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.savedSearches }),
  });
}

export function useUpdateSavedSearch() {
  const qc = useQueryClient();
  type List = Schemas["SavedSearchOut"][];
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string } & Schemas["SavedSearchUpdate"]) =>
      unwrap(await api.PATCH("/saved-searches/{saved_id}", { params: { path: { saved_id: id } }, body })),
    onMutate: async ({ id, ...body }) => {
      await qc.cancelQueries({ queryKey: qk.savedSearches });
      const previous = qc.getQueryData<List>(qk.savedSearches);
      qc.setQueryData<List>(qk.savedSearches, (old) =>
        old?.map((s) => (s.id === id ? { ...s, ...(body.name ? { name: body.name } : {}), ...(body.alerts_enabled != null ? { alerts_enabled: body.alerts_enabled } : {}) } : s)),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => ctx?.previous && qc.setQueryData(qk.savedSearches, ctx.previous),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.savedSearches }),
  });
}

export function useDeleteSavedSearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await api.DELETE("/saved-searches/{saved_id}", { params: { path: { saved_id: id } } })),
    onSuccess: (_d, id) => qc.setQueryData<Schemas["SavedSearchOut"][]>(qk.savedSearches, (old) => old?.filter((s) => s.id !== id)),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.savedSearches }),
  });
}
