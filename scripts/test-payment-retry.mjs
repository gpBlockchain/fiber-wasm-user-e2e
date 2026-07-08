import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const tempDir = await mkdtemp(path.join(tmpdir(), "fiber-payment-retry-"));

const { sendPaymentFlowUntilSuccess } = await importTranspiledTs("src/paymentRetry.ts");

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("restarts the send_payment flow when get_payment returns Failed", async () => {
  const events = [];
  let sendAttempts = 0;

  const client = {
    async dryRunPayment(targetPubkey, amount, timeoutMs) {
      events.push(["dry-run", targetPubkey, amount, timeoutMs]);
      return { dry_run: true };
    },
    async sendPayment(targetPubkey, amount, timeoutMs) {
      sendAttempts += 1;
      events.push(["send", targetPubkey, amount, timeoutMs]);
      return { payment_hash: `hash-${sendAttempts}` };
    },
    async getPayment(paymentHash) {
      events.push(["get", paymentHash]);
      if (paymentHash === "hash-1") {
        return { status: "Failed", failed_error: "no path found" };
      }

      return { status: "Success", payment_hash: paymentHash };
    }
  };

  const result = await sendPaymentFlowUntilSuccess(client, "02target", "1000", {
    paymentTimeoutMs: 1000,
    pollIntervalMs: 0
  });

  assert.deepEqual(result, { status: "Success", payment_hash: "hash-2" });
  assert.deepEqual(events.map((event) => event[0] === "get" ? `${event[0]}:${event[1]}` : event[0]), [
    "dry-run",
    "send",
    "get:hash-1",
    "dry-run",
    "send",
    "get:hash-2"
  ]);
});

async function importTranspiledTs(sourcePath) {
  const source = await readFile(path.resolve(sourcePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      strict: true
    }
  });
  const modulePath = path.join(tempDir, sourcePath.replaceAll("/", "-").replace(/\.ts$/, ".mjs"));
  await writeFile(modulePath, transpiled.outputText);
  return import(pathToFileURL(modulePath).href);
}
