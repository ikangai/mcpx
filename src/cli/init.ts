import { input, confirm } from "@inquirer/prompts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addServer, importServers } from "../config/store.js";

export async function runInit(): Promise<void> {
  console.log("\nWelcome to mcpx! Let's get you set up.\n");

  // Check for Claude Desktop config
  const claudeConfigs = [
    join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
    join(homedir(), ".config", "claude", "claude_desktop_config.json"),
  ];
  const claudeConfig = claudeConfigs.find((p) => existsSync(p));

  if (claudeConfig) {
    const doImport = await confirm({
      message: `Found Claude Desktop config. Import servers?`,
      default: true,
    });
    if (doImport) {
      const imported = importServers(claudeConfig);
      if (imported.length > 0) {
        console.log(`  Imported: ${imported.join(", ")}\n`);
      } else {
        console.log("  No new servers to import.\n");
      }
    }
  }

  // Ask to add a server manually
  const addManual = await confirm({
    message: "Add a server manually?",
    default: !claudeConfig,
  });

  if (addManual) {
    const alias = await input({
      message: "Server alias (short name):",
      validate: (v) => v.trim().length > 0 || "Alias cannot be empty",
    });
    const command = await input({
      message: "Server command (e.g., npx @mcp/server-weather):",
      validate: (v) => v.trim().length > 0 || "Command cannot be empty",
    });
    addServer(alias, command);
    console.log(`\n  Registered "${alias}". Try: mcpx list /${alias}\n`);
  }

  console.log("Setup complete! Quick start:");
  console.log("  mcpx servers              # see registered servers");
  console.log("  mcpx list /server         # list tools");
  console.log("  mcpx /server tool --help  # tool usage");
  console.log("  mcpx interactive /server  # explore interactively\n");
}
