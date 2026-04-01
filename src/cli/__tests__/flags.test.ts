import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { addToolFlags, parseToolArgs } from "../flags.js";

const weatherSchema = {
  type: "object" as const,
  properties: {
    city: { type: "string", description: "City name" },
    units: {
      type: "string",
      enum: ["celsius", "fahrenheit"],
      description: "Temperature units",
    },
    days: { type: "number", description: "Forecast days" },
    verbose: { type: "boolean", description: "Verbose output" },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Tags",
    },
    nested: {
      type: "object",
      description: "A nested object",
    },
  },
  required: ["city"],
};

describe("addToolFlags", () => {
  it("generates string flags", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.parse(["--city", "Berlin"], { from: "user" });
    expect(cmd.opts().city).toBe("Berlin");
  });

  it("generates enum flags with choices", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.exitOverride();
    expect(() =>
      cmd.parse(["--city", "Berlin", "--units", "invalid"], { from: "user" })
    ).toThrow();
  });

  it("generates number flags", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.parse(["--city", "Berlin", "--days", "5"], { from: "user" });
    expect(cmd.opts().days).toBe(5);
  });

  it("generates boolean flags", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.parse(["--city", "Berlin", "--verbose"], { from: "user" });
    expect(cmd.opts().verbose).toBe(true);
  });

  it("generates repeatable flags for arrays", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.parse(["--city", "Berlin", "--tags", "a", "--tags", "b"], {
      from: "user",
    });
    expect(cmd.opts().tags).toEqual(["a", "b"]);
  });

  it("skips object properties (use --json instead)", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    const helpText = cmd.helpInformation();
    expect(helpText).not.toContain("--nested");
  });

  it("adds --json escape hatch", () => {
    const cmd = new Command("test");
    addToolFlags(cmd, weatherSchema);
    cmd.parse(["--json", '{"city":"Berlin"}'], { from: "user" });
    expect(cmd.opts().json).toBe('{"city":"Berlin"}');
  });
});

describe("parseToolArgs", () => {
  it("builds arguments from flags", () => {
    const opts = { city: "Berlin", units: "celsius", days: 5 };
    const result = parseToolArgs(opts, weatherSchema);
    expect(result).toEqual({ city: "Berlin", units: "celsius", days: 5 });
  });

  it("--json overrides individual flags", () => {
    const opts = {
      city: "Berlin",
      json: '{"city":"Munich","extra":true}',
    };
    const result = parseToolArgs(opts, weatherSchema);
    expect(result).toEqual({ city: "Munich", extra: true });
  });

  it("strips undefined values", () => {
    const opts = { city: "Berlin", units: undefined };
    const result = parseToolArgs(opts, weatherSchema);
    expect(result).toEqual({ city: "Berlin" });
  });
});
