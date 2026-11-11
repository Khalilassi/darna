import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saleListing } from "./fixtures";

const fetchListing = vi.fn();
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), fetchListing: (...a: unknown[]) => fetchListing(...a) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: ListingPage, generateMetadata } = await import("@/app/[locale]/listings/[id]/page");
const params = (locale: string, id = saleListing.id) => Promise.resolve({ locale, id });

beforeEach(() => fetchListing.mockReset());

describe("listing detail page", () => {
  it("labels each cost with its provenance and lists unconfirmed items", async () => {
    fetchListing.mockResolvedValue({ ok: true, data: saleListing });
    render(await ListingPage({ params: params("en") }));

    const table = screen.getByRole("table", { name: "Cost breakdown" });
    const row = (name: string) => within(table).getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;
    expect(within(row("Owner's cash price")).getByText("Seller-provided")).toHaveAttribute("data-provenance", "seller_provided");
    expect(within(row("Maintenance deposit")).getByText("Verified")).toBeInTheDocument();
    const transfer = row("Transfer fee");
    expect(within(transfer).getAllByText("Not yet confirmed")).toHaveLength(2); // amount + source badge
    expect(within(transfer).getByText("Not included in totals")).toBeInTheDocument();

    const notice = screen.getByRole("note", { name: "Not yet confirmed" });
    expect(within(notice).getByText("Transfer fee")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Open in the app to contact the owner" })).toBeInTheDocument();
    expect(screen.getAllByText(/B7 · Madinaty|B7, Madinaty/).length).toBeGreaterThan(0);
  });

  it("never shows building or unit identifiers", async () => {
    fetchListing.mockResolvedValue({ ok: true, data: { ...saleListing, group_code: "GROUP-72-SECRET" } });
    const { container } = render(await ListingPage({ params: params("en") }));
    expect(container.textContent).not.toContain("GROUP-72-SECRET");
    expect(container.textContent).toMatch(/Exact building and unit are shared by the owner/);
  });

  it("renders Arabic provenance labels", async () => {
    fetchListing.mockResolvedValue({ ok: true, data: saleListing });
    render(await ListingPage({ params: params("ar") }));
    expect(screen.getAllByText("من البائع").length).toBeGreaterThan(0);
    expect(screen.getByRole("note", { name: "لم يُؤكَّد بعد" })).toHaveTextContent("رسوم نقل الملكية");
  });

  it("shows a friendly message when the API is down", async () => {
    fetchListing.mockResolvedValue({ ok: false, status: 0, message: "fetch failed" });
    render(await ListingPage({ params: params("en") }));
    expect(screen.getByRole("alert")).toHaveTextContent("Listings are temporarily unavailable");
  });

  it("404s for unknown listings", async () => {
    fetchListing.mockResolvedValue({ ok: false, status: 404, message: "Listing not found" });
    await expect(ListingPage({ params: params("en") })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("builds OpenGraph metadata from the cover photo", async () => {
    fetchListing.mockResolvedValue({ ok: true, data: saleListing });
    const meta = await generateMetadata({ params: params("en") });
    expect(meta.title).toBe(saleListing.title);
    expect(JSON.stringify(meta.openGraph)).toContain("http://localhost:8000/media/cover.jpg");
    expect(meta.alternates?.languages).toHaveProperty("ar");
  });
});
