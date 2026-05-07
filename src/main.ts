import { ccc } from "@ckb-ccc/core";
import { createIcons, icons } from "lucide";
import {
  DEFAULT_FORM_VALUES,
  DEFAULT_LOCAL_MULTI_NODE_CONFIG,
  DEFAULT_TESTNET_CONFIG,
  MAX_RPC_LOGS,
  getFlowStepDefinitions
} from "./constants";
import { SCENARIO_LESSONS, STEP_LESSONS, type StepLesson } from "./education";
import { randomSecretKeyHex } from "./fiberClient";
import { FlowRunner, createRawExportSnapshot } from "./flowRunner";
import {
  createFlowReport,
  createReportIndexEntry,
  readLocalReportHistory,
  saveLocalFlowReport,
  type FlowReport,
  type ReportIndex,
  type ReportIndexEntry
} from "./reporting";
import type { FlowConfig, FlowRunState, FlowScenario, FlowStep, LocalNodeConfig, StepId } from "./types";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root.");
}

let latestState: FlowRunState | undefined;
let runner: FlowRunner | undefined;
let activeScenario: FlowScenario = "testnet-single";
let ckbAddressRenderToken = 0;
let localAddressRenderToken = 0;
let latestReport: FlowReport | undefined;
const CONFIG_COLLAPSED_STORAGE_KEY = "fiber-wasm-config-collapsed";
const MAIN_GRID_LAYOUT_STORAGE_KEY = "fiber-wasm-main-grid-layout";
const savedReportRunIds = new Set<string>();

const ckbClient = new ccc.ClientPublicTestnet();
const urlParams = new URLSearchParams(window.location.search);
const isHistoryView = urlParams.get("view") === "history";

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Fiber WASM Testnet</p>
        <h1>用户体验流程演示</h1>
      </div>
      <div class="topbar-actions">
        <nav class="view-nav" aria-label="Views">
          <a href="./" class="${isHistoryView ? "" : "active"}">Run</a>
          <a href="?view=history" class="${isHistoryView ? "active" : ""}">History</a>
        </nav>
        <div class="runtime-strip">
          <span class="runtime-pill" id="isolation-status"></span>
          <span class="runtime-pill" id="run-status">Idle</span>
        </div>
      </div>
    </header>

    <section class="workspace" id="workspace">
      <aside class="config-panel" aria-label="Configuration">
        <div class="panel-head">
          <h2>配置</h2>
          <div class="panel-actions">
            <button class="icon-button" id="toggle-config" type="button" title="Collapse config" aria-expanded="true">
              <i data-lucide="panel-left-close"></i>
            </button>
            <button class="icon-button" id="generate-keys" type="button" title="Generate keys">
              <i data-lucide="key-round"></i>
            </button>
          </div>
        </div>

        <div class="config-body">
          <label>
            Scenario
            <select id="scenario">
              <option value="testnet-single">Testnet single node</option>
              <option value="local-multi-node">Local multi-node</option>
            </select>
          </label>

          <label data-scenario-field="testnet-single">
            Fiber secret key
            <input id="fiber-secret-key" autocomplete="off" spellcheck="false" />
          </label>

          <label data-scenario-field="testnet-single">
            CKB secret key
            <input id="ckb-secret-key" autocomplete="off" spellcheck="false" />
          </label>

          <div class="assist-panel" data-scenario-field="testnet-single">
            <span>CKB address</span>
            <code id="ckb-address">--</code>
          </div>

          <div class="field-group" data-scenario-field="testnet-single">
            <label>
              Database prefix
              <input id="database-prefix" autocomplete="off" />
            </label>
            <button class="danger-button" id="delete-indexeddb" type="button">
              <i data-lucide="trash-2"></i>
              Delete IndexedDB
            </button>
          </div>

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

          <label data-scenario-field="testnet-single">
            Payment amount (shannon)
            <input id="payment-amount" inputmode="numeric" />
          </label>

          <label data-scenario-field="local-multi-node">
            Local node count
            <input id="local-node-count" inputmode="numeric" />
          </label>

          <div class="field-group" data-scenario-field="local-multi-node">
            <label>
              Local nodes JSON
              <textarea id="local-nodes-json" spellcheck="false"></textarea>
            </label>
            <div class="assist-panel">
              <span>Local CKB addresses</span>
              <code id="local-ckb-addresses">--</code>
            </div>
            <button class="danger-button" id="delete-local-indexeddb" type="button">
              <i data-lucide="trash-2"></i>
              Delete local IndexedDB
            </button>
          </div>

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

        <div class="main-grid" id="main-grid">
          <aside class="learning-panel" id="learning-panel">
            <section class="lesson-card resizable-panel" id="scenario-lesson"></section>
            <section class="lesson-card active-lesson" id="active-lesson"></section>
            <nav class="stepper" id="stepper"></nav>
          </aside>

          <div
            class="grid-resizer"
            data-grid-resizer="learning-run"
            role="separator"
            aria-label="Resize learning and run logs"
            title="拖动调整 Learning goal 和运行日志宽度"
          ></div>

          <section class="log-panel run-log-panel resizable-panel" id="run-log-panel">
            <div class="panel-head">
              <h2>运行日志</h2>
              <button class="icon-button" id="reset-view" type="button" title="Reset view">
                <i data-lucide="rotate-ccw"></i>
              </button>
            </div>
            <div class="logs" id="logs"></div>
          </section>

          <div
            class="grid-resizer"
            data-grid-resizer="run-rpc"
            role="separator"
            aria-label="Resize run and RPC logs"
            title="拖动调整运行日志和 RPC 日志宽度"
          ></div>

          <section class="log-panel rpc-log-panel resizable-panel" id="rpc-log-panel">
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
            <div class="panel-actions">
              <span class="report-status" id="report-status">Report pending</span>
              <button class="icon-button" id="download-report" type="button" title="Download report JSON" disabled>
                <i data-lucide="file-json"></i>
              </button>
              <button class="icon-button" id="copy-json" type="button" title="Copy JSON">
                <i data-lucide="copy"></i>
              </button>
            </div>
          </div>
          <pre id="raw-json">{}</pre>
          <script type="application/json" id="latest-report-json">{}</script>
        </section>
      </section>
    </section>

    <section class="history-view" id="history-view" hidden>
      <section class="history-panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Reports</p>
            <h2>历史 JSON 数据</h2>
          </div>
          <button class="secondary-button compact-button" id="refresh-history" type="button">
            <i data-lucide="refresh-cw"></i>
            Refresh
          </button>
        </div>
        <div class="history-grid">
          <div class="history-list" id="history-list"></div>
          <div class="history-json-panel">
            <div class="panel-head">
              <h2>Report JSON</h2>
              <button class="icon-button" id="copy-history-json" type="button" title="Copy selected report JSON">
                <i data-lucide="copy"></i>
              </button>
            </div>
            <pre id="history-json">{}</pre>
          </div>
        </div>
      </section>
    </section>
  </main>
`;

const elements = {
  workspace: byId("workspace"),
  historyView: byId("history-view"),
  mainGrid: byId("main-grid"),
  learningPanel: byId("learning-panel"),
  runLogPanel: byId("run-log-panel"),
  rpcLogPanel: byId("rpc-log-panel"),
  isolationStatus: byId("isolation-status"),
  runStatus: byId("run-status"),
  toggleConfig: byId<HTMLButtonElement>("toggle-config"),
  generateKeys: byId<HTMLButtonElement>("generate-keys"),
  fiberSecretKey: byId<HTMLInputElement>("fiber-secret-key"),
  ckbSecretKey: byId<HTMLInputElement>("ckb-secret-key"),
  ckbAddress: byId("ckb-address"),
  databasePrefix: byId<HTMLInputElement>("database-prefix"),
  deleteIndexedDb: byId<HTMLButtonElement>("delete-indexeddb"),
  peerPubkey: byId<HTMLInputElement>("peer-pubkey"),
  fundingAmount: byId<HTMLInputElement>("funding-amount"),
  paymentTargetPubkey: byId<HTMLInputElement>("payment-target-pubkey"),
  paymentAmount: byId<HTMLInputElement>("payment-amount"),
  scenario: byId<HTMLSelectElement>("scenario"),
  localNodeCount: byId<HTMLInputElement>("local-node-count"),
  localNodesJson: byId<HTMLTextAreaElement>("local-nodes-json"),
  localCkbAddresses: byId("local-ckb-addresses"),
  deleteLocalIndexedDb: byId<HTMLButtonElement>("delete-local-indexeddb"),
  fiberConfig: byId<HTMLTextAreaElement>("fiber-config"),
  runFlow: byId<HTMLButtonElement>("run-flow"),
  stopFlow: byId<HTMLButtonElement>("stop-flow"),
  resetView: byId<HTMLButtonElement>("reset-view"),
  copyJson: byId<HTMLButtonElement>("copy-json"),
  downloadReport: byId<HTMLButtonElement>("download-report"),
  reportStatus: byId("report-status"),
  nodePubkey: byId("node-pubkey"),
  lastError: byId("last-error"),
  scenarioLesson: byId("scenario-lesson"),
  activeLesson: byId("active-lesson"),
  stepper: byId("stepper"),
  logs: byId("logs"),
  rpcLogCap: byId("rpc-log-cap"),
  rpcLogs: byId("rpc-logs"),
  metrics: byId("metrics"),
  rawJson: byId("raw-json"),
  latestReportJson: byId<HTMLScriptElement>("latest-report-json"),
  refreshHistory: byId<HTMLButtonElement>("refresh-history"),
  historyList: byId("history-list"),
  historyJson: byId("history-json"),
  copyHistoryJson: byId<HTMLButtonElement>("copy-history-json")
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
type HistoryDisplayItem = {
  key: string;
  entry: ReportIndexEntry;
  report?: FlowReport;
};

hydrateDefaults();
renderRuntime();
updateScenarioFields();
refreshCkbAddressPreviews();
renderEmptyState();
createIcons({ icons });
applyConfigCollapsed(localStorage.getItem(CONFIG_COLLAPSED_STORAGE_KEY) === "true");
restoreMainGridLayout();
setupMainGridResizers();

if (isHistoryView) {
  elements.workspace.hidden = true;
  elements.historyView.hidden = false;
  elements.runStatus.textContent = "History";
  void renderHistoryView();
}

elements.toggleConfig.addEventListener("click", () => {
  const shouldCollapse = !elements.workspace.classList.contains("config-collapsed");
  localStorage.setItem(CONFIG_COLLAPSED_STORAGE_KEY, String(shouldCollapse));
  applyConfigCollapsed(shouldCollapse);
});

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
  refreshCkbAddressPreviews();
});

elements.ckbSecretKey.addEventListener("input", () => {
  void renderSingleCkbAddress();
});

elements.localNodesJson.addEventListener("input", () => {
  void renderLocalCkbAddresses();
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
  refreshCkbAddressPreviews();
  renderEmptyState();
});

elements.deleteIndexedDb.addEventListener("click", async () => {
  await deleteIndexedDbPrefixes([elements.databasePrefix.value.trim()], elements.deleteIndexedDb);
});

elements.deleteLocalIndexedDb.addEventListener("click", async () => {
  const prefixes = readLocalDatabasePrefixes();
  await deleteIndexedDbPrefixes(prefixes, elements.deleteLocalIndexedDb);
});

elements.resetView.addEventListener("click", () => {
  latestState = undefined;
  renderEmptyState();
});

elements.copyJson.addEventListener("click", async () => {
  const text = JSON.stringify(latestState ? createRawExportSnapshot(latestState) : {}, null, 2);
  await navigator.clipboard.writeText(text);
});

elements.downloadReport.addEventListener("click", () => {
  if (!latestReport) {
    return;
  }
  downloadJson(`fiber-report-${latestReport.summary.runId}.json`, latestReport);
});

elements.refreshHistory.addEventListener("click", () => {
  void renderHistoryView();
});

elements.copyHistoryJson.addEventListener("click", async () => {
  await navigator.clipboard.writeText(elements.historyJson.textContent ?? "{}");
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
    peerPubkey: scenario === "testnet-single" ? DEFAULT_FORM_VALUES.testnetPeerPubkey : "",
    fundingAmount: DEFAULT_FORM_VALUES.fundingAmount,
    paymentTargetPubkey:
      scenario === "testnet-single" ? DEFAULT_FORM_VALUES.testnetPaymentTargetPubkey : "",
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

function refreshCkbAddressPreviews(): void {
  void renderSingleCkbAddress();
  void renderLocalCkbAddresses();
}

async function renderSingleCkbAddress(): Promise<void> {
  const token = ++ckbAddressRenderToken;
  const secretKey = elements.ckbSecretKey.value.trim();

  if (!secretKey) {
    elements.ckbAddress.textContent = "--";
    return;
  }

  if (!isHexSecret(secretKey)) {
    elements.ckbAddress.textContent = "Invalid CKB secret key";
    return;
  }

  elements.ckbAddress.textContent = "Deriving address...";
  try {
    const address = await deriveCkbAddress(secretKey);
    if (token === ckbAddressRenderToken) {
      elements.ckbAddress.textContent = address;
    }
  } catch (error) {
    if (token === ckbAddressRenderToken) {
      elements.ckbAddress.textContent =
        error instanceof Error ? error.message : "Unable to derive CKB address";
    }
  }
}

async function renderLocalCkbAddresses(): Promise<void> {
  const token = ++localAddressRenderToken;
  const rows = readLocalNodeRecords();

  if (rows.length === 0) {
    elements.localCkbAddresses.textContent = "--";
    return;
  }

  elements.localCkbAddresses.textContent = "Deriving addresses...";
  const renderedRows = await Promise.all(
    rows.map(async ({ name, ckbSecretKeyHex }, index) => {
      const label = name || `local-${index + 1}`;
      if (!isHexSecret(ckbSecretKeyHex)) {
        return `${label}: invalid CKB secret key`;
      }
      try {
        return `${label}: ${await deriveCkbAddress(ckbSecretKeyHex)}`;
      } catch (error) {
        return `${label}: ${error instanceof Error ? error.message : "unable to derive address"}`;
      }
    })
  );

  if (token === localAddressRenderToken) {
    elements.localCkbAddresses.textContent = renderedRows.join("\n");
  }
}

async function deriveCkbAddress(secretKey: string): Promise<string> {
  const signer = new ccc.SignerCkbPrivateKey(ckbClient, secretKey);
  return signer.getRecommendedAddress();
}

function readLocalNodeRecords(): Array<{
  name: string;
  ckbSecretKeyHex: string;
  databasePrefix: string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements.localNodesJson.value);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
    .map((record, index) => {
      const name = stringField(record.name) || `local-${index + 1}`;
      return {
        name,
        ckbSecretKeyHex: stringField(record.ckbSecretKeyHex),
        databasePrefix:
          stringField(record.databasePrefix) ||
          `${scenarioDrafts["local-multi-node"].databasePrefix}-${name}`
      };
    });
}

function readLocalDatabasePrefixes(): string[] {
  return readLocalNodeRecords()
    .map((node) => node.databasePrefix)
    .filter(Boolean);
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

async function deleteIndexedDbPrefixes(prefixes: string[], button: HTMLButtonElement): Promise<void> {
  const uniquePrefixes = Array.from(new Set(prefixes.map((prefix) => prefix.trim()).filter(Boolean)));
  if (uniquePrefixes.length === 0) {
    flashButtonLabel(button, "No prefix");
    return;
  }

  const previousHtml = button.innerHTML;
  button.disabled = true;
  button.textContent = "Deleting...";

  try {
    const databaseNames = await indexedDbNamesForPrefixes(uniquePrefixes);
    if (databaseNames.length === 0) {
      flashButtonLabel(button, "Nothing found", previousHtml);
      return;
    }

    await Promise.all(databaseNames.map(deleteIndexedDbByName));
    flashButtonLabel(button, `Deleted ${databaseNames.length}`, previousHtml);
  } catch (error) {
    flashButtonLabel(
      button,
      error instanceof Error ? error.message : "Delete failed",
      previousHtml
    );
  }
}

async function indexedDbNamesForPrefixes(prefixes: string[]): Promise<string[]> {
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };

  if (!factory.databases) {
    return prefixes;
  }

  const databases = await factory.databases();
  const names = databases
    .map((database) => database.name)
    .filter((name): name is string => !!name);

  const matchedNames = names.filter((name) =>
    prefixes.some(
      (prefix) =>
        name === prefix ||
        name.startsWith(`${prefix}-`) ||
        name.startsWith(`${prefix}/`) ||
        name.startsWith(`${prefix}:`)
    )
  );

  return matchedNames.length > 0 ? matchedNames : prefixes;
}

function deleteIndexedDbByName(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Failed to delete ${name}`));
    request.onblocked = () => reject(new Error(`Close tabs using ${name} first`));
  });
}

function flashButtonLabel(
  button: HTMLButtonElement,
  label: string,
  restoreHtml = button.innerHTML
): void {
  button.disabled = false;
  button.textContent = label;
  window.setTimeout(() => {
    button.innerHTML = restoreHtml;
    button.disabled = false;
    createIcons({ icons });
  }, 1800);
}

function renderRuntime(): void {
  const isolated = window.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined";
  elements.isolationStatus.className = `runtime-pill ${isolated ? "ok" : "bad"}`;
  elements.isolationStatus.textContent = isolated ? "SharedArrayBuffer ready" : "Header check failed";
}

function applyConfigCollapsed(isCollapsed: boolean): void {
  elements.workspace.classList.toggle("config-collapsed", isCollapsed);
  elements.toggleConfig.title = isCollapsed ? "Expand config" : "Collapse config";
  elements.toggleConfig.setAttribute("aria-label", isCollapsed ? "Expand config" : "Collapse config");
  elements.toggleConfig.setAttribute("aria-expanded", String(!isCollapsed));
  elements.toggleConfig.innerHTML = `<i data-lucide="${isCollapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
  createIcons({ icons });
}

function setupMainGridResizers(): void {
  elements.mainGrid
    .querySelectorAll<HTMLElement>("[data-grid-resizer]")
    .forEach((resizer) => {
      resizer.addEventListener("pointerdown", (event) => {
        if (window.matchMedia("(max-width: 1180px)").matches) {
          return;
        }

        const resizerKind = resizer.dataset.gridResizer;
        const isLearningRun = resizerKind === "learning-run";
        const leftPanel = isLearningRun ? elements.learningPanel : elements.runLogPanel;
        const rightPanel = isLearningRun ? elements.runLogPanel : elements.rpcLogPanel;
        const leftVariable = isLearningRun ? "--learning-panel-width" : "--run-log-width";
        const rightVariable = isLearningRun ? "--run-log-width" : "--rpc-log-width";
        const minLeftWidth = isLearningRun ? 240 : 260;
        const minRightWidth = 260;
        const startX = event.clientX;
        const startLeftWidth = leftPanel.getBoundingClientRect().width;
        const startRightWidth = rightPanel.getBoundingClientRect().width;
        const totalWidth = startLeftWidth + startRightWidth;

        event.preventDefault();
        resizer.setPointerCapture(event.pointerId);
        document.body.classList.add("is-resizing-grid");

        const handlePointerMove = (moveEvent: PointerEvent) => {
          const delta = moveEvent.clientX - startX;
          const nextLeftWidth = clamp(
            startLeftWidth + delta,
            minLeftWidth,
            totalWidth - minRightWidth
          );
          const nextRightWidth = totalWidth - nextLeftWidth;

          elements.mainGrid.style.setProperty(leftVariable, `${Math.round(nextLeftWidth)}px`);
          elements.mainGrid.style.setProperty(rightVariable, `${Math.round(nextRightWidth)}px`);
        };

        const handlePointerUp = () => {
          document.body.classList.remove("is-resizing-grid");
          saveMainGridLayout();
          window.removeEventListener("pointermove", handlePointerMove);
          window.removeEventListener("pointerup", handlePointerUp);
          window.removeEventListener("pointercancel", handlePointerUp);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp, { once: true });
        window.addEventListener("pointercancel", handlePointerUp, { once: true });
      });
    });
}

function restoreMainGridLayout(): void {
  const savedLayout = localStorage.getItem(MAIN_GRID_LAYOUT_STORAGE_KEY);
  if (!savedLayout) {
    return;
  }

  try {
    const layout = JSON.parse(savedLayout) as Record<string, string>;
    Object.entries(layout).forEach(([property, value]) => {
      if (property.startsWith("--") && /^\d+px$/.test(value)) {
        elements.mainGrid.style.setProperty(property, value);
      }
    });
  } catch {
    localStorage.removeItem(MAIN_GRID_LAYOUT_STORAGE_KEY);
  }
}

function saveMainGridLayout(): void {
  const layout = {
    "--learning-panel-width": elements.mainGrid.style.getPropertyValue("--learning-panel-width"),
    "--run-log-width": elements.mainGrid.style.getPropertyValue("--run-log-width"),
    "--rpc-log-width": elements.mainGrid.style.getPropertyValue("--rpc-log-width")
  };
  localStorage.setItem(MAIN_GRID_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function updateScenarioFields(): void {
  const scenario = elements.scenario.value;
  scenarioFields.forEach((field) => {
    field.hidden = field.dataset.scenarioField !== scenario;
  });
}

function renderEmptyState(): void {
  const scenario = elements.scenario.value as FlowConfig["scenario"];
  const stepDefinitions = getFlowStepDefinitions(scenario);

  latestReport = undefined;
  elements.downloadReport.disabled = true;
  elements.reportStatus.textContent = "Report pending";
  elements.latestReportJson.textContent = "{}";
  elements.runStatus.textContent = "Idle";
  elements.nodePubkey.textContent = "--";
  elements.lastError.textContent = "--";
  elements.scenarioLesson.innerHTML = renderScenarioLesson(scenario);
  elements.activeLesson.innerHTML = renderActiveLessonForDefinition(stepDefinitions[0]);
  elements.stepper.innerHTML = stepDefinitions
    .map(([id, label]) => renderStepDefinition(id, label))
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
  elements.scenarioLesson.innerHTML = renderScenarioLesson(state.scenario);
  elements.activeLesson.innerHTML = renderActiveLesson(state);
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
  renderReportState(state);
  createIcons({ icons });
}

function renderReportState(state: FlowRunState): void {
  if (state.running) {
    latestReport = undefined;
    elements.downloadReport.disabled = true;
    elements.reportStatus.textContent = "Report running";
    elements.latestReportJson.textContent = "{}";
    return;
  }

  if (!state.endedAt) {
    return;
  }

  latestReport = createFlowReport(state, "browser");
  elements.downloadReport.disabled = false;
  elements.reportStatus.textContent =
    latestReport.summary.status === "success" ? "Report generated" : "Failure report generated";
  elements.latestReportJson.textContent = JSON.stringify(latestReport, null, 2);

  if (!savedReportRunIds.has(state.runId)) {
    saveLocalFlowReport(latestReport);
    savedReportRunIds.add(state.runId);
  }
}

async function renderHistoryView(): Promise<void> {
  elements.historyList.innerHTML = `<div class="empty-log">Loading reports...</div>`;
  elements.historyJson.textContent = "{}";

  const localReports = readLocalReportHistory();
  const localItems: HistoryDisplayItem[] = localReports.map((report) => ({
    key: `local-${report.summary.runId}`,
    entry: createReportIndexEntry(report),
    report
  }));
  const ciIndex = await loadCiReportIndex();
  const ciItems: HistoryDisplayItem[] = ciIndex.reports.map((entry) => ({
    key: `ci-${entry.file ?? entry.runId}`,
    entry
  }));
  const items = [...localItems, ...ciItems].sort(
    (left, right) =>
      new Date(right.entry.generatedAt).getTime() - new Date(left.entry.generatedAt).getTime()
  );

  if (!items.length) {
    elements.historyList.innerHTML = `<div class="empty-log">No history yet.</div>`;
    return;
  }

  elements.historyList.innerHTML = items.map(renderHistoryItem).join("");
  elements.historyList.querySelectorAll<HTMLButtonElement>("[data-history-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((candidate) => candidate.key === button.dataset.historyKey);
      if (item) {
        void showHistoryReport(item);
      }
    });
  });

  await showHistoryReport(items[0]);
  createIcons({ icons });
}

async function loadCiReportIndex(): Promise<ReportIndex> {
  try {
    const response = await fetch(resolveReportUrl("reports/index.json"), { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Report index returned ${response.status}`);
    }
    const index = (await response.json()) as ReportIndex;
    return Array.isArray(index.reports)
      ? index
      : { schemaVersion: 1, updatedAt: new Date(0).toISOString(), reports: [] };
  } catch {
    return { schemaVersion: 1, updatedAt: new Date(0).toISOString(), reports: [] };
  }
}

async function showHistoryReport(item: HistoryDisplayItem): Promise<void> {
  const activeReport =
    item.report ??
    (item.entry.file ? await fetchReportFile(item.entry.file) : { summary: item.entry });

  elements.historyList.querySelectorAll("[data-history-key]").forEach((button) => {
    button.classList.toggle(
      "active",
      button instanceof HTMLElement && button.dataset.historyKey === item.key
    );
  });
  elements.historyJson.textContent = JSON.stringify(activeReport, null, 2);
}

async function fetchReportFile(file: string): Promise<unknown> {
  const response = await fetch(resolveReportUrl(file), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Report file returned ${response.status}`);
  }
  return response.json();
}

function renderHistoryItem(item: HistoryDisplayItem): string {
  const entry = item.entry;
  const statusClass = entry.status === "success" ? "ok" : entry.status === "failed" ? "bad" : "";
  return `
    <button class="history-item" data-history-key="${escapeHtml(item.key)}" type="button">
      <span class="runtime-pill ${statusClass}">${escapeHtml(entry.status)}</span>
      <strong>${escapeHtml(entry.scenario)}</strong>
      <span>${escapeHtml(new Date(entry.generatedAt).toLocaleString())}</span>
      <code>${escapeHtml(entry.source)} · ${escapeHtml(entry.runId)}</code>
    </button>
  `;
}

function resolveReportUrl(file: string): string {
  return new URL(file.replace(/^\//, ""), new URL(".", window.location.href)).toString();
}

function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
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

function renderScenarioLesson(scenario: FlowConfig["scenario"]): string {
  const lesson = SCENARIO_LESSONS[scenario];
  return `
    <span class="lesson-kicker">Learning goal</span>
    <h2>${escapeHtml(lesson.title)}</h2>
    <p>${escapeHtml(lesson.goal)}</p>
    <p>${escapeHtml(lesson.outcome)}</p>
  `;
}

function renderActiveLesson(state: FlowRunState): string {
  const step =
    state.steps.find((item) => item.status === "running") ??
    state.steps.find((item) => item.status === "failed") ??
    state.steps.find((item) => item.status === "idle") ??
    state.steps[state.steps.length - 1];

  return step ? renderActiveLessonForStep(step) : "";
}

function renderActiveLessonForStep(step: FlowStep): string {
  const lesson = STEP_LESSONS[step.id];
  return renderLessonCard(step.label, step.status, lesson);
}

function renderActiveLessonForDefinition(
  definition: ReturnType<typeof getFlowStepDefinitions>[number]
): string {
  const [id, label] = definition;
  return renderLessonCard(label, "idle", STEP_LESSONS[id]);
}

function renderLessonCard(label: string, status: FlowStep["status"], lesson: StepLesson): string {
  return `
    <span class="lesson-kicker">${escapeHtml(statusLabel(status))}</span>
    <h2>${escapeHtml(label)}</h2>
    <dl>
      <div>
        <dt>Concept</dt>
        <dd>${escapeHtml(lesson.concept)}</dd>
      </div>
      <div>
        <dt>RPC call</dt>
        <dd><code>${escapeHtml(lesson.rpc)}</code></dd>
      </div>
      <div>
        <dt>Why it matters</dt>
        <dd>${escapeHtml(lesson.meaning)}</dd>
      </div>
      <div>
        <dt>What to watch</dt>
        <dd>${escapeHtml(lesson.observe)}</dd>
      </div>
    </dl>
  `;
}

function renderStepDefinition(id: StepId, label: string): string {
  const lesson = STEP_LESSONS[id];
  return `
    <div class="step idle">
      <span></span>
      <div>
        <p>${escapeHtml(label)}</p>
        <small>${escapeHtml(lesson.concept)} · RPC: ${escapeHtml(lesson.rpc)}</small>
      </div>
    </div>
  `;
}

function renderStep(step: FlowStep): string {
  const lesson = STEP_LESSONS[step.id];
  return `
    <div class="step ${step.status}">
      <span></span>
      <div>
        <p>${escapeHtml(step.label)}</p>
        <small>${escapeHtml(lesson.concept)} · RPC: ${escapeHtml(lesson.rpc)}</small>
      </div>
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
          ["Restart recovery", formatMs(metrics.localRestartRecoveryMs)],
          ["Restart payment", formatMs(metrics.localRestartPaymentMs)],
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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

function statusLabel(status: FlowStep["status"]): string {
  switch (status) {
    case "running":
      return "Now learning";
    case "success":
      return "Completed lesson";
    case "failed":
      return "Needs attention";
    case "skipped":
      return "Skipped lesson";
    default:
      return "First lesson";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
