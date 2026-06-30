import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const tempDir = await mkdtemp(path.join(tmpdir(), "fiber-peer-connection-"));

const { selectPeerConnectionTarget } = await importTranspiledTs("src/peerConnection.ts");
const { DEFAULT_FORM_VALUES } = await importTranspiledTs("src/constants.ts");

test.after(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

test("uses peer address when both pubkey and address are provided", () => {
  assert.deepEqual(
    selectPeerConnectionTarget({
      peerPubkey: " 02abc ",
      peerAddress: " /ip4/127.0.0.1/tcp/8228/ws/p2p/QmPeer "
    }),
    {
      mode: "address",
      address: "/ip4/127.0.0.1/tcp/8228/ws/p2p/QmPeer",
      expectedPubkey: "02abc"
    }
  );
});

test("falls back to peer pubkey when peer address is blank", () => {
  assert.deepEqual(
    selectPeerConnectionTarget({
      peerPubkey: " 02abc ",
      peerAddress: " "
    }),
    {
      mode: "pubkey",
      pubkey: "02abc",
      expectedPubkey: "02abc"
    }
  );
});

test("keeps peer pubkey required because later steps open channels by pubkey", () => {
  assert.throws(
    () =>
      selectPeerConnectionTarget({
        peerPubkey: "",
        peerAddress: "/ip4/127.0.0.1/tcp/8228/ws/p2p/QmPeer"
      }),
    /Peer pubkey is required/
  );
});

test("uses bracer as the default peer address", () => {
  assert.equal(
    DEFAULT_FORM_VALUES.testnetPeerAddress,
    "/dns4/bracer.fiber.channel/tcp/443/wss/p2p/QmbKyzq9qUmymW2Gi8Zq7kKVpPiNA1XUJ6uMvsUC4F3p89"
  );
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
