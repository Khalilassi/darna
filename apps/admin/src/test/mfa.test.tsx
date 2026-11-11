import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@darna/api-client";
import LoginPage from "@/app/login/page";
import SecurityPage from "@/app/(console)/security/page";
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
  it("enrolls: shows QR + key, confirms the code, then refreshes the session", async () => {
    const api: Partial<AdminApi> = {
      mfaSetup: vi.fn().mockResolvedValue({ secret: "ABCDEFGHIJKLMNOP", otpauth_uri: "otpauth://totp/Darna:r?secret=ABCDEFGHIJKLMNOP" }),
      mfaConfirm: vi.fn().mockResolvedValue({ ok: true }),
    };
    const refreshMe = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <MockAuthProvider me={reviewer} api={api} refreshMe={refreshMe}>
          <SecurityPage />
        </MockAuthProvider>
      </ToastProvider>,
    );
    expect(screen.getByText("Off")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /set up two-factor/i }));
    expect(await screen.findByAltText(/QR code/)).toHaveAttribute("src", "data:image/png;base64,QR");
    expect(screen.getByLabelText("Setup key")).toHaveTextContent("ABCD EFGH IJKL MNOP");
    await userEvent.type(screen.getByLabelText(/6-digit code/), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(api.mfaConfirm).toHaveBeenCalledWith("654321");
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
