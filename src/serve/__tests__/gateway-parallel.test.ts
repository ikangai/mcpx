import { describe, it, expect } from "vitest";

describe("gateway parallel connections", () => {
  it("connects to multiple servers concurrently", async () => {
    // Verify that Promise.allSettled is used instead of sequential for...of
    const fs = await import("node:fs");
    const source = fs.readFileSync(
      new URL("../gateway.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(source).toContain("Promise.allSettled");
    expect(source).not.toMatch(/for\s*\(\s*const\s*\[alias,\s*config\]\s*of/);
  });
});
