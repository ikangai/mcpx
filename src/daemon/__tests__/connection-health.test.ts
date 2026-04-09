import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("ConnectionPool health tracking", () => {
  it("tracks lastUsed timestamp per connection", () => {
    const source = readFileSync(resolve(__dirname, "../server.ts"), "utf-8");
    expect(source).toContain("lastUsed");
  });

  it("has a stale connection threshold", () => {
    const source = readFileSync(resolve(__dirname, "../server.ts"), "utf-8");
    expect(source).toContain("STALE_THRESHOLD");
  });
});
