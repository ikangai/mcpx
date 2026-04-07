import { describe, it, expect } from "vitest";
import type { DaemonRequest, DaemonResponse } from "../protocol.js";

describe("daemon protocol", () => {
  it("request serializes to valid JSON", () => {
    const req: DaemonRequest = {
      id: 1,
      method: "listTools",
      serverAlias: "test",
      serverConfig: { command: "echo", args: ["hello"] },
    };
    const json = JSON.stringify(req);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(1);
    expect(parsed.method).toBe("listTools");
    expect(parsed.serverAlias).toBe("test");
  });

  it("response with result serializes correctly", () => {
    const res: DaemonResponse = {
      id: 1,
      result: [{ name: "tool", description: "desc" }],
    };
    const json = JSON.stringify(res);
    const parsed = JSON.parse(json);
    expect(parsed.result).toHaveLength(1);
  });

  it("response with error serializes correctly", () => {
    const res: DaemonResponse = {
      id: 1,
      error: "Connection failed",
    };
    const json = JSON.stringify(res);
    const parsed = JSON.parse(json);
    expect(parsed.error).toBe("Connection failed");
  });

  it("request with callTool params", () => {
    const req: DaemonRequest = {
      id: 2,
      method: "callTool",
      serverAlias: "pg",
      serverConfig: { command: "npx", args: ["server"] },
      toolName: "execute_sql",
      toolArgs: { sql: "SELECT 1" },
    };
    expect(req.toolName).toBe("execute_sql");
    expect(req.toolArgs).toEqual({ sql: "SELECT 1" });
  });

  it("ping request has minimal fields", () => {
    const req: DaemonRequest = {
      id: 3,
      method: "ping",
      serverAlias: "",
    };
    expect(req.serverConfig).toBeUndefined();
  });
});
