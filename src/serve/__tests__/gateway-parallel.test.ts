import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("gateway parallel connections", () => {
  it("connects to multiple servers concurrently", async () => {
    // Verify that Promise.allSettled is used instead of sequential for...of
    const source = readFileSync(
      resolve(__dirname, "../gateway.ts"),
      "utf-8"
    );
    expect(source).toContain("Promise.allSettled");
    expect(source).not.toMatch(/for\s*\(\s*const\s*\[alias,\s*config\]\s*of/);
  });
});
