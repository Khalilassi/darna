import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ListingCard, headlinePrice } from "../components/ListingCard";
import { card } from "./fixtures";

describe("ListingCard", () => {
  it("shows price, specs and an honest featured label", async () => {
    await render(<ListingCard listing={card} />);
    expect(screen.getByTestId("listing-price")).toHaveTextContent(/EGP\s?6,740,000/);
    expect(screen.getByText("Featured · promoted")).toBeTruthy();
    expect(screen.getByText(/Initial cash EGP\s?7,599,000/)).toBeTruthy();
    expect(screen.getByText("2 beds")).toBeTruthy();
    expect(screen.getByText("1 bath")).toBeTruthy();
    expect(screen.getByText("182 m²")).toBeTruthy();
  });

  it("shows verification badges only from API flags", async () => {
    const { rerender } = await render(<ListingCard listing={card} />);
    expect(screen.getByTestId("badge-owner-verified")).toBeTruthy();
    expect(screen.queryByTestId("badge-fin-verified")).toBeNull();
    await rerender(<ListingCard listing={{ ...card, owner_verified: false, featured: false }} />);
    expect(screen.queryByTestId("badge-owner-verified")).toBeNull();
    expect(screen.queryByTestId("badge-featured")).toBeNull();
    await rerender(<ListingCard listing={{ ...card, financials_verified: true }} />);
    expect(screen.getByTestId("badge-fin-verified")).toBeTruthy();
  });

  it("uses monthly rent for rent listings and toggles favorite", async () => {
    const onFav = jest.fn();
    await render(<ListingCard listing={{ ...card, purpose: "rent", sale_cash_price: null, monthly_rent: "21000.00" }} favorite={false} onToggleFavorite={onFav} />);
    expect(screen.getByTestId("listing-price")).toHaveTextContent(/21,000.*\/ month/);
    await fireEvent.press(screen.getByLabelText("Save home"));
    expect(onFav).toHaveBeenCalledTimes(1);
    expect(headlinePrice({ purpose: "sale_and_rent", sale_cash_price: "1", monthly_rent: "2" })).toEqual({ amount: "1", monthly: false });
  });
});
