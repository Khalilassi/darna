import React from "react";
import { renderHook } from "@testing-library/react-native";
import { useIdempotencyKeys } from "../lib/idempotency";

describe("useIdempotencyKeys", () => {
  it("reuses a key for retries after failure and issues a fresh key after success", async () => {
    const { result } = await renderHook(() => useIdempotencyKeys());
    const withKey = result.current;
    const body = { amount: "100" };
    const seen: string[] = [];
    await expect(withKey("offer", body, async (k) => { seen.push(k); throw new Error("network"); })).rejects.toThrow("network");
    await withKey("offer", body, async (k) => { seen.push(k); return "ok"; });
    await withKey("offer", body, async (k) => { seen.push(k); return "ok"; });
    expect(seen[0]).toBe(seen[1]); // retry after failure replays the same key
    expect(seen[2]).not.toBe(seen[1]); // same content after success is a new action
  });

  it("uses different keys for different bodies", async () => {
    const { result } = await renderHook(() => useIdempotencyKeys());
    const keys: string[] = [];
    await expect(result.current("offer", { a: 1 }, async (k) => { keys.push(k); throw new Error("x"); })).rejects.toThrow();
    await expect(result.current("offer", { a: 2 }, async (k) => { keys.push(k); throw new Error("x"); })).rejects.toThrow();
    expect(keys[0]).not.toBe(keys[1]);
  });
});
void React;
