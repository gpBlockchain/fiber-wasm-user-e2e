import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = path.join(rootDir, "public", "reports");
const reportIndexPath = path.join(reportsDir, "index.json");
const port = Number(process.env.CI_VITE_PORT ?? 5173);
const baseUrl = `http://127.0.0.1:${port}`;
const scenario = process.env.CI_SCENARIO ?? "testnet-single";
const timeoutMs = Number(process.env.CI_SCENARIO_TIMEOUT_MS ?? 30 * 60 * 1000);

let server;
let browser;

try {
  await mkdir(reportsDir, { recursive: true });
  server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  await waitForServer(baseUrl);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#scenario").selectOption(scenario);
  await applyEnvironmentConfig(page);

  await page.locator("#run-flow").click();
  await page
    .locator("#run-status")
    .filter({ hasText: /Finished|Failed/ })
    .waitFor({ timeout: timeoutMs });

  const report = await readReportFromPage(page);
  const fileName = createReportFileName(report);
  const filePath = path.join(reportsDir, fileName);
  await writeFile(filePath, `${JSON.stringify({ ...report, source: "ci" }, null, 2)}\n`);
  await updateReportIndex(report, `reports/${fileName}`);

  console.log(`Wrote ${path.relative(rootDir, filePath)}`);
} finally {
  await browser?.close();
  server?.kill("SIGTERM");
}

async function applyEnvironmentConfig(page) {
  const today = new Date().toISOString().slice(0, 10);
  const runSuffix = new Date().toISOString().replace(/[:.]/g, "-");
  const defaults = {
    "#database-prefix": `ci-${scenario}-${today}-${runSuffix}`,
    "#peer-pubkey": process.env.CI_PEER_PUBKEY,
    "#payment-target-pubkey": process.env.CI_PAYMENT_TARGET_PUBKEY,
    "#fiber-secret-key": process.env.CI_FIBER_SECRET_KEY,
    "#ckb-secret-key": process.env.CI_CKB_SECRET_KEY,
    "#funding-amount": process.env.CI_FUNDING_AMOUNT,
    "#payment-amount": process.env.CI_PAYMENT_AMOUNT,
    "#local-node-count": process.env.CI_LOCAL_NODE_COUNT,
    "#local-nodes-json": process.env.CI_LOCAL_NODES_JSON,
    "#fiber-config": process.env.CI_FIBER_CONFIG
  };

  for (const [selector, value] of Object.entries(defaults)) {
    if (value) {
      await page.locator(selector).fill(value);
    }
  }
}

async function readReportFromPage(page) {
  const rawReport = await page.locator("#latest-report-json").textContent({ timeout: 10_000 });
  if (!rawReport || rawReport.trim() === "{}") {
    throw new Error("The page did not generate a report JSON payload.");
  }
  return JSON.parse(rawReport);
}

async function updateReportIndex(report, file) {
  const index = await readReportIndex();
  const nextEntry = {
    ...report.summary,
    generatedAt: report.generatedAt,
    source: "ci",
    file
  };
  const reports = [
    nextEntry,
    ...index.reports.filter((entry) => entry.runId !== nextEntry.runId)
  ].slice(0, Number(process.env.CI_REPORT_HISTORY_LIMIT ?? 90));

  await writeFile(
    reportIndexPath,
    `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), reports }, null, 2)}\n`
  );
}

async function readReportIndex() {
  try {
    const raw = await readFile(reportIndexPath, "utf8");
    const index = JSON.parse(raw);
    return Array.isArray(index.reports) ? index : { schemaVersion: 1, reports: [] };
  } catch {
    return { schemaVersion: 1, reports: [] };
  }
}

function createReportFileName(report) {
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  return `${timestamp}-${report.summary.scenario}-${report.summary.runId}.json`;
}

async function waitForServer(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

