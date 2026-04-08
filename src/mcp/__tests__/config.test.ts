import { describe, it, expect } from "vitest";
import { parseServerSpec, parseConfigFile, isHttpServer } from "../config.js";

describe("parseServerSpec", () => {
  it("parses a simple command string", () => {
    const result = parseServerSpec("npx @mcp/server-weather");
    expect(result).toEqual({
      command: "npx",
      args: ["@mcp/server-weather"],
    });
  });

  it("parses command with multiple args", () => {
    const result = parseServerSpec("node server.js --port 3000");
    expect(result).toEqual({
      command: "node",
      args: ["server.js", "--port", "3000"],
    });
  });

  it("parses a single command with no args", () => {
    const result = parseServerSpec("my-server");
    expect(result).toEqual({
      command: "my-server",
      args: [],
    });
  });
});

describe("parseConfigFile", () => {
  it("extracts server config by name", () => {
    const config = {
      mcpServers: {
        weather: {
          command: "npx",
          args: ["@mcp/server-weather"],
          env: { API_KEY: "test" },
        },
        files: {
          command: "npx",
          args: ["@mcp/server-fs", "/tmp"],
        },
      },
    };
    const result = parseConfigFile(config, "weather");
    expect(result).toEqual({
      command: "npx",
      args: ["@mcp/server-weather"],
      env: { API_KEY: "test" },
    });
  });

  it("auto-selects when only one server exists", () => {
    const config = {
      mcpServers: {
        weather: {
          command: "npx",
          args: ["@mcp/server-weather"],
        },
      },
    };
    const result = parseConfigFile(config);
    expect(result).toEqual({
      command: "npx",
      args: ["@mcp/server-weather"],
    });
  });

  it("throws when multiple servers and no name given", () => {
    const config = {
      mcpServers: {
        a: { command: "a", args: [] },
        b: { command: "b", args: [] },
      },
    };
    expect(() => parseConfigFile(config)).toThrow("Multiple servers in config");
  });

  it("throws when server name not found", () => {
    const config = {
      mcpServers: {
        weather: { command: "npx", args: [] },
      },
    };
    expect(() => parseConfigFile(config, "missing")).toThrow("not found");
  });
});

describe("isHttpServer", () => {
  it("returns true for url-based config", () => {
    expect(isHttpServer({ url: "https://mcp.example.com" })).toBe(true);
  });

  it("returns false for stdio config", () => {
    expect(isHttpServer({ command: "npx", args: ["server"] })).toBe(false);
  });
});
