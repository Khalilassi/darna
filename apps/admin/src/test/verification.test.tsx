import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VerificationPanel } from "@/components/VerificationPanel";
import { VerificationQueue } from "@/components/VerificationQueue";
import type { AdminApi, QueueItem } from "@/lib/adminApi";
import { MockAuthProvider } from "@/lib/auth";
import type { Me } from "@/lib/session";
import { ToastProvider } from "@/lib/toast";

const identityItem: QueueItem = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "identity",
  status: "submitted",
  user_id: "22222222-2222-2222-2222-222222222222",
  user_name: "Nadia Owner",
  claim_id: null,
  listing_id: null,
  note: "Please verify",
  documents: [{ id: "33333333-3333-3333-3333-333333333333", kind: "national_id", original_name: "id.pdf", content_type: "application/pdf" }],
  claim: null,
  created_at: "2026-11-01T10:00:00Z",
};

const ownershipItem: QueueItem = {
  ...identityItem,
  id: "44444444-4444-4444-4444-444444444444",
  kind: "ownership",
  status: "under_review",
  claim_id: "55555555-5555-5555-5555-555555555555",
  claim: { status: "under_review", capacity: "owner", principal_name: null, authority_scope: [], property_id: "p1", identity_key: "MDN:B7:72:12:5", property_type: "apartment", area_sqm: "120.00" },
};

const reviewer: Me = {
  id: "99999999-9999-9999-9999-999999999999",
  email: "reviewer@example.com",
  full_name: "Rana Reviewer",
  phone: null,
  locale: "en",
  role: "reviewer",
  identity_verified_at: null,
  mfa_enabled_at: null,
  created_at: "2026-01-01T00:00:00Z",
  verification: { information_submitted: false, identity: "none", approved_ownership_claims: 0, pending_ownership_claims: 0 },
};

describe("VerificationPanel", () => {
  it("requires a note before rejecting", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<VerificationPanel item={identityItem} onDecide={onDecide} onOpenDocument={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/note for the applicant is required/i);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  it("rejects with a note after confirmation", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<VerificationPanel item={identityItem} onDecide={onDecide} onOpenDocument={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/reviewer note/i), "ID photo is blurry");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("ID photo is blurry");
    await userEvent.click(screen.getByRole("button", { name: "Confirm: Reject" }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "reject", note: "ID photo is blurry", supersede_existing: false });
  });

  it("opens documents through the signed-URL callback", async () => {
    const onOpen = vi.fn();
    render(<VerificationPanel item={identityItem} onDecide={vi.fn()} onOpenDocument={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: /open document id\.pdf/i }));
    expect(onOpen).toHaveBeenCalledWith("33333333-3333-3333-3333-333333333333");
  });

  it("shows property identity and an explicit warning for ownership supersede", async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined);
    render(<VerificationPanel item={ownershipItem} onDecide={onDecide} onOpenDocument={vi.fn()} />);
    expect(screen.getByText("MDN:B7:72:12:5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start review" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/supersede the existing approved owner/i));
    expect(screen.getByRole("note")).toHaveTextContent(/withdraws their listings/i);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/requires a note/i);
    await userEvent.type(screen.getByLabelText(/reviewer note/i), "Transfer contract verified");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve and supersede" }));
    expect(onDecide).toHaveBeenCalledWith({ decision: "approve", note: "Transfer contract verified", supersede_existing: true });
  });
});

describe("VerificationQueue (mocked API)", () => {
  it("loads the queue, starts a review and refreshes", async () => {
    const api: Partial<AdminApi> = {
      verifications: vi.fn().mockResolvedValueOnce([identityItem]).mockResolvedValueOnce([{ ...identityItem, status: "under_review" }]),
      decide: vi.fn().mockResolvedValue({ ok: true }),
    };
    render(
      <ToastProvider>
        <MockAuthProvider me={reviewer} api={api}>
          <VerificationQueue />
        </MockAuthProvider>
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Nadia Owner" }));
    await userEvent.click(screen.getByRole("button", { name: "Start review" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm: Start review" }));
    expect(api.decide).toHaveBeenCalledWith(identityItem.id, { decision: "start_review", note: null, supersede_existing: false });
    expect(await screen.findByText(/Decision “start review” recorded/)).toBeInTheDocument();
    await waitFor(() => expect(api.verifications).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("shows the empty state and API errors", async () => {
    const api: Partial<AdminApi> = { verifications: vi.fn().mockResolvedValue([]) };
    render(
      <ToastProvider>
        <MockAuthProvider me={reviewer} api={api}>
          <VerificationQueue />
        </MockAuthProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText(/queue is empty/i)).toBeInTheDocument();
  });

  it("surfaces decision failures with the API error code", async () => {
    const { ApiError } = await import("@darna/api-client");
    const api: Partial<AdminApi> = {
      verifications: vi.fn().mockResolvedValue([identityItem]),
      decide: vi.fn().mockRejectedValue(new ApiError(409, "self_review", "You cannot review your own submission")),
    };
    render(
      <ToastProvider>
        <MockAuthProvider me={reviewer} api={api}>
          <VerificationQueue />
        </MockAuthProvider>
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Nadia Owner" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm: Approve" }));
    expect(await screen.findByText("You cannot review your own submission (self_review)")).toBeInTheDocument();
  });
});
