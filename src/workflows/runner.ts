import { readFileSync } from "node:fs";
import YAML from "yaml";
import { invokeTool } from "../cli/commands.js";
import type { Envelope } from "../output/envelope.js";
import { errorEnvelope, EXIT, successResult } from "../output/envelope.js";

interface WorkflowStep {
  server: string;
  tool: string;
  params?: Record<string, unknown>;
  output?: string; // variable name to store result
}

interface Workflow {
  name?: string;
  steps: WorkflowStep[];
}

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{{${key}}}`;
  });
}

function interpolateParams(
  params: Record<string, unknown>,
  vars: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      result[key] = interpolate(value, vars);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export async function runWorkflow(
  filePath: string,
  opts?: { verbose?: boolean; timeout?: number }
): Promise<Envelope> {
  let workflow: Workflow;
  try {
    const raw = readFileSync(filePath, "utf-8");
    workflow = YAML.parse(raw) as Workflow;
  } catch (err) {
    return errorEnvelope(EXIT.VALIDATION_ERROR, `Failed to parse workflow: ${(err as Error).message}`);
  }

  if (!workflow.steps || !Array.isArray(workflow.steps)) {
    return errorEnvelope(EXIT.VALIDATION_ERROR, "Workflow must have a 'steps' array");
  }

  const vars: Record<string, unknown> = {};
  const stepResults: Array<{ step: number; server: string; tool: string; ok: boolean; output?: string }> = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const params = step.params ? interpolateParams(step.params, vars) : {};

    const envelope = await invokeTool(step.tool, [
      "--params", JSON.stringify(params),
    ], {
      serverAlias: step.server,
      verbose: opts?.verbose,
      timeout: opts?.timeout,
    });

    if (!envelope.ok) {
      stepResults.push({ step: i + 1, server: step.server, tool: step.tool, ok: false });
      return errorEnvelope(EXIT.TOOL_ERROR,
        `Workflow failed at step ${i + 1} (${step.server}.${step.tool}): ${envelope.error.message}\n\nCompleted steps:\n${stepResults.map((s) => `  ${s.step}. ${s.server}.${s.tool}: ${s.ok ? "OK" : "FAILED"}`).join("\n")}`
      );
    }

    // Extract result text and store in variable
    const resultText = envelope.result?.[0]?.text;
    if (step.output && resultText) {
      // Try to parse as JSON for richer interpolation
      try {
        vars[step.output] = JSON.parse(resultText);
      } catch {
        vars[step.output] = resultText;
      }
    }

    stepResults.push({
      step: i + 1,
      server: step.server,
      tool: step.tool,
      ok: true,
      output: step.output,
    });
  }

  const summary = stepResults.map((s) =>
    `  ${s.step}. ${s.server}.${s.tool}: OK${s.output ? ` → ${s.output}` : ""}`
  ).join("\n");

  return successResult([{
    type: "text",
    text: `Workflow${workflow.name ? ` "${workflow.name}"` : ""} completed (${stepResults.length} steps)\n\n${summary}\n\nVariables:\n${JSON.stringify(vars, null, 2)}`,
  }]);
}
