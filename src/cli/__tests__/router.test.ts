import { describe, it, expect } from "vitest";
import { parseSlashCommand, parsePShorthand } from "../router.js";

describe("parseSlashCommand", () => {
  it("parses /server tool pattern", () => {
    const result = parseSlashCommand(["node", "index.js", "/myserver", "mytool", "--flag", "val"]);
    expect(result).toEqual({
      serverAlias: "myserver",
      toolName: "mytool",
      toolArgs: ["--flag", "val"],
    });
  });

  it("returns null for non-slash first arg", () => {
    expect(parseSlashCommand(["node", "index.js", "list"])).toBeNull();
  });

  it("returns null for too few args", () => {
    expect(parseSlashCommand(["node", "index.js", "/server"])).toBeNull();
  });

  it("handles tool with no extra args", () => {
    const result = parseSlashCommand(["node", "index.js", "/srv", "tool"]);
    expect(result).toEqual({
      serverAlias: "srv",
      toolName: "tool",
      toolArgs: [],
    });
  });

  it("returns null for empty argv", () => {
    expect(parseSlashCommand([])).toBeNull();
  });
});

describe("parsePShorthand", () => {
  it("tokenizes basic input", () => {
    const result = parsePShorthand("/server tool --name World");
    expect(result).toEqual({
      serverAlias: "server",
      toolName: "tool",
      toolArgs: ["--name", "World"],
    });
  });

  it("handles single-quoted JSON", () => {
    const result = parsePShorthand("/srv tool --params '{\"key\": \"value\"}'");
    expect(result).toEqual({
      serverAlias: "srv",
      toolName: "tool",
      toolArgs: ["--params", '{"key": "value"}'],
    });
  });

  it("handles double-quoted values", () => {
    const result = parsePShorthand('/srv tool --name "hello world"');
    expect(result).toEqual({
      serverAlias: "srv",
      toolName: "tool",
      toolArgs: ["--name", "hello world"],
    });
  });

  it("returns null for non-slash input", () => {
    expect(parsePShorthand("just some text")).toBeNull();
  });

  it("returns null for single token", () => {
    expect(parsePShorthand("/server")).toBeNull();
  });

  it("handles empty string", () => {
    expect(parsePShorthand("")).toBeNull();
  });
});
