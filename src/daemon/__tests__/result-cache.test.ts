import { describe, it, expect, vi } from "vitest";
import { ResultCache } from "../server.js";

describe("ResultCache", () => {
  it("stores and retrieves values", () => {
    const cache = new ResultCache(100);
    cache.set("key1", { data: "hello" }, 10_000);
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  it("returns undefined for expired entries", () => {
    const cache = new ResultCache(100);
    vi.useFakeTimers();
    cache.set("key1", "value", 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("evicts oldest entry when max size reached", () => {
    const cache = new ResultCache(3);
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.set("c", "3", 60_000);
    cache.set("d", "4", 60_000); // should evict "a"
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("d")).toBe("4");
  });

  it("refreshes entry position on get", () => {
    const cache = new ResultCache(3);
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.set("c", "3", 60_000);
    cache.get("a"); // refresh "a" — now "b" is oldest
    cache.set("d", "4", 60_000); // should evict "b"
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("clears all entries", () => {
    const cache = new ResultCache(100);
    cache.set("a", "1", 60_000);
    cache.set("b", "2", 60_000);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
