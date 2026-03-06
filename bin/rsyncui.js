#!/usr/bin/env node

const { spawn } = require("child_process");
const { startServer } = require("../server");

function openBrowser(url) {
  const platform = process.platform;

  if (platform === "darwin") {
    return spawn("open", [url], { stdio: "ignore", detached: true });
  }

  if (platform === "win32") {
    return spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  }

  return spawn("xdg-open", [url], { stdio: "ignore", detached: true });
}

async function main() {
  const { address } = await startServer();

  if (process.argv.includes("--no-open")) {
    return;
  }

  try {
    const child = openBrowser(address);
    child.unref();
  } catch (error) {
    console.warn(`Failed to open browser automatically: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
