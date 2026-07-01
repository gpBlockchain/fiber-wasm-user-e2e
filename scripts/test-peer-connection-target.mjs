import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

const tempDir = await mkdtemp(path.join(tmpdir(), "fiber-peer-connection-"));

const { selectPeerConnectionTarget } = await importTranspiledTs("src/peerConnection.ts");
const { DEFAULT_FORM_VALUES, getFlowStepDefinitions } = await importTranspiledTs("src/constants.ts");
const { createGraphSyncChartModel, summarizeGraphSyncSamples } = await importTranspiledTs("src/graphSync.ts");
const { createKeysendPaymentParams } = await importTranspiledTs("src/paymentParams.ts");

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

test("uses a one hour default send_payment timeout", () => {
  assert.equal(DEFAULT_FORM_VALUES.paymentTimeoutMs, 60 * 60 * 1000);
});

test("sets send_payment timeout to one hour in RPC params", () => {
  assert.deepEqual(createKeysendPaymentParams("02abc", "1000", DEFAULT_FORM_VALUES.paymentTimeoutMs), {
    target_pubkey: "02abc",
    amount: "0x3e8",
    keysend: true,
    timeout: "0xe10"
  });
});

test("sets dry-run send_payment timeout to one hour in RPC params", () => {
  assert.deepEqual(
    createKeysendPaymentParams("02abc", "1000", DEFAULT_FORM_VALUES.paymentTimeoutMs, true),
    {
      target_pubkey: "02abc",
      amount: "0x3e8",
      keysend: true,
      timeout: "0xe10",
      dry_run: true
    }
  );
});

test("defines the graph sync rate scenario as startup, sampling, and stop", () => {
  assert.deepEqual(
    getFlowStepDefinitions("testnet-graph-sync-rate").map(([id]) => id),
    ["start", "node-info", "graph-sync-rate", "stop"]
  );
});

test("summarizes graph channel and graph node sync rates per minute", () => {
  assert.deepEqual(
    summarizeGraphSyncSamples(
      [
        { elapsedSeconds: 0, graphChannelsCount: 10, graphNodesCount: 5, listPeersCount: 2 },
        { elapsedSeconds: 30, graphChannelsCount: 20, graphNodesCount: 8, listPeersCount: 3 },
        { elapsedSeconds: 60, graphChannelsCount: 40, graphNodesCount: 11, listPeersCount: 5 }
      ],
      60,
      30,
      "testnet"
    ),
    {
      label: "testnet",
      durationSeconds: 60,
      sampleIntervalSeconds: 30,
      initialGraphChannelsCount: 10,
      finalGraphChannelsCount: 40,
      graphChannelsDelta: 30,
      graphChannelsRatePerMinute: 30,
      initialGraphNodesCount: 5,
      finalGraphNodesCount: 11,
      graphNodesDelta: 6,
      graphNodesRatePerMinute: 6,
      initialListPeersCount: 2,
      finalListPeersCount: 5,
      listPeersDelta: 3,
      listPeersRatePerMinute: 3,
      samples: [
        { elapsedSeconds: 0, graphChannelsCount: 10, graphNodesCount: 5, listPeersCount: 2 },
        { elapsedSeconds: 30, graphChannelsCount: 20, graphNodesCount: 8, listPeersCount: 3 },
        { elapsedSeconds: 60, graphChannelsCount: 40, graphNodesCount: 11, listPeersCount: 5 }
      ]
    }
  );
});

test("uses the configured graph sync duration when the last sample is early", () => {
  const summary = summarizeGraphSyncSamples(
    [
      { elapsedSeconds: 0, graphChannelsCount: 2, graphNodesCount: 3, listPeersCount: 1 },
      { elapsedSeconds: 5, graphChannelsCount: 5, graphNodesCount: 5, listPeersCount: 3 }
    ],
    10,
    5,
    "testnet"
  );

  assert.equal(summary.graphChannelsRatePerMinute, 18);
  assert.equal(summary.graphNodesRatePerMinute, 12);
  assert.equal(summary.listPeersRatePerMinute, 12);
});

test("builds graph sync chart polylines for graph channels, nodes, and peers", () => {
  const chart = createGraphSyncChartModel(
    [
      { elapsedSeconds: 0, graphChannelsCount: 10, graphNodesCount: 5, listPeersCount: 2 },
      { elapsedSeconds: 60, graphChannelsCount: 40, graphNodesCount: 20, listPeersCount: 4 }
    ],
    {
      width: 100,
      height: 100,
      padding: { top: 10, right: 10, bottom: 10, left: 10 }
    }
  );

  assert.deepEqual(chart, {
    width: 100,
    height: 100,
    maxValue: 40,
    maxElapsedSeconds: 60,
    channelPolyline: "10,70 90,10",
    nodePolyline: "10,80 90,50",
    peerPolyline: "10,86 90,82",
    latestChannelCount: 40,
    latestNodeCount: 20,
    latestListPeersCount: 4
  });
});

test("filters graph sync chart model to selected series", () => {
  const chart = createGraphSyncChartModel(
    [
      { elapsedSeconds: 0, graphChannelsCount: 10, graphNodesCount: 5, listPeersCount: 2 },
      { elapsedSeconds: 60, graphChannelsCount: 40, graphNodesCount: 20, listPeersCount: 4 }
    ],
    {
      width: 100,
      height: 100,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      visibleSeries: ["graph_nodes"]
    }
  );

  assert.equal(chart.maxValue, 20);
  assert.equal(chart.channelPolyline, "");
  assert.equal(chart.nodePolyline, "10,70 90,10");
  assert.equal(chart.peerPolyline, "");
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
