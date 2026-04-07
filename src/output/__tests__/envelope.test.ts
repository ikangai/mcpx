import { describe, it, expect } from "vitest";
import {
  successResult,
  successTools,
  successSchema,
  errorEnvelope,
  EXIT,
} from "../envelope.js";

describe("envelope", () => {
  it("successResult creates correct shape", () => {
    const env = successResult([{ type: "text", text: "hello" }]);
    expect(env.ok).toBe(true);
    expect(env.result).toHaveLength(1);
    expect(env.result![0].text).toBe("hello");
  });

  it("successTools creates correct shape", () => {
    const env = successTools([{
      name: "test",
      description: "A test tool",
      inputSchema: { type: "object" },
    }]);
    expect(env.ok).toBe(true);
    expect(env.tools).toHaveLength(1);
    expect(env.tools![0].name).toBe("test");
  });

  it("successSchema creates correct shape", () => {
    const env = successSchema({ type: "object", properties: {} });
    expect(env.ok).toBe(true);
    expect(env.schema).toHaveProperty("type", "object");
  });

  it("errorEnvelope creates correct shape", () => {
    const env = errorEnvelope(3, "bad input");
    expect(env.ok).toBe(false);
    expect(env.error.code).toBe(3);
    expect(env.error.message).toBe("bad input");
  });

  it("EXIT constants have expected values", () => {
    expect(EXIT.SUCCESS).toBe(0);
    expect(EXIT.TOOL_ERROR).toBe(1);
    expect(EXIT.CONNECTION_ERROR).toBe(2);
    expect(EXIT.VALIDATION_ERROR).toBe(3);
    expect(EXIT.CONFIG_ERROR).toBe(4);
    expect(EXIT.INTERNAL_ERROR).toBe(5);
  });

  it("success envelope has no error field", () => {
    const env = successResult([]);
    expect(env).not.toHaveProperty("error");
  });

  it("error envelope has no result field", () => {
    const env = errorEnvelope(1, "fail");
    expect(env).not.toHaveProperty("result");
    expect(env).not.toHaveProperty("tools");
  });
});
