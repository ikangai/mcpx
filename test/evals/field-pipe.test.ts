import { describe, it, expect, afterAll } from "vitest";
import { runMcpx, createTempConfigDir, writeServersConfig, TEST_SERVER_CMD } from "./helpers.js";

describe("--field pipe-friendly output", () => {
  const { dir, cleanup } = createTempConfigDir();
  writeServersConfig(dir, { test: TEST_SERVER_CMD });

  it("outputs raw value when piped (no envelope)", async () => {
    // The test helper spawns mcpx as a child process, so stdout is a pipe (not TTY)
    const result = await runMcpx(
      ["/test", "search", "--params", '{"query":"hello"}', "--field", "query"],
      { configDir: dir }
    );

    // When piped, --field should output just the raw value, not a JSON envelope
    expect(result.stdout).not.toContain('"ok"');
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  }, 30_000);

  it("outputs raw numeric field value", async () => {
    const result = await runMcpx(
      ["/test", "search", "--params", '{"query":"test"}', "--field", "limit"],
      { configDir: dir }
    );
    // Default limit is 10
    expect(result.stdout.trim()).toBe("10");
    expect(result.exitCode).toBe(0);
  }, 30_000);

  afterAll(() => cleanup());
});
