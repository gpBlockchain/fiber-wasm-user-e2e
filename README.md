# Fiber WASM Testnet Demo

Browser-based demo for running a real Fiber WASM node with
`@nervosnetwork/fiber-js` and visualizing the testnet user journey.

The demo is intentionally separate from `test_cases/`. It is a manual
operator-facing tool, not an integration test.

## What It Does

`Testnet single node` runs this flow against a configured testnet peer:

1. Start a WASM Fiber node in the browser.
2. Run `node_info`.
3. Run `graph_channels`.
4. Connect to a configured testnet peer by pubkey, retrying `connect_peer`
   until `list_peers` shows the peer.
5. Open a public channel.
6. Poll `list_channels` until the new channel reaches `ChannelReady`.
7. Poll `graph_channels` until the new channel is visible in the graph.
8. Run keysend `send_payment` with `dry_run: true` until the RPC call returns without error.
9. Send the real keysend payment.
10. Stop and restart the WASM node with the same IndexedDB prefix.
11. Confirm peer and channel visibility after restart.
12. Run dry-run again until it returns without error, then send another real keysend payment.
13. Run `shutdown_channel` for ready channels and wait until they reach `Closed`.

Each step records status, timestamps, duration, result payload, and error
details. The raw JSON export at the bottom of the page can be copied into a
report or issue.

`Local multi-node` is a separate scenario with its own multi-node flow:

1. Start N browser-side WASM Fiber nodes.
2. Run `node_info` for every local node.
3. Connect each local node to its configured external Fiber peer by pubkey,
   retrying `connect_peer` until `list_peers` shows the peer.
4. Open one public channel from each local node to its external peer.
5. Poll `list_channels` until every new channel reaches `ChannelReady`.
6. Poll `graph_channels` until each local node sees the other local nodes'
   newly created channels.
7. Attempt keysend payments between every ordered local node pair.
8. Stop every browser-side local node without deleting IndexedDB.
9. Restart every local node with the same key and database prefix.
10. Confirm peer and channel visibility after restart.
11. Attempt keysend payments between every ordered local node pair again.
12. Run `shutdown_channel` for ready channels on every local node.

Local nodes use different IndexedDB prefixes and node-specific Fiber and CKB
keys. Each configured CKB key must already have testnet CKB balance; random keys
are only useful as identity placeholders and cannot fund channels. Browser-side
networking support still depends on the current `fiber-js` WASM transport
behavior. For this scenario, use the live RPC log and raw JSON export as the
primary detail view.

## Requirements

- Node.js 18+
- Chrome or Chromium
- A testnet CKB key with enough balance to fund a Fiber channel
- A reachable external Fiber testnet peer pubkey

The app requires `SharedArrayBuffer`, so it must be served with:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

The included Vite config sets these headers for both `dev` and `preview`.

## Install

```bash
cd fiber-wasm-testnet-demo
npm install
```

## Run

```bash
npm run dev
```

Open the Vite URL in Chrome or Chromium. The top-right runtime badge should
show `SharedArrayBuffer ready`.

## Build

```bash
npm run typecheck
npm run build
```

## Reports and History

When a flow reaches `Finished` or `Failed`, the page generates a structured
report JSON. The report includes a summary, the bounded raw run snapshot, step
results, metrics, flow logs, capped RPC logs, and browser environment data.

- Use the JSON button in the `Raw JSON` panel to download the latest report.
- Open `?view=history` or the `History` tab to inspect previous reports.
- Browser-generated reports are kept in local storage.
- CI-generated reports are read from `public/reports/index.json` and the JSON
  files referenced there.

## Daily CI Scenario

`.github/workflows/daily-scenario.yml` runs once per day and can also be started
manually with `workflow_dispatch`. It starts Vite with COOP/COEP headers, opens
Chromium with Playwright, runs the `Testnet single node` scenario, writes a
report under `public/reports/`, updates `public/reports/index.json`, and commits
the result.

Configure this GitHub secret before expecting a successful funded run:

- `CI_CKB_SECRET_KEY`

If the funded key or peer is unavailable, the workflow still records the failed
run as a report so the history page shows what broke.

## Inputs

- The step panel is written as a teaching path: each scenario has a learning
  goal, the current step explains the concept being tested, and every step
  lists what users should watch in the logs or metrics.
- `Fiber secret key`
  Used by the WASM Fiber node identity.
- `CKB secret key`
  Used for CKB signing and channel funding. The page generates a random key by
  default, but a random key will not have testnet funds. The page derives the
  corresponding testnet CKB address with `@ckb-ccc/core` so you can verify the
  balance before running the flow.
- `Database prefix`
  IndexedDB namespace for this browser-side Fiber node. Reuse it to test restart
  persistence; change it to start from fresh local state. Use `Delete
  IndexedDB` to remove databases matching the current prefix.
- `Peer pubkey`
  Remote Fiber node pubkey used for `connect_peer`, `open_channel`, and restart
  recovery checks.
- `Funding amount`
  Channel funding amount in shannons.
- `Payment target pubkey`
  Keysend target. If empty, the app uses `Peer pubkey`.
- `Payment amount`
  Keysend amount in shannons.
- `Scenario`
  `Testnet single node` and `Local multi-node` use different step lists,
  validations, metric cards, and form/config presets. Switching scenarios
  preserves each scenario's in-progress draft so single-node values do not
  bleed into local multi-node runs.
- `Local node count`
  Number of local WASM nodes used by the local multi-node scenario.
- `Local nodes JSON`
  Array of local node configs used only by `Local multi-node`. It must define
  exactly `Local node count` entries. Every entry needs a unique
  `fiberSecretKeyHex`, a unique funded `ckbSecretKeyHex`, a unique
  `externalPeerPubkey`, and may optionally set `fundingAmount` and
  `databasePrefix`. The page derives every configured local CKB address and can
  delete the IndexedDB databases for those local prefixes.
- `Fiber config`
  YAML config passed directly to `Fiber.start`.

Example `Local nodes JSON`:

```json
[
  {
    "name": "local-1",
    "fiberSecretKeyHex": "0x...",
    "ckbSecretKeyHex": "0x...",
    "externalPeerPubkey": "02...",
    "fundingAmount": "100000000000",
    "databasePrefix": "testnet-demo-local-1"
  },
  {
    "name": "local-2",
    "fiberSecretKeyHex": "0x...",
    "ckbSecretKeyHex": "0x...",
    "externalPeerPubkey": "03...",
    "fundingAmount": "100000000000",
    "databasePrefix": "testnet-demo-local-2"
  }
]
```

## Debugging

- Active Fiber instances are exposed at `window.fibers`.
  The default testnet node is `window.fibers.primary`; local scenario nodes are
  `window.fibers["local-1"]`, `window.fibers["local-2"]`, and so on.
- The UI shows a live RPC log for every `invokeCommand` call, including method,
  node name, args, result, error, and duration. To avoid browser memory growth,
  only the latest 200 RPC log entries are kept, and large args/results are
  compacted before being stored.
- The raw JSON export includes flow logs, capped RPC logs, dropped RPC log
  count, metrics, and step results. It is a bounded debug snapshot: large
  payloads are depth-limited, arrays are sampled, and long strings are
  truncated.

## Common Failures

- `SharedArrayBuffer is unavailable`
  Open the app through `npm run dev` or `npm run preview` so COOP/COEP headers are
  present.
- `Peer not connected`
  Check that `connect_peer` can discover and connect to the configured external
  peer pubkey from the peer store/network.
- `Insufficient balance`
  The CKB secret key needs testnet funds for the funding transaction. In
  `Local multi-node`, this applies to every node's `ckbSecretKeyHex`.
- `ChannelReady timeout`
  The funding transaction may be slow, rejected, or waiting on the remote peer.
- `Payment failed`
  The route may be unavailable, the channel may not have enough outbound
  capacity, or the payment target may be wrong.
- `shutdown_channel failed`
  The browser demo sends `channel_id` and a default fee rate. If your node
  requires an explicit close script, inspect the RPC log and retry from
  `window.fibers`.

## Project Layout

- `src/fiberClient.ts`
  Thin wrapper around `@nervosnetwork/fiber-js`.
- `src/flowRunner.ts`
  Executes the end-to-end flow, polling and timing each step.
- `src/types.ts`
  Shared flow state, metric, and config types.
- `src/main.ts`
  DOM UI, form handling, logs, metrics, and raw JSON export.
- `src/constants.ts`
  Default testnet config and flow step labels.
- `src/education.ts`
  Scenario learning goals and per-step teaching notes, including the RPC calls
  or `fiber-js` APIs that implement each step.
- `src/reporting.ts`
  Builds browser and CI report summaries and stores browser-side history.
- `scripts/run-scenario-ci.mjs`
  Starts Vite, drives the browser scenario with Playwright, and writes CI report
  JSON files.

## Development Notes

Keep the demo useful as both a runnable tool and a teaching artifact. A flow
change is not complete until the UI, runner, metrics, RPC log, and teaching
copy all tell the same story.

### Add a New Scenario

1. Add the scenario id to `FlowScenario` in `src/types.ts`.
2. Add a scenario-specific step definition array in `src/constants.ts`, then
   update `FLOW_STEP_DEFINITIONS` and `getFlowStepDefinitions`.
3. Add `SCENARIO_LESSONS[scenario]` and a `STEP_LESSONS` entry for every new
   step id in `src/education.ts`. Every step must explain the concept, the
   RPC call or `fiber-js` API, why it matters, and what users should watch.
4. Implement the scenario branch in `FlowRunner.run` and add a dedicated runner
   method in `src/flowRunner.ts`. Use `runStep(stepId, task)` for every user
   visible step so duration, result, error, and teaching state stay in sync.
5. Add or update metrics in `FlowMetrics` and render them in `metricCards` in
   `src/main.ts`.
6. Add scenario-specific form fields and defaults in `src/main.ts` if needed.
   Use `data-scenario-field="<scenario-id>"` so hidden fields do not mislead
   users. If the scenario needs separate persisted draft values, extend
   `ScenarioDraft`.
7. Update README `What It Does`, `Inputs`, and `Common Failures` for the new
   operator behavior.
8. Run `npm run build` before committing.

### Add a New Step to an Existing Scenario

1. Add the step id and label to the relevant step definition array in
   `src/constants.ts`.
2. Add the required `STEP_LESSONS[stepId]` entry in `src/education.ts`.
3. Add the implementation in `src/flowRunner.ts` with `runStep`. If the step
   verifies an async condition, prefer polling the same RPC that users can see
   in the live RPC log.
4. If the step produces a meaningful duration or count, add a metric and show it
   in `metricCards`.
5. Make sure the RPC log shows the core method users should learn from. For
   non-RPC lifecycle work, state the `fiber-js` API explicitly in the lesson.
6. Run `npm run build`.

### IndexedDB and Restart Rules

- Restart scenarios must reuse the same Fiber secret key, CKB secret key, and
  `databasePrefix`; otherwise they are testing a fresh node, not recovery.
- Use unique prefixes for parallel local nodes. Reusing a prefix across local
  nodes can mix channel state and make recovery results misleading.
- The delete buttons intentionally delete databases by prefix. Keep this visible
  and explicit whenever adding new persistence-related UI.

### Teaching Copy Rules

- Do not add a visible step without a matching `STEP_LESSONS` entry.
- The `RPC call` text should name the exact RPC method and the important params
  or polling condition.
- The `What to watch` text should tell users which log, metric, state name, or
  returned field proves the step succeeded.
