import { describe, it, expect } from "vitest";
import { formatResult, formatToolList } from "../formatter.js";

describe("formatResult", () => {
  it("formats text content as JSON", () => {
    const result = {
      content: [{ type: "text" as const, text: "Hello world" }],
    };
    const output = formatResult(result, "json");
    const parsed = JSON.parse(output);
    expect(parsed.content[0].text).toBe("Hello world");
  });

  it("formats as table with plain text", () => {
    const result = {
      content: [{ type: "text" as const, text: "Hello world" }],
    };
    const output = formatResult(result, "table");
    expect(output).toContain("Hello world");
  });

  it("formats JSON text content as table", () => {
    const result = {
      content: [{ type: "text" as const, text: '{"temp": 20, "city": "Berlin"}' }],
    };
    const output = formatResult(result, "table");
    expect(output).toContain("temp");
    expect(output).toContain("20");
  });

  it("handles isError results", () => {
    const result = {
      content: [{ type: "text" as const, text: "Something failed" }],
      isError: true,
    };
    const output = formatResult(result, "json");
    expect(output).toContain("Something failed");
  });

  it("formats as YAML", () => {
    const result = {
      content: [{ type: "text" as const, text: "test" }],
    };
    const output = formatResult(result, "yaml");
    expect(output).toContain("text: test");
  });
});

describe("formatToolList", () => {
  it("formats tools as table string", () => {
    const tools = [
      {
        name: "get_weather",
        description: "Get weather",
        inputSchema: {
          type: "object" as const,
          properties: {
            city: { type: "string", description: "City" },
          },
          required: ["city"],
        },
      },
    ];
    const output = formatToolList(tools, "table");
    expect(output).toContain("get_weather");
    expect(output).toContain("Get weather");
  });

  it("formats tools as JSON", () => {
    const tools = [
      {
        name: "test_tool",
        description: "A test",
        inputSchema: { type: "object" as const },
      },
    ];
    const output = formatToolList(tools, "json");
    const parsed = JSON.parse(output);
    expect(parsed[0].name).toBe("test_tool");
  });
});
