import { describe, it, expect } from "vitest";

import { buildToolIndex } from "../../mcp/tools.js";

const mockTools = [
  { name: "greet", description: "Say hello", inputSchema: {} },
  { name: "add", description: "Add numbers", inputSchema: {} },
  { name: "search", description: "Search things", inputSchema: {} },
];

describe("buildToolIndex", () => {
  it("returns a Map keyed by tool name", () => {
    const index = buildToolIndex(mockTools as any);
    expect(index.size).toBe(3);
    expect(index.get("greet")?.name).toBe("greet");
    expect(index.get("add")?.name).toBe("add");
    expect(index.get("search")?.name).toBe("search");
  });

  it("returns undefined for unknown tools", () => {
    const index = buildToolIndex(mockTools as any);
    expect(index.get("nonexistent")).toBeUndefined();
  });

  it("handles empty tool list", () => {
    const index = buildToolIndex([]);
    expect(index.size).toBe(0);
  });
});
