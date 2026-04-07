import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let testDir: string;

describe("config store", () => {
  beforeEach(() => {
    testDir = join(tmpdir(), `mcpx-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    process.env.MCPX_CONFIG_DIR = testDir;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.MCPX_CONFIG_DIR;
    try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
  });

  it("returns empty servers when no config exists", async () => {
    const { loadServers } = await import("../store.js");
    const result = loadServers();
    expect(result.mcpServers).toEqual({});
  });

  it("adds and retrieves a server", async () => {
    const { addServer, getServer } = await import("../store.js");
    addServer("test", "npx some-server --flag");
    const server = getServer("test");
    expect(server).toBeDefined();
    expect(server!.command).toBe("npx");
    expect(server!.args).toEqual(["some-server", "--flag"]);
  });

  it("overwrites existing alias", async () => {
    const { addServer, getServer } = await import("../store.js");
    addServer("test", "npx old-server");
    addServer("test", "node new-server");
    expect(getServer("test")!.command).toBe("node");
  });

  it("stores env vars", async () => {
    const { addServer, getServer } = await import("../store.js");
    addServer("test", "npx server", { DB_HOST: "localhost" });
    const server = getServer("test");
    expect(server!.env).toEqual({ DB_HOST: "localhost" });
  });

  it("removes a server", async () => {
    const { addServer, removeServer, getServer } = await import("../store.js");
    addServer("test", "npx server");
    const removed = removeServer("test");
    expect(removed).toBe(true);
    expect(getServer("test")).toBeUndefined();
  });

  it("returns false when removing nonexistent server", async () => {
    const { removeServer } = await import("../store.js");
    expect(removeServer("nope")).toBe(false);
  });

  it("returns undefined for unknown server", async () => {
    const { getServer } = await import("../store.js");
    expect(getServer("nonexistent")).toBeUndefined();
  });

  it("lists all servers", async () => {
    const { addServer, getAllServers } = await import("../store.js");
    addServer("a", "cmd-a");
    addServer("b", "cmd-b");
    const all = getAllServers();
    expect(Object.keys(all)).toContain("a");
    expect(Object.keys(all)).toContain("b");
  });
});
