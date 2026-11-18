import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { rebuildReportIndex } from "./rebuild-report-index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commitReportScript = path.join(repoRoot, "scripts", "commit-report.sh");
const tempDir = await mkdtemp(path.join(tmpdir(), "fiber-commit-report-"));

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("rebuildReportIndex keeps both reports and sorts newest first", async () => {
  const reportsDir = path.join(tempDir, "rebuild-unit", "public", "reports");
  await mkdir(reportsDir, { recursive: true });
  await writeReport(reportsDir, failedReport());
  await writeReport(reportsDir, successReport());
  await writeFile(path.join(reportsDir, "index.json"), "{ invalid");
  await writeFile(path.join(reportsDir, "notes.txt"), "ignore me");

  const index = await rebuildReportIndex(reportsDir);
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(
    index.reports.map((entry) => entry.runId),
    [successReport().summary.runId, failedReport().summary.runId]
  );
  assert.equal(index.reports[0].status, "success");
  assert.equal(index.reports[1].status, "failed");
  assert.equal(index.reports[0].file, `reports/${reportFileName(successReport())}`);
});

test("commit-report rebases a later report onto a previously pushed report without force", async () => {
  const fixture = path.join(tempDir, "push-race");
  const origin = path.join(fixture, "origin.git");
  const attempt1 = path.join(fixture, "attempt1");
  const attempt2 = path.join(fixture, "attempt2");

  git(["init", "--bare", "--initial-branch=main", origin]);

  git(["clone", origin, attempt1]);
  await writeReport(path.join(attempt1, "public", "reports"), baseReport());
  await rebuildReportIndex(path.join(attempt1, "public", "reports"));
  gitIn(attempt1, ["add", "public/reports"]);
  gitIn(attempt1, ["commit", "-m", "seed reports"]);
  gitIn(attempt1, ["push", "origin", "main"]);
  const baseSha = gitIn(attempt1, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  await writeReport(path.join(attempt1, "public", "reports"), failedReport());
  await rebuildReportIndex(path.join(attempt1, "public", "reports"));
  gitIn(attempt1, ["add", "public/reports"]);
  gitIn(attempt1, ["commit", "-m", "Add daily Fiber WASM scenario report"]);
  gitIn(attempt1, ["push", "origin", "main"]);

  // Match CI: checkout the original run SHA with fetch-depth 1, then add a newer report.
  execFileSync("git", ["init", "-b", "main", attempt2], { stdio: "pipe" });
  gitIn(attempt2, ["remote", "add", "origin", origin]);
  gitIn(attempt2, ["fetch", "--depth", "1", "origin", baseSha]);
  gitIn(attempt2, ["checkout", "--detach", "FETCH_HEAD"]);
  gitIn(attempt2, ["checkout", "-B", "main"]);
  assert.equal(gitIn(attempt2, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), baseSha);
  assert.equal(gitIn(attempt2, ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim(), "true");

  await writeReport(path.join(attempt2, "public", "reports"), successReport());
  await rebuildReportIndex(path.join(attempt2, "public", "reports"));

  execFileSync("bash", [commitReportScript], {
    cwd: attempt2,
    env: {
      ...process.env,
      REPORT_REPO_ROOT: attempt2,
      REPORT_REMOTE: "origin",
      REPORT_BRANCH: "main",
      GIT_AUTHOR_NAME: "github-actions[bot]",
      GIT_AUTHOR_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GIT_COMMITTER_NAME: "github-actions[bot]",
      GIT_COMMITTER_EMAIL: "41898282+github-actions[bot]@users.noreply.github.com",
      GITHUB_EVENT_NAME: "schedule",
      GITHUB_RUN_ATTEMPT: "2",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REF_NAME: "main",
      GITHUB_SHA: baseSha
    },
    stdio: "pipe"
  });

  const inspect = path.join(fixture, "inspect");
  git(["clone", origin, inspect]);
  const log = gitIn(inspect, ["log", "--oneline", "--decorate"], { encoding: "utf8" });
  assert.match(log, /Add daily Fiber WASM scenario report/);
  assert.doesNotMatch(log, /\(forced update\)/);

  const reportNames = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
    cwd: inspect,
    encoding: "utf8"
  })
    .split("\n")
    .filter((name) => name.startsWith("public/reports/") && name.endsWith(".json"));
  assert(reportNames.includes(`public/reports/${reportFileName(failedReport())}`));
  assert(reportNames.includes(`public/reports/${reportFileName(successReport())}`));

  const index = JSON.parse(await readFile(path.join(inspect, "public", "reports", "index.json"), "utf8"));
  assert.deepEqual(
    index.reports.map((entry) => entry.runId),
    [successReport().summary.runId, failedReport().summary.runId, baseReport().summary.runId]
  );
  assert.equal(index.reports[0].status, "success");

  const firstParent = gitIn(inspect, ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
  const attempt1Sha = gitIn(attempt1, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(firstParent, attempt1Sha, "later report should rebase onto the already-pushed commit, not replace it");
});

test("commit-report exits cleanly when there are no report changes", async () => {
  const fixture = path.join(tempDir, "no-changes");
  const origin = path.join(fixture, "origin.git");
  const work = path.join(fixture, "work");
  git(["init", "--bare", "--initial-branch=main", origin]);
  git(["clone", origin, work]);
  await mkdir(path.join(work, "public", "reports"), { recursive: true });
  await writeFile(path.join(work, "README.md"), "seed\n");
  gitIn(work, ["add", "README.md"]);
  gitIn(work, ["commit", "-m", "seed"]);
  gitIn(work, ["push", "origin", "main"]);
  const sha = gitIn(work, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const output = execFileSync("bash", [commitReportScript], {
    cwd: work,
    env: {
      ...process.env,
      REPORT_REPO_ROOT: work,
      REPORT_REMOTE: "origin",
      REPORT_BRANCH: "main"
    },
    encoding: "utf8"
  });
  assert.match(output, /No report changes to commit/);
  assert.equal(gitIn(work, ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sha);
});

function git(args, options = {}) {
  return execFileSync("git", args, { stdio: "pipe", ...options });
}

function gitIn(cwd, args, options = {}) {
  return execFileSync(
    "git",
    ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", ...args],
    { cwd, stdio: "pipe", ...options }
  );
}

function reportFileName(report) {
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  return `${timestamp}-${report.summary.scenario}-${report.summary.runId}.json`;
}

async function writeReport(reportsDir, report) {
  await mkdir(reportsDir, { recursive: true });
  await writeFile(
    path.join(reportsDir, reportFileName(report)),
    `${JSON.stringify({ ...report, source: "ci" }, null, 2)}\n`
  );
}

function baseReport() {
  return {
    generatedAt: "2026-11-15T02:11:20.836Z",
    summary: {
      runId: "981531de-ef2d-41c2-be7b-6b8e7a788a9d",
      scenario: "testnet-single",
      status: "success",
      startedAt: "2026-11-15T02:04:00.101Z",
      endedAt: "2026-11-15T02:11:20.828Z",
      durationMs: 440727
    }
  };
}

function failedReport() {
  return {
    generatedAt: "2026-11-18T02:19:49.990Z",
    summary: {
      runId: "9b7051c5-d748-468e-8f77-8b5b241877a9",
      scenario: "testnet-single",
      status: "failed",
      startedAt: "2026-11-18T02:07:56.613Z",
      endedAt: "2026-11-18T02:19:49.981Z",
      durationMs: 713368,
      lastError: "Restart recovery did not restore peer and channel visibility before timeout."
    }
  };
}

function successReport() {
  return {
    generatedAt: "2026-11-18T06:55:40.771Z",
    summary: {
      runId: "283ebc6c-df61-467c-808f-6a9de3196962",
      scenario: "testnet-single",
      status: "success",
      startedAt: "2026-11-18T06:48:24.000Z",
      endedAt: "2026-11-18T06:55:40.771Z",
      durationMs: 436771
    }
  };
}
