import { createIcons, icons } from "lucide";
import {
  DEFAULT_FORM_VALUES,
  DEFAULT_LOCAL_MULTI_NODE_CONFIG,
  DEFAULT_TESTNET_CONFIG,
  MAX_RPC_LOGS,
  getFlowStepDefinitions
} from "./constants";
import { randomSecretKeyHex } from "./fiberClient";
import { FlowRunner, createRawExportSnapshot } from "./flowRunner";
import type { FlowConfig, FlowRunState, FlowScenario, FlowStep, LocalNodeConfig } from "./types";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

let latestState: FlowRunState | undefined;
let runner: FlowRunner | undefined;
let activeScenario: FlowScenario = "testnet-single";

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Fiber WASM Testnet</p>
        <h1>用户体验流程演示</h1>
      </div>
      <div class="runtime-strip">
        <span class="runtime-pill" id="isolation-status"></span>
        <span class="runtime-pill" id="run-status">Idle</span>
      </div>
    </header>

    <section class="workspace">
      <aside class="config-panel">
        <div class="panel-head">
          <h2>配置</h2>
          <button class="icon-button" id="generate-keys" type="button" title="Generate keys">
            <i data-lucide="key-round"></i>
          </button>
        </div>

        <label data-scenario-field="testnet-single">
          Fiber secret key
          <input id="fiber-secret-key" autocomplete="off" spellcheck="false" />
        </label>

        <label data-scenario-field="testnet-single">
          CKB secret key
          <input id="ckb-secret-key" autocomplete="off" spellcheck="false" />
        </label>

        <label data-scenario-field="testnet-single">
          Database prefix
          <input id="database-prefix" autocomplete="off" />
        </label>

        <label data-scenario-field="testnet-single">
          Peer pubkey
          <input id="peer-pubkey" autocomplete="off" placeholder="02..." />
        </label>

        <label data-scenario-field="testnet-single">
          Funding amount (shannon)
          <input id="funding-amount" inputmode="numeric" />
        </label>

        <label data-scenario-field="testnet-single">
          Payment target pubkey
          <input id="payment-target-pubkey" autocomplete="off" placeholder="Defaults to peer pubkey" />
        </label>

        <label>
          Payment amount (shannon)
          <input id="payment-amount" inputmode="numeric" />
        </label>

        <label>
          Scenario
          <select id="scenario">
            <option value="testnet-single">Testnet single node</option>
            <option value="local-multi-node">Local multi-node</option>
          </select>
        </label>

        <label data-scenario-field="local-multi-node">
          Local node count
          <input id="local-node-count" inputmode="numeric" />
        </label>

        <label data-scenario-field="local-multi-node">
          Local nodes JSON
          <textarea id="local-nodes-json" spellcheck="false"></textarea>
        </label>

        <label>
          Fiber config
          <textarea id="fiber-config" spellcheck="false"></textarea>
        </label>

        <div class="button-row">
          <button class="primary-button" id="run-flow" type="button">
            <i data-lucide="play"></i>
            Run flow
          </button>
          <button class="secondary-button" id="stop-flow" type="button">
            <i data-lucide="square"></i>
            Stop
          </button>
        </div>
      </aside>

      <section class="flow-panel">
        <div class="summary-band">
          <div>
            <span class="metric-label">Node pubkey</span>
            <strong id="node-pubkey">--</strong>
          </div>
          <div>
            <span class="metric-label">Last error</span>
            <strong id="last-error">--</strong>
          </div>
        </div>

        <div class="main-grid">
          <nav class="stepper" id="stepper"></nav>

          <section class="log-panel">
            <div class="panel-head">
              <h2>运行日志</h2>
              <button class="icon-button" id="reset-view" type="button" title="Reset view">
                <i data-lucide="rotate-ccw"></i>
              </button>
            </div>
            <div class="logs" id="logs"></div>
          </section>

          <section class="log-panel rpc-log-panel">
            <div class="panel-head">
              <h2>RPC 日志</h2>
              <span class="log-cap" id="rpc-log-cap"></span>
            </div>
            <div class="logs" id="rpc-logs"></div>
          </section>

          <aside class="metrics-panel" id="metrics"></aside>
        </div>

        <section class="raw-panel">
          <div class="panel-head">
            <h2>Raw JSON</h2>
            <button class="icon-button" id="copy-json" type="button" title="Copy JSON">
              <i data-lucide="copy"></i>
            </button>
          </div>
          <pre id="raw-json">{}</pre>
        </section>
      </section>
    </section>
  </main>
`;

const elements = {
  isolationStatus: byId("isolation-status"),
  runStatus: byId("run-status"),
  generateKeys: byId<HTMLButtonElement>("generate-keys"),
  fiberSecretKey: byId<HTMLInputElement>("fiber-secret-key"),
  ckbSecretKey: byId<HTMLInputElement>("ckb-secret-key"),
  databasePrefix: byId<HTMLInputElement>("database-prefix"),
  peerPubkey: byId<HTMLInputElement>("peer-pubkey"),
  fundingAmount: byId<HTMLInputElement>("funding-amount"),
  paymentTargetPubkey: byId<HTMLInputElement>("payment-target-pubkey"),
  paymentAmount: byId<HTMLInputElement>("payment-amount"),
  scenario: byId<HTMLSelectElement>("scenario"),
  localNodeCount: byId<HTMLInputElement>("local-node-count"),
  localNodesJson: byId<HTMLTextAreaElement>("local-nodes-json"),
  fiberConfig: byId<HTMLTextAreaElement>("fiber-config"),
  runFlow: byId<HTMLButtonElement>("run-flow"),
  stopFlow: byId<HTMLButtonElement>("stop-flow"),
  resetView: byId<HTMLButtonElement>("reset-view"),
  copyJson: byId<HTMLButtonElement>("copy-json"),
  nodePubkey: byId("node-pubkey"),
  lastError: byId("last-error"),
  stepper: byId("stepper"),
  logs: byId("logs"),
  rpcLogCap: byId("rpc-log-cap"),
  rpcLogs: byId("rpc-logs"),
  metrics: byId("metrics"),
  rawJson: byId("raw-json")
};
const scenarioFields = document.querySelectorAll<HTMLElement>("[data-scenario-field]");
type ScenarioDraft = {
  fiberSecretKey: string;
  ckbSecretKey: string;
  databasePrefix: string;
  peerPubkey: string;
  fundingAmount: string;
  paymentTargetPubkey: string;
  paymentAmount: string;
  localNodeCount: string;
  localNodesJson: string;
  fiberConfig: string;
};

const scenarioDrafts: Record<FlowScenario, ScenarioDraft> = {
  "testnet-single": createScenarioDraft("testnet-single"),
  "local-multi-node": createScenarioDraft("local-multi-node")
};

hydrateDefaults();
renderRuntime();
updateScenarioFields();
renderEmptyState();
createIcons({ icons });

elements.generateKeys.addEventListener("click", () => {
  if (activeScenario === "local-multi-node") {
    elements.localNodesJson.value = JSON.stringify(
      createDefaultLocalNodes(
        Number.parseInt(elements.localNodeCount.value, 10) || DEFAULT_FORM_VALUES.localNodeCount,
        elements.databasePrefix.value || scenarioDrafts["local-multi-node"].databasePrefix
      ),
      null,
      2
    );
  } else {
    elements.fiberSecretKey.value = randomSecretKeyHex();
    elements.ckbSecretKey.value = randomSecretKeyHex();
  }
});

elements.runFlow.addEventListener("click", async () => {
  elements.runFlow.disabled = true;
  runner = new FlowRunner({
    onUpdate: (state) => {
      latestState = state;
      renderState(state);
    }
  });

  try {
    await runner.run(readConfig());
  } catch (error) {
    renderSetupError(error);
  } finally {
    elements.runFlow.disabled = false;
  }
});

elements.stopFlow.addEventListener("click", async () => {
  await runner?.stop();
});

elements.scenario.addEventListener("change", () => {
  saveScenarioDraft(activeScenario);
  activeScenario = elements.scenario.value as FlowScenario;
  loadScenarioDraft(activeScenario);
  latestState = undefined;
  updateScenarioFields();
  renderEmptyState();
});

elements.resetView.addEventListener("click", () => {
  latestState = undefined;
  renderEmptyState();
});

elements.copyJson.addEventListener("click", async () => {
  const text = JSON.stringify(latestState ? createRawExportSnapshot(latestState) : {}, null, 2);
  await navigator.clipboard.writeText(text);
});

function hydrateDefaults(): void {
  loadScenarioDraft(activeScenario);
}

function readConfig(): FlowConfig {
  const peerPubkey = elements.peerPubkey.value.trim();
  const paymentTargetPubkey = elements.paymentTargetPubkey.value.trim() || peerPubkey;
  const scenario = elements.scenario.value as FlowConfig["scenario"];
  const localNodeCount = Number.parseInt(elements.localNodeCount.value, 10) || DEFAULT_FORM_VALUES.localNodeCount;
  const localNodes = scenario === "local-multi-node" ? readLocalNodes(localNodeCount) : [];

  if (scenario === "testnet-single" && !peerPubkey) {
    throw new Error("Peer pubkey is required.");
  }
  if (scenario === "testnet-single" && !paymentTargetPubkey) {
    throw new Error("Payment target pubkey is required.");
  }

  return {
    configYaml: elements.fiberConfig.value,
    fiberSecretKeyHex: elements.fiberSecretKey.value,
    ckbSecretKeyHex: elements.ckbSecretKey.value,
    databasePrefix:
      elements.databasePrefix.value.trim() ||
      scenarioDrafts[scenario].databasePrefix ||
      DEFAULT_FORM_VALUES.testnetDatabasePrefix,
    peerPubkey,
    fundingAmount: elements.fundingAmount.value.trim(),
    paymentTargetPubkey,
    paymentAmount: elements.paymentAmount.value.trim(),
    logLevel: "info",
    scenario,
    localNodeCount,
    localNodes,
    pollIntervalMs: DEFAULT_FORM_VALUES.pollIntervalMs,
    connectPeerTimeoutMs: DEFAULT_FORM_VALUES.connectPeerTimeoutMs,
    channelReadyTimeoutMs: DEFAULT_FORM_VALUES.channelReadyTimeoutMs,
    graphSyncTimeoutMs: DEFAULT_FORM_VALUES.graphSyncTimeoutMs,
    paymentTimeoutMs: DEFAULT_FORM_VALUES.paymentTimeoutMs,
    restartRecoveryTimeoutMs: DEFAULT_FORM_VALUES.restartRecoveryTimeoutMs
  };
}

function createScenarioDraft(scenario: FlowScenario): ScenarioDraft {
  const databasePrefix =
    scenario === "local-multi-node"
      ? DEFAULT_FORM_VALUES.localDatabasePrefix
      : DEFAULT_FORM_VALUES.testnetDatabasePrefix;

  return {
    fiberSecretKey: randomSecretKeyHex(),
    ckbSecretKey: randomSecretKeyHex(),
    databasePrefix,
    peerPubkey: "",
    fundingAmount: DEFAULT_FORM_VALUES.fundingAmount,
    paymentTargetPubkey: "",
    paymentAmount: DEFAULT_FORM_VALUES.paymentAmount,
    localNodeCount: String(DEFAULT_FORM_VALUES.localNodeCount),
    localNodesJson: JSON.stringify(
      createDefaultLocalNodes(DEFAULT_FORM_VALUES.localNodeCount, databasePrefix),
      null,
      2
    ),
    fiberConfig:
      scenario === "local-multi-node" ? DEFAULT_LOCAL_MULTI_NODE_CONFIG : DEFAULT_TESTNET_CONFIG
  };
}

function saveScenarioDraft(scenario: FlowScenario): void {
  scenarioDrafts[scenario] = {
    fiberSecretKey: elements.fiberSecretKey.value,
    ckbSecretKey: elements.ckbSecretKey.value,
    databasePrefix: elements.databasePrefix.value,
    peerPubkey: elements.peerPubkey.value,
    fundingAmount: elements.fundingAmount.value,
    paymentTargetPubkey: elements.paymentTargetPubkey.value,
    paymentAmount: elements.paymentAmount.value,
    localNodeCount: elements.localNodeCount.value,
    localNodesJson: elements.localNodesJson.value,
    fiberConfig: elements.fiberConfig.value
  };
}

function loadScenarioDraft(scenario: FlowScenario): void {
  const draft = scenarioDrafts[scenario];

  elements.scenario.value = scenario;
  elements.fiberSecretKey.value = draft.fiberSecretKey;
  elements.ckbSecretKey.value = draft.ckbSecretKey;
  elements.databasePrefix.value = draft.databasePrefix;
  elements.peerPubkey.value = draft.peerPubkey;
  elements.fundingAmount.value = draft.fundingAmount;
  elements.paymentTargetPubkey.value = draft.paymentTargetPubkey;
  elements.paymentAmount.value = draft.paymentAmount;
  elements.localNodeCount.value = draft.localNodeCount;
  elements.localNodesJson.value = draft.localNodesJson;
  elements.fiberConfig.value = draft.fiberConfig;
}

function createDefaultLocalNodes(count: number, databasePrefix: string): LocalNodeConfig[] {
  return Array.from({ length: Math.max(2, count) }, (_, index) => ({
    name: `local-${index + 1}`,
    fiberSecretKeyHex: randomSecretKeyHex(),
    ckbSecretKeyHex: "REPLACE_WITH_FUNDED_TESTNET_PRIVATE_KEY",
    externalPeerPubkey: "REPLACE_WITH_EXTERNAL_FIBER_PUBKEY",
    fundingAmount: DEFAULT_FORM_VALUES.fundingAmount,
    databasePrefix: `${databasePrefix}-local-${index + 1}`
  }));
}

function readLocalNodes(expectedCount: number): LocalNodeConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements.localNodesJson.value);
  } catch (error) {
    throw new Error(`Local nodes JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Local nodes JSON must be an array.");
  }

  if (parsed.length !== Math.max(2, expectedCount)) {
    throw new Error(`Local nodes JSON must define exactly ${Math.max(2, expectedCount)} nodes.`);
  }

  const nodes = parsed.map((value, index) => normalizeLocalNode(value, index));
  assertUnique(nodes.map((node) => node.fiberSecretKeyHex), "Fiber secret key");
  assertUnique(nodes.map((node) => node.ckbSecretKeyHex), "CKB secret key");
  assertUnique(nodes.map((node) => node.externalPeerPubkey), "external peer pubkey");
  return nodes;
}

function normalizeLocalNode(value: unknown, index: number): LocalNodeConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`Local node ${index + 1} must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const node = {
    name: stringField(record.name) || `local-${index + 1}`,
    fiberSecretKeyHex: stringField(record.fiberSecretKeyHex),
    ckbSecretKeyHex: stringField(record.ckbSecretKeyHex),
    externalPeerPubkey: stringField(record.externalPeerPubkey),
    fundingAmount: stringField(record.fundingAmount),
    databasePrefix: stringField(record.databasePrefix)
  };

  if (!isHexSecret(node.fiberSecretKeyHex)) {
    throw new Error(`Local node ${node.name} needs a 64-character hex fiberSecretKeyHex.`);
  }

  if (!isHexSecret(node.ckbSecretKeyHex)) {
    throw new Error(
      `Local node ${node.name} needs a 64-character hex ckbSecretKeyHex with testnet CKB balance.`
    );
  }

  if (!node.externalPeerPubkey) {
    throw new Error(`Local node ${node.name} needs externalPeerPubkey.`);
  }

  return node;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHexSecret(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(value);
}

function assertUnique(values: string[], label: string): void {
  const normalized = values.map((value) => value.replace(/^0x/i, "").toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Local multi-node requires a different ${label} for every node.`);
  }
}

function renderRuntime(): void {
  const isolated = window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  elements.isolationStatus.className = `runtime-pill ${isolated ? "ok" : "bad"}`;
  elements.isolationStatus.textContent = isolated ? "SharedArrayBuffer ready" : "Header check failed";
}

function updateScenarioFields(): void {
  const scenario = elements.scenario.value;
  scenarioFields.forEach((field) => {
    field.hidden = field.dataset.scenarioField !== scenario;
  });
}

function renderEmptyState(): void {
  const scenario = elements.scenario.value as FlowConfig["scenario"];
  const steps = getFlowStepDefinitions(scenario).map(([, label]) => label);

  elements.runStatus.textContent = "Idle";
  elements.nodePubkey.textContent = "--";
  elements.lastError.textContent = "--";
  elements.stepper.innerHTML = steps
    .map((label) => `<div class="step idle"><span></span><p>${escapeHtml(label)}</p></div>`)
    .join("");
  elements.logs.innerHTML = `<div class="empty-log">No run yet.</div>`;
  elements.rpcLogs.innerHTML = `<div class="empty-log">No RPC calls yet.</div>`;
  elements.rpcLogCap.textContent = `Last ${MAX_RPC_LOGS}`;
  elements.metrics.innerHTML = metricCards(undefined, scenario);
  elements.rawJson.textContent = "{}";
  createIcons({ icons });
}

function renderSetupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  elements.runStatus.textContent = "Config error";
  elements.runStatus.className = "runtime-pill bad";
  elements.lastError.textContent = message;
  elements.logs.innerHTML = `
    <article class="log-entry error">
      <header>
        <span>${new Date().toLocaleTimeString()}</span>
        <strong>${escapeHtml(message)}</strong>
      </header>
    </article>
  `;
  elements.rpcLogs.innerHTML = `<div class="empty-log">No RPC calls yet.</div>`;
  elements.rpcLogCap.textContent = `Last ${MAX_RPC_LOGS}`;
}

function renderState(state: FlowRunState): void {
  elements.runStatus.textContent = state.running ? "Running" : state.lastError ? "Failed" : "Finished";
  elements.runStatus.className = `runtime-pill ${state.running ? "" : state.lastError ? "bad" : "ok"}`;
  elements.nodePubkey.textContent = state.nodePubkey || "--";
  elements.lastError.textContent = state.lastError || "--";
  elements.stepper.innerHTML = state.steps.map(renderStep).join("");
  elements.logs.innerHTML = state.logs.map(renderLog).join("");
  elements.logs.scrollTop = elements.logs.scrollHeight;
  elements.rpcLogs.innerHTML = state.rpcLogs.length
    ? state.rpcLogs.map(renderRpcLog).join("")
    : `<div class="empty-log">No RPC calls yet.</div>`;
  elements.rpcLogCap.textContent =
    state.rpcLogDroppedCount > 0
      ? `Last ${state.rpcLogs.length}, dropped ${state.rpcLogDroppedCount}`
      : `Last ${MAX_RPC_LOGS}`;
  elements.rpcLogs.scrollTop = elements.rpcLogs.scrollHeight;
  elements.metrics.innerHTML = metricCards(state, state.scenario);
  elements.rawJson.textContent = JSON.stringify(createRawExportSnapshot(state), null, 2);
  createIcons({ icons });
}

function renderRpcLog(log: FlowRunState["rpcLogs"][number]): string {
  return `
    <article class="log-entry ${log.status === "failed" ? "error" : log.status === "success" ? "success" : ""}">
      <header>
        <span>${new Date(log.at).toLocaleTimeString()}</span>
        <strong>${escapeHtml(log.node)}.${escapeHtml(log.method)} ${log.durationMs === undefined ? "" : `(${formatMs(log.durationMs)})`}</strong>
      </header>
      <pre>${escapeHtml(JSON.stringify(log.error ? { args: log.args, error: log.error } : { args: log.args, result: log.result }, null, 2))}</pre>
    </article>
  `;
}

function renderStep(step: FlowStep): string {
  return `
    <div class="step ${step.status}">
      <span></span>
      <p>${escapeHtml(step.label)}</p>
      <time>${formatMs(step.durationMs)}</time>
    </div>
  `;
}

function renderLog(log: FlowRunState["logs"][number]): string {
  return `
    <article class="log-entry ${log.level}">
      <header>
        <span>${new Date(log.at).toLocaleTimeString()}</span>
        <strong>${escapeHtml(log.message)}</strong>
      </header>
      ${log.payload === undefined ? "" : `<pre>${escapeHtml(JSON.stringify(log.payload, null, 2))}</pre>`}
    </article>
  `;
}

function metricCards(state?: FlowRunState, scenario: FlowConfig["scenario"] = "testnet-single"): string {
  const metrics = state?.metrics ?? {};
  const items =
    scenario === "local-multi-node"
      ? [
          ["Local nodes", valueOrDash(metrics.localNodeCount)],
          ["Connect peers", formatMs(metrics.localConnectPeersMs)],
          ["Channel ready", formatMs(metrics.localChannelReadyMs)],
          ["Graph sync", formatMs(metrics.localGraphSyncMs)],
          ["Pair payments", valueOrDash(metrics.localPaymentCount)],
          ["Payment batch", formatMs(metrics.sendPaymentMs)],
          ["Shutdown", formatMs(metrics.shutdownMs)]
        ]
      : [
          ["Graph channels", valueOrDash(metrics.graphChannelCount)],
          ["Connect peer", formatMs(metrics.connectPeerMs)],
          ["Channel ready", formatMs(metrics.channelReadyMs)],
          ["Graph sync", formatMs(metrics.graphSyncMs)],
          ["Payment", formatMs(metrics.sendPaymentMs)],
          ["Restart recovery", formatMs(metrics.restartRecoveryMs)],
          ["Restart payment", formatMs(metrics.restartPaymentMs)],
          ["Shutdown", formatMs(metrics.shutdownMs)]
        ];

  return items
    .map(
      ([label, value]) => `
        <div class="metric-tile">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `
    )
    .join("");
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}

function formatMs(value?: number): string {
  if (value === undefined) {
    return "--";
  }
  return `${(value / 1000).toFixed(2)}s`;
}

function valueOrDash(value?: number): string {
  return value === undefined ? "--" : `${value}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
