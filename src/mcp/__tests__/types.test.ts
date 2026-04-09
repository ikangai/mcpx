import { describe, it, expect } from "vitest";
import type { ToolAnnotations, AnnotatedTool } from "../types.js";

describe("ToolAnnotations type", () => {
  it("defines all MCP annotation hints", () => {
    const annotations: ToolAnnotations = {
      title: "Test Tool",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    expect(annotations.readOnlyHint).toBe(true);
  });

  it("allows partial annotations", () => {
    const annotations: ToolAnnotations = {};
    expect(annotations.readOnlyHint).toBeUndefined();
  });
});
