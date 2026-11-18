import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
  process.env.REPORT_REPO_ROOT ?? path.dirname(fileURLToPath(import.meta.url)),
  process.env.REPORT_REPO_ROOT ? "." : ".."
);
const reportsDir = path.join(rootDir, "public", "reports");

export async function rebuildReportIndex(dir = reportsDir) {
  const names = await readdir(dir);
  const entries = [];

  for (const name of names) {
    if (name === "index.json" || !name.endsWith(".json")) {
      continue;
    }

    let report;
    try {
      report = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    } catch {
      continue;
    }

    if (!report?.summary?.runId) {
      continue;
    }

    entries.push({
      ...report.summary,
      generatedAt: report.generatedAt,
      source: report.source ?? "ci",
      file: `reports/${name}`
    });
  }

  entries.sort((a, b) => String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? "")));

  const seen = new Set();
  const reports = [];
  for (const entry of entries) {
    if (seen.has(entry.runId)) {
      continue;
    }
    seen.add(entry.runId);
    reports.push(entry);
  }

  const limited = reports.slice(0, Number(process.env.CI_REPORT_HISTORY_LIMIT ?? 90));
  const index = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    reports: limited
  };
  await writeFile(path.join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const index = await rebuildReportIndex();
  console.log(`Rebuilt report index with ${index.reports.length} entries`);
}
