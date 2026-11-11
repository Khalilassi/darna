import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
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
  myProperties: ["properties", "mine"] as const,
  myListings: ["listings", "mine"] as const,
  myListing: (id: string) => ["listings", "mine", id] as const,
  verifications: ["verifications"] as const,
  supportCases: ["support"] as const,
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

export function useVerifications() {
  return useQuery({ queryKey: qk.verifications, queryFn: async () => unwrap(await api.GET("/verifications")) });
}
