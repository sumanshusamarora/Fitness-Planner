#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("npm", ["run", "coach", "--", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
