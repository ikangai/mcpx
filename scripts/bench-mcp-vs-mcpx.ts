#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { McpClient } from "../src/mcp/client.js";

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
};

type Stats = {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
};

type ConfidenceStats = {
  n: number;
  mean: number;
  sd: number;
  se: number;
  ci95: [number, number];
  min: number;
  max: number;
};

type OptionalMetricStats =
  | (ConfidenceStats & { available: number; missing: number })
  | { n: 0; available: 0; missing: number; reason: string };

type CliOptions = {
  serverPath: string;
  alias: string;
  configDir?: string;
  keepConfigDir: boolean;
  timeoutMs: number;
  coldRuns: number;
  warmRuns: number;
  spawnRuns: number;
  inlineRuns: number;
  aliasRuns: number;
  repeat: number;
  tryDaemon: boolean;
  pretty: boolean;
};

type DaemonBenchmarkResult = {
  available: boolean;
  reason?: string;
  startCommand?: CommandResult;
  warmCallsMs?: Stats;
  firstCallMs?: number;
  firstCallExitCode?: number;
};

type DirectInProcessBenchmark = {
  cold: {
    totalMs: Stats;
    connectMs: Stats;
    listMs: Stats;
    callMs: Stats;
  };
  warm: {
    callMs: Stats;
  };
  payloadBytes: {
    list: number;
    call: number;
  };
};

type SingleBenchmarkReport = {
  benchmark: "mcp-vs-mcpx";
  generatedAt: string;
  startedAt: string;
  environment: {
    platform: string;
    nodeVersion: string;
    cwd: string;
    repoRoot: string;
  };
  config: {
    alias: string;
    serverPath: string;
    configDir: string;
    runs: {
      directCold: number;
      directWarm: number;
      directSpawn: number;
      mcpxInline: number;
      mcpxAlias: number;
    };
    timeoutMs: number;
  };
  latencyMs: {
    directInProcess: DirectInProcessBenchmark;
    directSpawnedCall: Stats;
    mcpxInlineExec: Stats;
    mcpxAliasViaDaemon: DaemonBenchmarkResult;
  };
  payloadBytes: {
    directList: number;
    directCall: number;
    directSpawnCall: number;
    mcpxInlineCall: number;
    mcpxList: number;
    mcpxSchema: number;
    mcpxAliasCall: number;
  };
  tokenBudgetEstimate: {
    knownToolCall: { direct: number; mcpx: number };
    discoverAndCall: { direct: number; mcpx: number };
    discoverSchemaAndCall: { direct: number; mcpx: number };
  };
  relativeOverheads: {
    mcpxInlineVsDirectSpawn: number;
    mcpxAliasWarmVsDirectSpawn: number | null;
  };
  notes: string[];
};

type SingleBenchmarkRun = {
  report: SingleBenchmarkReport;
  runDurationMs: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const mcpxEntry = "./src/index.ts";

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    serverPath: resolve(repoRoot, "test/integration/test-server.ts"),
    alias: "test",
    keepConfigDir: false,
    timeoutMs: 60_000,
    coldRuns: 15,
    warmRuns: 60,
    spawnRuns: 12,
    inlineRuns: 12,
    aliasRuns: 12,
    repeat: 1,
    tryDaemon: true,
    pretty: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--server-path" && next) {
      opts.serverPath = resolve(next);
      i++;
      continue;
    }
    if (arg === "--alias" && next) {
      opts.alias = next;
      i++;
      continue;
    }
    if (arg === "--config-dir" && next) {
      opts.configDir = resolve(next);
      i++;
      continue;
    }
    if (arg === "--timeout-ms" && next) {
      opts.timeoutMs = Number(next);
      i++;
      continue;
    }
    if (arg === "--cold-runs" && next) {
      opts.coldRuns = Number(next);
      i++;
      continue;
    }
    if (arg === "--warm-runs" && next) {
      opts.warmRuns = Number(next);
      i++;
      continue;
    }
    if (arg === "--spawn-runs" && next) {
      opts.spawnRuns = Number(next);
      i++;
      continue;
    }
    if (arg === "--inline-runs" && next) {
      opts.inlineRuns = Number(next);
      i++;
      continue;
    }
    if (arg === "--alias-runs" && next) {
      opts.aliasRuns = Number(next);
      i++;
      continue;
    }
    if (arg === "--repeat" && next) {
      opts.repeat = Number(next);
      i++;
      continue;
    }
    if (arg === "--keep-config-dir") {
      opts.keepConfigDir = true;
      continue;
    }
    if (arg === "--no-daemon") {
      opts.tryDaemon = false;
      continue;
    }
    if (arg === "--compact") {
      opts.pretty = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  const numericFields = [
    ["timeoutMs", opts.timeoutMs],
    ["coldRuns", opts.coldRuns],
    ["warmRuns", opts.warmRuns],
    ["spawnRuns", opts.spawnRuns],
    ["inlineRuns", opts.inlineRuns],
    ["aliasRuns", opts.aliasRuns],
    ["repeat", opts.repeat],
  ] as const;
  for (const [name, value] of numericFields) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid --${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} value: ${value}`);
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`Usage: node --import tsx scripts/bench-mcp-vs-mcpx.ts [options]

Options:
  --server-path <path>   MCP fixture server path (default: test/integration/test-server.ts)
  --alias <name>         Server alias for mcpx tests (default: test)
  --config-dir <path>    Reuse a specific MCPX config dir (default: temp dir)
  --cold-runs <n>        Direct in-process cold runs (default: 15)
  --warm-runs <n>        Direct in-process warm call runs (default: 60)
  --spawn-runs <n>       Direct spawned-call runs (default: 12)
  --inline-runs <n>      mcpx inline exec runs (default: 12)
  --alias-runs <n>       mcpx alias runs when daemon is available (default: 12)
  --repeat <n>           Repeat whole benchmark n times and emit 95% CI summary
  --timeout-ms <ms>      Per-command timeout for spawned CLI calls (default: 60000)
  --no-daemon            Skip daemon-based alias benchmark
  --keep-config-dir      Do not delete temp config dir at end
  --compact              Emit compact JSON
  --help                 Show this help
`);
}

function summarize(values: number[]): Stats {
  if (values.length === 0) {
    throw new Error("summarize() received an empty array");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const p50 = sorted[Math.floor((n - 1) * 0.5)];
  const p95 = sorted[Math.floor((n - 1) * 0.95)];
  return { n, mean, p50, p95, min: sorted[0], max: sorted[n - 1] };
}

function tCritical95(df: number): number {
  const table: Record<number, number> = {
    1: 12.706,
    2: 4.303,
    3: 3.182,
    4: 2.776,
    5: 2.571,
    6: 2.447,
    7: 2.365,
    8: 2.306,
    9: 2.262,
    10: 2.228,
    11: 2.201,
    12: 2.179,
    13: 2.16,
    14: 2.145,
    15: 2.131,
    16: 2.12,
    17: 2.11,
    18: 2.101,
    19: 2.093,
    20: 2.086,
    25: 2.06,
    30: 2.042,
  };
  if (df in table) return table[df];
  if (df > 30) return 1.96;
  if (df > 20 && df < 30) {
    const ratio = (df - 20) / 10;
    return 2.086 + (2.042 - 2.086) * ratio;
  }
  return 1.96;
}

function summarizeCI(values: number[]): ConfidenceStats {
  if (values.length === 0) {
    throw new Error("summarizeCI() received an empty array");
  }
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance =
    n > 1 ? values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const t = tCritical95(Math.max(1, n - 1));
  const margin = t * se;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n,
    mean,
    sd,
    se,
    ci95: [mean - margin, mean + margin],
    min: sorted[0],
    max: sorted[n - 1],
  };
}

function summarizeOptionalMetric(
  values: Array<number | null | undefined>,
  reason: string
): OptionalMetricStats {
  const usable = values.filter((v): v is number => typeof v === "number");
  const missing = values.length - usable.length;
  if (usable.length === 0) {
    return { n: 0, available: 0, missing, reason };
  }
  return {
    ...toCompactConfidenceStats(summarizeCI(usable)),
    available: usable.length,
    missing,
  };
}

function tokensFromBytes(bytes: number): number {
  return Number((bytes / 4).toFixed(2));
}

function toCompactStats(stats: Stats): Stats {
  return {
    ...stats,
    mean: Number(stats.mean.toFixed(3)),
    p50: Number(stats.p50.toFixed(3)),
    p95: Number(stats.p95.toFixed(3)),
    min: Number(stats.min.toFixed(3)),
    max: Number(stats.max.toFixed(3)),
  };
}

function toCompactConfidenceStats(stats: ConfidenceStats): ConfidenceStats {
  return {
    ...stats,
    mean: Number(stats.mean.toFixed(3)),
    sd: Number(stats.sd.toFixed(3)),
    se: Number(stats.se.toFixed(3)),
    ci95: [Number(stats.ci95[0].toFixed(3)), Number(stats.ci95[1].toFixed(3))],
    min: Number(stats.min.toFixed(3)),
    max: Number(stats.max.toFixed(3)),
  };
}

function byteLengthUtf8(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: Record<string, string> }
): Promise<CommandResult> {
  return new Promise((resolveResult, rejectResult) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectResult(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const t1 = process.hrtime.bigint();
      if (timedOut) {
        rejectResult(
          new Error(
            `Command timed out after ${opts.timeoutMs}ms: ${cmd} ${args.join(" ")}`
          )
        );
        return;
      }
      resolveResult({
        code: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        ms: Number(t1 - t0) / 1e6,
      });
    });
  });
}

function parseJsonMaybe<T>(raw: string): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function runMcpx(
  args: string[],
  configDir: string,
  timeoutMs: number
): Promise<CommandResult> {
  return runCommand(
    "node",
    ["--import", "tsx", mcpxEntry, "--config-dir", configDir, ...args],
    {
      cwd: repoRoot,
      timeoutMs,
      env: { FORCE_COLOR: "0", NODE_NO_WARNINGS: "1" },
    }
  );
}

async function runDirectSpawnedCall(
  serverPath: string,
  timeoutMs: number
): Promise<CommandResult> {
  const script = `
    import { McpClient } from ${JSON.stringify(resolve(repoRoot, "src/mcp/client.ts"))};
    const serverPath = ${JSON.stringify(serverPath)};
    const client = new McpClient();
    await client.connect({ command: "node", args: ["--import", "tsx", serverPath] });
    const result = await client.callTool("greet", { name: "World" });
    await client.close();
    console.log(JSON.stringify(result));
  `.trim();

  return runCommand("node", ["--import", "tsx", "-e", script], {
    cwd: repoRoot,
    timeoutMs,
    env: { FORCE_COLOR: "0", NODE_NO_WARNINGS: "1" },
  });
}

async function benchDirectInProcess(
  serverPath: string,
  coldRuns: number,
  warmRuns: number
): Promise<DirectInProcessBenchmark> {
  const coldConnect: number[] = [];
  const coldList: number[] = [];
  const coldCall: number[] = [];
  const coldTotal: number[] = [];

  for (let i = 0; i < coldRuns; i++) {
    const client = new McpClient();
    const t0 = performance.now();
    const t1 = performance.now();
    await client.connect({ command: "node", args: ["--import", "tsx", serverPath] });
    const t2 = performance.now();
    await client.listTools();
    const t3 = performance.now();
    await client.callTool("greet", { name: "World" });
    const t4 = performance.now();
    await client.close();
    const t5 = performance.now();
    coldConnect.push(t2 - t1);
    coldList.push(t3 - t2);
    coldCall.push(t4 - t3);
    coldTotal.push(t5 - t0);
  }

  const warmClient = new McpClient();
  await warmClient.connect({ command: "node", args: ["--import", "tsx", serverPath] });
  await warmClient.listTools();
  const warmCall: number[] = [];
  for (let i = 0; i < warmRuns; i++) {
    const t0 = performance.now();
    await warmClient.callTool("greet", { name: "World" });
    const t1 = performance.now();
    warmCall.push(t1 - t0);
  }
  await warmClient.close();

  const payloadClient = new McpClient();
  await payloadClient.connect({ command: "node", args: ["--import", "tsx", serverPath] });
  const tools = await payloadClient.listTools();
  const call = await payloadClient.callTool("greet", { name: "World" });
  await payloadClient.close();

  return {
    cold: {
      totalMs: toCompactStats(summarize(coldTotal)),
      connectMs: toCompactStats(summarize(coldConnect)),
      listMs: toCompactStats(summarize(coldList)),
      callMs: toCompactStats(summarize(coldCall)),
    },
    warm: {
      callMs: toCompactStats(summarize(warmCall)),
    },
    payloadBytes: {
      list: byteLengthUtf8(JSON.stringify({ tools })),
      call: byteLengthUtf8(JSON.stringify(call)),
    },
  };
}

function buildServersConfig(alias: string, serverPath: string): string {
  const config = {
    mcpServers: {
      [alias]: {
        command: "node",
        args: ["--import", "tsx", serverPath],
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

async function runSingleBenchmark(opts: CliOptions): Promise<SingleBenchmarkRun> {
  const startedAt = new Date();
  const runStart = process.hrtime.bigint();

  const configDir = opts.configDir ?? mkdtempSync(join(tmpdir(), "mcpx-bench-"));
  const createdTempConfigDir = !opts.configDir;

  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "servers.json"), buildServersConfig(opts.alias, opts.serverPath));

  let daemonWasStarted = false;

  try {
    const direct = await benchDirectInProcess(
      opts.serverPath,
      opts.coldRuns,
      opts.warmRuns
    );

    const directSpawnDurations: number[] = [];
    let directSpawnPayloadBytes = 0;
    for (let i = 0; i < opts.spawnRuns; i++) {
      const res = await runDirectSpawnedCall(opts.serverPath, opts.timeoutMs);
      if (res.code !== 0) {
        throw new Error(
          `Direct spawned call failed (exit ${res.code}): ${res.stderr || res.stdout}`
        );
      }
      directSpawnDurations.push(res.ms);
      if (i === 0) {
        directSpawnPayloadBytes = byteLengthUtf8(res.stdout);
      }
    }
    const directSpawnStats = toCompactStats(summarize(directSpawnDurations));

    const inlineDurations: number[] = [];
    let mcpxInlinePayloadBytes = 0;
    for (let i = 0; i < opts.inlineRuns; i++) {
      const res = await runMcpx(
        [
          "-s",
          `node --import tsx ${opts.serverPath}`,
          "exec",
          "greet",
          "--name",
          "World",
        ],
        configDir,
        opts.timeoutMs
      );
      if (res.code !== 0) {
        throw new Error(
          `mcpx inline exec failed (exit ${res.code}): ${res.stderr || res.stdout}`
        );
      }
      inlineDurations.push(res.ms);
      if (i === 0) {
        mcpxInlinePayloadBytes = byteLengthUtf8(res.stdout);
      }
    }
    const inlineStats = toCompactStats(summarize(inlineDurations));

    const listOut = await runMcpx(["list", `/${opts.alias}`], configDir, opts.timeoutMs);
    const schemaOut = await runMcpx(
      ["schema", `/${opts.alias}`, "greet"],
      configDir,
      opts.timeoutMs
    );
    const aliasCallOut = await runMcpx(
      [`/${opts.alias}`, "greet", "--params", JSON.stringify({ name: "World" })],
      configDir,
      opts.timeoutMs
    );
    if (listOut.code !== 0 || schemaOut.code !== 0 || aliasCallOut.code !== 0) {
      throw new Error("mcpx payload probe commands failed");
    }

    let daemonResult: DaemonBenchmarkResult = { available: false };
    if (opts.tryDaemon) {
      await runMcpx(["daemon", "stop"], configDir, opts.timeoutMs).catch(() => {
        // best effort
      });

      const daemonStart = await runMcpx(["daemon", "start"], configDir, opts.timeoutMs);
      const startJson = parseJsonMaybe<{ ok: boolean; error?: { message: string } }>(
        daemonStart.stdout
      );

      if (daemonStart.code === 0 && startJson?.ok === true) {
        daemonWasStarted = true;
        const aliasDurations: number[] = [];
        let firstCallMs = 0;
        let firstCallExitCode = 0;

        for (let i = 0; i < opts.aliasRuns; i++) {
          const res = await runMcpx(
            [`/${opts.alias}`, "greet", "--params", JSON.stringify({ name: "World" })],
            configDir,
            opts.timeoutMs
          );
          if (i === 0) {
            firstCallMs = Number(res.ms.toFixed(3));
            firstCallExitCode = res.code;
          } else if (res.code === 0) {
            aliasDurations.push(res.ms);
          }
        }

        daemonResult = {
          available: true,
          startCommand: daemonStart,
          firstCallMs,
          firstCallExitCode,
          warmCallsMs:
            aliasDurations.length > 0
              ? toCompactStats(summarize(aliasDurations))
              : undefined,
        };
      } else {
        daemonResult = {
          available: false,
          reason: (startJson?.error?.message ?? daemonStart.stderr) || "daemon start failed",
          startCommand: daemonStart,
        };
      }
    }

    const payloadBytes = {
      directList: direct.payloadBytes.list,
      directCall: direct.payloadBytes.call,
      directSpawnCall: directSpawnPayloadBytes,
      mcpxInlineCall: mcpxInlinePayloadBytes,
      mcpxList: byteLengthUtf8(listOut.stdout),
      mcpxSchema: byteLengthUtf8(schemaOut.stdout),
      mcpxAliasCall: byteLengthUtf8(aliasCallOut.stdout),
    };

    const report: SingleBenchmarkReport = {
      benchmark: "mcp-vs-mcpx",
      generatedAt: new Date().toISOString(),
      startedAt: startedAt.toISOString(),
      environment: {
        platform: process.platform,
        nodeVersion: process.version,
        cwd: process.cwd(),
        repoRoot,
      },
      config: {
        alias: opts.alias,
        serverPath: opts.serverPath,
        configDir,
        runs: {
          directCold: opts.coldRuns,
          directWarm: opts.warmRuns,
          directSpawn: opts.spawnRuns,
          mcpxInline: opts.inlineRuns,
          mcpxAlias: opts.aliasRuns,
        },
        timeoutMs: opts.timeoutMs,
      },
      latencyMs: {
        directInProcess: direct,
        directSpawnedCall: directSpawnStats,
        mcpxInlineExec: inlineStats,
        mcpxAliasViaDaemon: daemonResult,
      },
      payloadBytes,
      tokenBudgetEstimate: {
        knownToolCall: {
          direct: tokensFromBytes(payloadBytes.directCall),
          mcpx: tokensFromBytes(payloadBytes.mcpxAliasCall),
        },
        discoverAndCall: {
          direct: tokensFromBytes(payloadBytes.directList + payloadBytes.directCall),
          mcpx: tokensFromBytes(payloadBytes.mcpxList + payloadBytes.mcpxAliasCall),
        },
        discoverSchemaAndCall: {
          direct: tokensFromBytes(payloadBytes.directList + payloadBytes.directCall),
          mcpx: tokensFromBytes(
            payloadBytes.mcpxList + payloadBytes.mcpxSchema + payloadBytes.mcpxAliasCall
          ),
        },
      },
      relativeOverheads: {
        mcpxInlineVsDirectSpawn: Number(
          (inlineStats.mean / directSpawnStats.mean).toFixed(3)
        ),
        mcpxAliasWarmVsDirectSpawn:
          daemonResult.available && daemonResult.warmCallsMs
            ? Number((daemonResult.warmCallsMs.mean / directSpawnStats.mean).toFixed(3))
            : null,
      },
      notes: [
        "Token estimate uses ~4 chars/token heuristic.",
        "Direct in-process warm call measures pure MCP call latency with an already connected client.",
        "CLI benchmarks include process startup cost.",
      ],
    };

    const runEnd = process.hrtime.bigint();
    return {
      report,
      runDurationMs: Number(runEnd - runStart) / 1e6,
    };
  } finally {
    if (daemonWasStarted) {
      try {
        await runMcpx(["daemon", "stop"], configDir, opts.timeoutMs);
      } catch {
        // best effort
      }
    }
    if (createdTempConfigDir && !opts.keepConfigDir) {
      try {
        rmSync(configDir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  }
}

function buildRepeatabilityReport(
  opts: CliOptions,
  runs: SingleBenchmarkRun[]
): Record<string, unknown> {
  const perRun = runs.map((r, idx) => ({
    run: idx + 1,
    generatedAt: r.report.generatedAt,
    directSpawnedCallMeanMs: r.report.latencyMs.directSpawnedCall.mean,
    mcpxInlineExecMeanMs: r.report.latencyMs.mcpxInlineExec.mean,
    mcpxAliasWarmMeanMs: r.report.latencyMs.mcpxAliasViaDaemon.warmCallsMs?.mean ?? null,
    overheadInlineVsDirectSpawn: r.report.relativeOverheads.mcpxInlineVsDirectSpawn,
    overheadAliasWarmVsDirectSpawn: r.report.relativeOverheads.mcpxAliasWarmVsDirectSpawn,
    durationMs: Number(r.runDurationMs.toFixed(3)),
  }));

  const confidence95 = {
    directInProcessColdMeanMs: {
      ...toCompactConfidenceStats(
        summarizeCI(runs.map((r) => r.report.latencyMs.directInProcess.cold.totalMs.mean))
      ),
      available: runs.length,
      missing: 0,
    },
    directInProcessWarmCallMeanMs: {
      ...toCompactConfidenceStats(
        summarizeCI(runs.map((r) => r.report.latencyMs.directInProcess.warm.callMs.mean))
      ),
      available: runs.length,
      missing: 0,
    },
    directSpawnedCallMeanMs: {
      ...toCompactConfidenceStats(
        summarizeCI(runs.map((r) => r.report.latencyMs.directSpawnedCall.mean))
      ),
      available: runs.length,
      missing: 0,
    },
    mcpxInlineExecMeanMs: {
      ...toCompactConfidenceStats(
        summarizeCI(runs.map((r) => r.report.latencyMs.mcpxInlineExec.mean))
      ),
      available: runs.length,
      missing: 0,
    },
    mcpxAliasWarmMeanMs: summarizeOptionalMetric(
      runs.map((r) => r.report.latencyMs.mcpxAliasViaDaemon.warmCallsMs?.mean),
      "Daemon metrics unavailable in at least one run."
    ),
    overheadInlineVsDirectSpawn: {
      ...toCompactConfidenceStats(
        summarizeCI(runs.map((r) => r.report.relativeOverheads.mcpxInlineVsDirectSpawn))
      ),
      available: runs.length,
      missing: 0,
    },
    overheadAliasWarmVsDirectSpawn: summarizeOptionalMetric(
      runs.map((r) => r.report.relativeOverheads.mcpxAliasWarmVsDirectSpawn),
      "Alias warm overhead unavailable in at least one run."
    ),
    runDurationMs: {
      ...toCompactConfidenceStats(summarizeCI(runs.map((r) => r.runDurationMs))),
      available: runs.length,
      missing: 0,
    },
  };

  return {
    benchmark: "mcp-vs-mcpx-repeatability",
    generatedAt: new Date().toISOString(),
    profile: {
      runs: opts.repeat,
      alias: opts.alias,
      serverPath: opts.serverPath,
      timeoutMs: opts.timeoutMs,
      perRunSamples: {
        directCold: opts.coldRuns,
        directWarm: opts.warmRuns,
        directSpawn: opts.spawnRuns,
        mcpxInline: opts.inlineRuns,
        mcpxAlias: opts.aliasRuns,
      },
      configDirMode: opts.configDir ? "reused" : "temp-per-run",
    },
    perRun,
    confidence95,
    notes: [
      "95% confidence intervals use a t-distribution over per-run means.",
      "When daemon is unavailable for some runs, daemon-derived CI fields report availability and missing counts.",
    ],
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.repeat === 1) {
    const { report } = await runSingleBenchmark(opts);
    const spacing = opts.pretty ? 2 : 0;
    console.log(JSON.stringify(report, null, spacing));
    return;
  }

  const runs: SingleBenchmarkRun[] = [];
  for (let i = 0; i < opts.repeat; i++) {
    runs.push(await runSingleBenchmark(opts));
  }
  const repeatReport = buildRepeatabilityReport(opts, runs);
  const spacing = opts.pretty ? 2 : 0;
  console.log(JSON.stringify(repeatReport, null, spacing));
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const compact = {
    ok: false,
    error: msg,
  };
  console.error(JSON.stringify(compact, null, 2));
  process.exit(1);
});
