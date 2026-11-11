import type { Schemas } from "@darna/api-client";
import type { Call } from "./session";

export type QueueItem = Schemas["QueueItem"];
export type DecisionIn = Schemas["DecisionIn"];
export type VerificationKind = Schemas["VerificationKind"];
export type VerificationStatus = Schemas["VerificationStatus"];
export type AdminListing = Schemas["AdminListingOut"];
export type ListingStatus = Schemas["ListingStatus"];
export type ModerateIn = Schemas["ModerateIn"];
export type Dispute = Schemas["DisputeOut"];
export type DisputeStatus = Schemas["DisputeStatus"];
export type ResolveIn = Schemas["ResolveIn"];
export type Duplicate = Schemas["DuplicateCandidate"];
export type AdminUser = Schemas["AdminUserOut"];
export type UserUpdate = Schemas["UserUpdate"];
export type AdminDeal = Schemas["AdminDealOut"];
export type DealStatus = Schemas["DealStatus"];
export type SupportCase = Schemas["AdminCaseOut"];
export type SupportStatus = Schemas["SupportStatus"];
export type CaseUpdate = Schemas["CaseUpdate"];
export type AuditEntry = Schemas["AuditOut"];
export type ServiceProvider = Schemas["AdminProviderOut"];
export type ServiceCategory = Schemas["ServiceCategory"];
export type ProviderIn = Schemas["ProviderIn"];
export type ProviderPatch = Schemas["ProviderPatch"];
export type ServiceReferral = Schemas["AdminReferralOut"];
export type ReferralStatus = Schemas["ReferralStatus"];
export type ReferralStatusIn = Schemas["ReferralStatusIn"];
export type Project = Schemas["ProjectOut"];
export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export type Analytics = Schemas["AnalyticsOut"];
export type MfaSetup = Schemas["MfaSetupOut"];

export function makeAdminApi(call: Call) {
  return {
    analytics: () => call((c) => c.GET("/admin/analytics")),

    verifications: (query: { status?: VerificationStatus[]; kind?: VerificationKind; page?: number; page_size?: number }) =>
      call((c) => c.GET("/admin/verifications", { params: { query } })),
    decide: (id: string, body: DecisionIn) =>
      call((c) => c.POST("/admin/verifications/{vr_id}/decision", { params: { path: { vr_id: id } }, body })),
    signedUrl: (documentId: string) =>
      call((c) => c.POST("/documents/{document_id}/signed-url", { params: { path: { document_id: documentId } } })),

    listings: (query: { status?: ListingStatus[]; page?: number; page_size?: number }) =>
      call((c) => c.GET("/admin/listings", { params: { query } })),
    moderate: (id: string, body: ModerateIn) =>
      call((c) => c.POST("/admin/listings/{listing_id}/moderate", { params: { path: { listing_id: id } }, body })),

    disputes: (status?: DisputeStatus | null) =>
      call((c) => c.GET("/admin/disputes", { params: { query: status ? { status } : {} } })),
    resolveDispute: (id: string, body: ResolveIn) =>
      call((c) => c.POST("/admin/disputes/{dispute_id}/resolve", { params: { path: { dispute_id: id } }, body })),
    duplicates: () => call((c) => c.GET("/admin/duplicates")),

    users: (query: { q?: string; page?: number; page_size?: number }) => call((c) => c.GET("/admin/users", { params: { query } })),
    updateUser: (id: string, body: UserUpdate) =>
      call((c) => c.PATCH("/admin/users/{user_id}", { params: { path: { user_id: id } }, body })),

    deals: (status?: DealStatus[]) => call((c) => c.GET("/admin/deals", { params: { query: { status } } })),
    expireOffers: () => call((c) => c.POST("/admin/maintenance/expire-offers")),

    mfaSetup: (password: string, enrollmentCode?: string) =>
      call((c) => c.POST("/auth/mfa/setup", { body: { password, enrollment_code: enrollmentCode || null } })),
    issueMfaEnrollmentCode: (userId: string) =>
      call((c) => c.POST("/admin/users/{user_id}/mfa-enrollment-code", { params: { path: { user_id: userId } } })),
    mfaConfirm: (code: string) => call((c) => c.POST("/auth/mfa/confirm", { body: { code } })),
    mfaDisable: (code: string, password: string) => call((c) => c.POST("/auth/mfa/disable", { body: { code, password } })),

    support: (status?: SupportStatus[]) => call((c) => c.GET("/admin/support", { params: { query: { status } } })),
    updateCase: (id: string, body: CaseUpdate) =>
      call((c) => c.PATCH("/admin/support/{case_id}", { params: { path: { case_id: id } }, body })),

    projects: () => call((c) => c.GET("/projects")),
    serviceProviders: () => call((c) => c.GET("/admin/services/providers")),
    createProvider: (body: ProviderIn) => call((c) => c.POST("/admin/services/providers", { body })),
    updateProvider: (id: string, body: ProviderPatch) =>
      call((c) => c.PATCH("/admin/services/providers/{provider_id}", { params: { path: { provider_id: id } }, body })),
    serviceReferrals: (status?: ReferralStatus[]) => call((c) => c.GET("/admin/services/referrals", { params: { query: { status } } })),
    updateReferral: (id: string, body: ReferralStatusIn) =>
      call((c) => c.PATCH("/admin/services/referrals/{referral_id}", { params: { path: { referral_id: id } }, body })),

    audit: (query: { action?: string; entity_id?: string; page?: number; page_size?: number }) =>
      call((c) => c.GET("/admin/audit", { params: { query } })),
  };
}

export type AdminApi = ReturnType<typeof makeAdminApi>;
