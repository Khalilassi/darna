import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ServiceProvidersPage from "@/app/(console)/services/providers/page";
import ReferralRequestsPage from "@/app/(console)/services/referrals/page";
import { ProviderForm } from "@/components/ProviderForm";
import type { AdminApi, Project, ServiceProvider, ServiceReferral } from "@/lib/adminApi";
import { MockAuthProvider } from "@/lib/auth";
import { EMPTY_PROVIDER_FORM, providerBody, validateProviderForm } from "@/lib/serviceProviders";
import type { Me } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";

const staff = (role: Me["role"]): Me => ({
  id: "99999999-9999-9999-9999-999999999999",
  email: `${role}@example.com`,
  full_name: `Sam ${role}`,
  phone: null,
  locale: "en",
  role,
  identity_verified_at: null,
  mfa_enabled_at: "2026-01-01T00:00:00Z",
  phone_verified_at: null,
  created_at: "2026-01-01T00:00:00Z",
  verification: { information_submitted: false, identity: "none", approved_ownership_claims: 0, pending_ownership_claims: 0 },
});

const madinaty: Project = { id: "p-madinaty", slug: "madinaty", name_en: "Madinaty", name_ar: "مدينتي", city_en: "New Cairo", city_ar: "القاهرة الجديدة", districts: [] };

const provider: ServiceProvider = {
  id: "11111111-1111-1111-1111-111111111111",
  category: "lawyer",
  name_en: "Demo Legal",
  name_ar: "قانوني تجريبي",
  description_en: "",
  description_ar: "",
  phone: null,
  email: "lawyer@example.com",
  website: null,
  license_number: "L-1",
  project_ids: [],
  referral_fee_disclosure_en: "Darna may receive a fee.",
  referral_fee_disclosure_ar: "قد تحصل دارنا على رسوم.",
  verified: false,
  is_active: true,
  verified_at: null,
  created_at: "2026-11-01T10:00:00Z",
};

const referral = (over: Partial<ServiceReferral> = {}): ServiceReferral => ({
  id: "22222222-2222-2222-2222-222222222222",
  provider_id: provider.id,
  provider_name: "Demo Legal",
  provider_name_ar: "قانوني تجريبي",
  user_name: "Bassem Buyer",
  user_phone: null,
  deal_id: null,
  message: "Need a contract review",
  status: "requested",
  created_at: "2026-11-10T10:00:00Z",
  ...over,
});

const wrap = (me: Me, api: Partial<AdminApi>, ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <MockAuthProvider me={me} api={api}>
        {ui}
      </MockAuthProvider>
    </ToastProvider>,
  );

describe("provider form validation", () => {
  const valid = { ...EMPTY_PROVIDER_FORM, category: "mover" as const, name_en: "Movers", name_ar: "نقل" };

  it("enforces the API phone pattern, URL and email", () => {
    expect(validateProviderForm(valid)).toEqual({});
    expect(validateProviderForm({ ...valid, phone: "12345" }).phone).toMatch(/8–15 digits/);
    expect(validateProviderForm({ ...valid, phone: "+20 100 123 4567" }).phone).toBeUndefined();
    expect(validateProviderForm({ ...valid, phone: "+20abc12345" }).phone).toBeDefined();
    expect(validateProviderForm({ ...valid, website: "example.com" }).website).toBeDefined();
    expect(validateProviderForm({ ...valid, website: "javascript:alert(1)" }).website).toBeDefined();
    expect(validateProviderForm({ ...valid, website: "https://movers.example.com" }).website).toBeUndefined();
    expect(validateProviderForm({ ...valid, email: "nope" }).email).toBeDefined();
    expect(validateProviderForm({ ...valid, name_ar: "x", category: "" })).toMatchObject({ name_ar: expect.any(String), category: expect.any(String) });
    expect(validateProviderForm({ ...valid, referral_fee_disclosure_en: "fee" }).referral_fee_disclosure_ar).toBeDefined();
  });

  it("sends empty optional fields as null and strips phone separators", () => {
    expect(providerBody({ ...valid, phone: "+20 100-123-4567", email: " ", website: "" })).toMatchObject({
      phone: "+201001234567", email: null, website: null, license_number: null, referral_fee_disclosure_en: null, project_ids: [],
    });
  });

  it("shows errors and does not submit an invalid form", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProviderForm projects={[madinaty]} submitLabel="Create provider" onSubmit={onSubmit} onCancel={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Phone (optional)"), "123");
    await userEvent.click(screen.getByRole("button", { name: "Create provider" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Phone (optional)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Choose a category/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Category"), "surveyor");
    await userEvent.type(screen.getByLabelText("Name (English)"), "Inspect Co");
    await userEvent.type(screen.getByLabelText("Name (Arabic)"), "فحص");
    await userEvent.clear(screen.getByLabelText("Phone (optional)"));
    await userEvent.type(screen.getByLabelText("Phone (optional)"), "+201001234567");
    await userEvent.click(screen.getByLabelText("Madinaty"));
    await userEvent.click(screen.getByRole("button", { name: "Create provider" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ category: "surveyor", name_en: "Inspect Co", project_ids: ["p-madinaty"] }));
  });
});

describe("service providers page", () => {
  it("lists providers and verifies one after confirmation", async () => {
    const updateProvider = vi.fn().mockResolvedValue({ ...provider, verified: true });
    const api: Partial<AdminApi> = {
      serviceProviders: vi.fn().mockResolvedValue([provider]),
      projects: vi.fn().mockResolvedValue([madinaty]),
      updateProvider,
    };
    wrap(staff("support"), api, <ServiceProvidersPage />);
    const row = (await screen.findByText("Demo Legal", { selector: "td > div" })).closest("tr")!;
    expect(within(row).getByText("unverified")).toBeInTheDocument();
    expect(within(row).getByText("All communities")).toBeInTheDocument();
    expect(within(row).getByText("yes")).toBeInTheDocument();

    await userEvent.click(within(row).getByRole("button", { name: "Verify Demo Legal" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/checked this provider/);
    expect(updateProvider).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark verified" }));
    await waitFor(() => expect(updateProvider).toHaveBeenCalledWith(provider.id, { verified: true }));
  });

  it("deactivates only after confirmation", async () => {
    const updateProvider = vi.fn().mockResolvedValue({ ...provider, is_active: false });
    wrap(staff("admin"), { serviceProviders: vi.fn().mockResolvedValue([provider]), projects: vi.fn().mockResolvedValue([]), updateProvider }, <ServiceProvidersPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate Demo Legal" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(updateProvider).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Deactivate Demo Legal" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(updateProvider).toHaveBeenCalledWith(provider.id, { is_active: false }));
  });

  it("blocks reviewers", () => {
    const serviceProviders = vi.fn();
    wrap(staff("reviewer"), { serviceProviders }, <ServiceProvidersPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(/No access/);
    expect(serviceProviders).not.toHaveBeenCalled();
  });
});

describe("referral requests page", () => {
  it("shows 'Not shared' when no phone was shared and marks a request contacted", async () => {
    const updateReferral = vi.fn().mockResolvedValue(referral({ status: "contacted" }));
    const serviceReferrals = vi.fn().mockResolvedValue([referral(), referral({ id: "33333333-3333-3333-3333-333333333333", user_name: "Tarek Tenant", user_phone: "+201005550000" })]);
    wrap(staff("support"), { serviceReferrals, updateReferral }, <ReferralRequestsPage />);
    const first = (await screen.findByText("Bassem Buyer")).closest("tr")!;
    expect(within(first).getByText("Not shared")).toBeInTheDocument();
    const second = screen.getByText("Tarek Tenant").closest("tr")!;
    expect(within(second).getByText("+201005550000")).toBeInTheDocument();
    expect(serviceReferrals).toHaveBeenCalledWith(["requested", "contacted"]);

    await userEvent.click(within(first).getByRole("button", { name: /Mark contacted/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Mark contacted" }));
    await waitFor(() => expect(updateReferral).toHaveBeenCalledWith(referral().id, { status: "contacted" }));
  });

  it("filters by status and offers no actions on closed requests", async () => {
    const serviceReferrals = vi.fn().mockResolvedValue([referral({ status: "completed" })]);
    wrap(staff("admin"), { serviceReferrals, updateReferral: vi.fn() }, <ReferralRequestsPage />);
    await userEvent.click(screen.getByLabelText("completed"));
    await waitFor(() => expect(serviceReferrals).toHaveBeenLastCalledWith(["requested", "contacted", "completed"]));
    const row = (await screen.findByText("Bassem Buyer")).closest("tr")!;
    expect(within(row).getByText("Closed")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });
});
