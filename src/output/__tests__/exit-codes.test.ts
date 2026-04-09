import { describe, it, expect } from "vitest";
import { EXIT } from "../envelope.js";

describe("EXIT codes", () => {
  it("has TIMEOUT code 124 (GNU convention)", () => {
    expect(EXIT.TIMEOUT).toBe(124);
  });

  it("has all standard codes", () => {
    expect(EXIT.SUCCESS).toBe(0);
    expect(EXIT.TOOL_ERROR).toBe(1);
    expect(EXIT.CONNECTION_ERROR).toBe(2);
    expect(EXIT.VALIDATION_ERROR).toBe(3);
    expect(EXIT.CONFIG_ERROR).toBe(4);
    expect(EXIT.INTERNAL_ERROR).toBe(5);
  });
});
