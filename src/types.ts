import { FLOW_STEP_DEFINITIONS } from "./constants";

export type StepId = (typeof FLOW_STEP_DEFINITIONS)[number][0];
export type StepStatus = "idle" | "running" | "success" | "failed" | "skipped";
export type LogLevel = "trace" | "debug" | "info" | "error";
export type FlowScenario = "testnet-single" | "local-multi-node";

export interface FlowStep {
  id: StepId;
  label: string;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface FlowMetrics {
  localNodeCount?: number;
  localPaymentCount?: number;
  localConnectPeersMs?: number;
  localChannelReadyMs?: number;
  localGraphSyncMs?: number;
  graphChannelCount?: number;
  connectPeerMs?: number;
  channelReadyMs?: number;
  graphSyncMs?: number;
  sendPaymentMs?: number;
  restartRecoveryMs?: number;
  restartPaymentMs?: number;
  shutdownMs?: number;
}

export interface LocalNodeConfig {
  name: string;
  fiberSecretKeyHex: string;
  ckbSecretKeyHex: string;
  externalPeerPubkey: string;
  fundingAmount?: string;
  databasePrefix?: string;
}

export interface FlowConfig {
  configYaml: string;
  fiberSecretKeyHex: string;
  ckbSecretKeyHex: string;
  databasePrefix: string;
  peerPubkey: string;
  fundingAmount: string;
  paymentTargetPubkey: string;
  paymentAmount: string;
  logLevel: LogLevel;
  pollIntervalMs: number;
  connectPeerTimeoutMs: number;
  channelReadyTimeoutMs: number;
  graphSyncTimeoutMs: number;
  paymentTimeoutMs: number;
  restartRecoveryTimeoutMs: number;
  scenario: FlowScenario;
  localNodeCount: number;
  localNodes: LocalNodeConfig[];
}

export interface RpcLog {
  at: string;
  node: string;
  method: string;
  args: unknown[];
  status: "started" | "success" | "failed";
  durationMs?: number;
  result?: unknown;
  error?: string;
}

export interface FlowLog {
  at: string;
  level: "info" | "success" | "error";
  message: string;
  payload?: unknown;
}

export interface FlowRunState {
  runId: string;
  scenario: FlowScenario;
  running: boolean;
  startedAt?: string;
  endedAt?: string;
  nodePubkey?: string;
  lastError?: string;
  metrics: FlowMetrics;
  steps: FlowStep[];
  logs: FlowLog[];
  flowLogDroppedCount: number;
  rpcLogs: RpcLog[];
  rpcLogDroppedCount: number;
}

export interface FlowCallbacks {
  onUpdate: (state: FlowRunState) => void;
}
