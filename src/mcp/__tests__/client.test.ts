import { describe, it, expect } from "vitest";
import { resolveTransportType } from "../client.js";

describe("resolveTransportType", () => {
  it("returns stdio when no url", () => {
    expect(resolveTransportType({ command: "npx", args: [] })).toBe("stdio");
  });

  it("returns http for url-based config", () => {
    expect(resolveTransportType({ url: "https://example.com/mcp" })).toBe("http");
  });

  it("respects explicit transport override", () => {
    expect(resolveTransportType({ url: "https://example.com/mcp", transport: "sse" })).toBe("sse");
  });
});
