import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@darna/api-client";
import LoginPage from "@/app/login/page";
import SecurityPage from "@/app/(console)/security/page";
import UsersPage from "@/app/(console)/users/page";
import { NavList } from "@/components/Shell";
import type { AdminApi } from "@/lib/adminApi";
import { MockAuthProvider } from "@/lib/auth";
import type { Me } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => "/security" }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") } }));

const reviewer: Me = {
  id: "99999999-9999-9999-9999-999999999999",
  email: "reviewer@example.com",
  full_name: "Rana Reviewer",
  phone: null,
  locale: "en",
  role: "reviewer",
  identity_verified_at: null,
  mfa_enabled_at: null,
  phone_verified_at: null,
  created_at: "2026-11-01T10:00:00Z",
  verification: { information_submitted: false, identity: "none", approved_ownership_claims: 0, pending_ownership_claims: 0 },
};

beforeEach(() => replace.mockReset());

describe("login second factor", () => {
  it("asks for a code after mfa_required and resubmits with it", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "mfa_required", "Two-factor code required"))
      .mockResolvedValueOnce(reviewer);
    render(
      <MockAuthProvider me={null} api={{}} status="anonymous" login={login}>
        <LoginPage />
      </MockAuthProvider>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "reviewer@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "Demo-pass-2026");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const codeInput = await screen.findByLabelText("Authentication code");
    expect(codeInput).toHaveAttribute("autocomplete", "one-time-code");
    expect(screen.getByRole("button", { name: "Verify" })).toBeDisabled();
    await userEvent.type(codeInput, "12a3456");
    expect(codeInput).toHaveValue("123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(login).toHaveBeenLastCalledWith("reviewer@example.com", "Demo-pass-2026", "123456");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("shows a clear error for an invalid code and stays on the code step", async () => {
    const login = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, "mfa_required", "x"))
      .mockRejectedValueOnce(new ApiError(401, "mfa_invalid", "Invalid two-factor code"));
    render(
      <MockAuthProvider me={null} api={{}} status="anonymous" login={login}>
        <LoginPage />
      </MockAuthProvider>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "r@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await userEvent.type(await screen.findByLabelText("Authentication code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid or was already used/);
    expect(screen.getByLabelText("Authentication code")).toHaveValue("");
  });
});

describe("account security page", () => {
  it("enrolls: re-checks the password, shows QR + key, confirms the code, then switches to the MFA session", async () => {
    const fresh = { access_token: "a2", refresh_token: "r2", token_type: "bearer", expires_in: 900 };
    const api: Partial<AdminApi> = {
      mfaSetup: vi.fn().mockResolvedValue({ secret: "ABCDEFGHIJKLMNOP", otpauth_uri: "otpauth://totp/Darna:r?secret=ABCDEFGHIJKLMNOP" }),
      mfaConfirm: vi.fn().mockResolvedValue(fresh),
    };
    const refreshMe = vi.fn().mockResolvedValue(undefined);
    const adoptTokens = vi.fn();
    render(
      <ToastProvider>
        <MockAuthProvider me={reviewer} api={api} refreshMe={refreshMe} adoptTokens={adoptTokens}>
          <SecurityPage />
        </MockAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Off")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set up two-factor/i })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Confirm your password"), "Sup3r-secret-pass");
    await userEvent.type(screen.getByLabelText("Setup code from an administrator"), "abcd-efgh-jkmn");
    await userEvent.click(screen.getByRole("button", { name: /set up two-factor/i }));
    expect(api.mfaSetup).toHaveBeenCalledWith("Sup3r-secret-pass", "ABCD-EFGH-JKMN");
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(screen.getByLabelText("Setup key")).toHaveTextContent("ABCD EFGH IJKL MNOP");
    await userEvent.type(screen.getByLabelText(/6-digit code/), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(api.mfaConfirm).toHaveBeenCalledWith("654321");
    await waitFor(() => expect(adoptTokens).toHaveBeenCalledWith(fresh));
    await waitFor(() => expect(refreshMe).toHaveBeenCalled());
    expect(await screen.findByText(/Two-factor authentication is on/)).toBeInTheDocument();
  });

  it("surfaces the server refusal when staff MFA is mandatory", async () => {
    const api: Partial<AdminApi> = {
      mfaDisable: vi.fn().mockRejectedValue(new ApiError(403, "mfa_required_for_staff", "Staff accounts must keep two-factor authentication on")),
    };
    render(
      <ToastProvider>
        <MockAuthProvider me={{ ...reviewer, mfa_enabled_at: "2026-11-11T10:00:00Z" }} api={api}>
          <SecurityPage />
        </MockAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("On")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.type(screen.getByLabelText("Authentication code"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Turn off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/mfa_required_for_staff/);
  });

  it("is in the navigation for every staff role", () => {
    for (const role of ["admin", "reviewer", "support"] as const) {
      const { unmount } = render(<NavList role={role} pathname="/" />);
      expect(screen.getByRole("link", { name: "Account security" })).toBeInTheDocument();
      unmount();
    }
    render(<NavList role="member" pathname="/" />);
    expect(screen.queryByRole("link", { name: "Account security" })).not.toBeInTheDocument();
  });
});

describe("errorMessage for staff sessions", () => {
  it("tells staff to sign in again with a code when the session lacks MFA", async () => {
    const { errorMessage } = await import("@/lib/errors");
    expect(errorMessage(new ApiError(403, "mfa_session_required", "x"))).toMatch(/sign in again with your authenticator code/i);
  });
});


describe("staff MFA enrolment codes", () => {
  const admin: Me = { ...reviewer, id: "11111111-1111-1111-1111-111111111111", role: "admin", full_name: "Ada Admin", mfa_enabled_at: "2026-11-01T10:00:00Z" };
  const staffRow = {
    id: "22222222-2222-2222-2222-222222222222", email: "new@example.com", full_name: "Nour New", phone: null, role: "reviewer" as const,
    is_active: true, identity_verified_at: null, suspended_reason: null, created_at: "2026-11-01T10:00:00Z", mfa_enabled_at: null,
  };
  const memberRow = { ...staffRow, id: "33333333-3333-3333-3333-333333333333", full_name: "Mona Member", role: "member" as const };

  it("issues a one-time code for staff without MFA and shows it once", async () => {
    const api: Partial<AdminApi> = {
      users: vi.fn().mockResolvedValue({ items: [staffRow, memberRow], total: 2, page: 1, page_size: 25 }),
      issueMfaEnrollmentCode: vi.fn().mockResolvedValue({ code: "ABCD-EFGH-JKMN", expires_at: "2026-11-12T10:00:00Z" }),
    };
    render(
      <ToastProvider>
        <MockAuthProvider me={admin} api={api}>
          <UsersPage />
        </MockAuthProvider>
      </ToastProvider>,
    );
    expect(await screen.findByRole("button", { name: "2FA setup code for Nour New" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "2FA setup code for Mona Member" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2FA setup code for Nour New" }));
    await userEvent.click(screen.getByRole("button", { name: "Issue code" }));
    expect(api.issueMfaEnrollmentCode).toHaveBeenCalledWith(staffRow.id);
    expect(await screen.findByLabelText("Setup code")).toHaveTextContent("ABCD-EFGH-JKMN");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument());
  });

  it("explains a missing setup code", async () => {
    const { errorMessage } = await import("@/lib/errors");
    expect(errorMessage(new ApiError(403, "mfa_enrollment_code_required", "x"))).toMatch(/setup code from an administrator/i);
  });
});
