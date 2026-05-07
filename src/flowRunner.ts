import {
  getFlowStepDefinitions,
  MAX_EXPORT_ARRAY_ITEMS,
  MAX_EXPORT_DEPTH,
  MAX_EXPORT_STRING_LENGTH,
  MAX_FLOW_LOGS,
  MAX_RPC_LOGS
} from "./constants";
import { FiberClient } from "./fiberClient";
import type { FlowCallbacks, FlowConfig, FlowRunState, FlowStep, RpcLog, StepId } from "./types";

export class FlowRunner {
  private readonly client = new FiberClient("primary", (entry) => this.addRpcLog(entry));
  private readonly localClients: FiberClient[] = [];
  private localClientNames: string[] = [];
  private state: FlowRunState;

  constructor(private readonly callbacks: FlowCallbacks) {
    this.state = createInitialState("testnet-single");
  }

  async run(config: FlowConfig): Promise<FlowRunState> {
    await this.resetLocalClients();
    this.state = createInitialState(config.scenario);
    this.state.running = true;
    this.state.startedAt = new Date().toISOString();
    this.log("info", "Flow started.");
    this.emit();

    try {
      assertBrowserIsolation();

      if (config.scenario === "local-multi-node") {
        await this.runLocalMultiNode(config);
        this.log("success", "Local multi-node scenario finished successfully.");
        return this.state;
      }

      await this.runStep("start", () => this.client.startFiber(config));

      const nodeInfo = await this.runStep<Record<string, unknown>>("node-info", () =>
        this.client.nodeInfo()
      );
      this.state.nodePubkey = stringValue(nodeInfo.pubkey);

      const graph = await this.runStep<{ channels: Array<Record<string, unknown>> }>(
        "graph-channels",
        () => this.client.graphChannels()
      );
      this.state.metrics.graphChannelCount = graph.channels.length;

      await this.runStep("connect-peer", () => this.connectPeerAndWait(config));
      this.state.metrics.connectPeerMs = this.stepDuration("connect-peer");

      const existingChannelKeys = await this.channelKeys(config.peerPubkey);
      await this.runStep("open-channel", () =>
        this.client.openChannel(config.peerPubkey, config.fundingAmount)
      );

      const readyChannel = await this.runStep<Record<string, unknown>>("channel-ready", () =>
        this.waitForReadyChannel(config, existingChannelKeys)
      );
      this.state.metrics.channelReadyMs = this.stepDuration("channel-ready");

      await this.runStep("graph-sync", () =>
        this.waitForGraphChannel(config, stringValue(readyChannel.channel_outpoint))
      );
      this.state.metrics.graphSyncMs = this.stepDuration("graph-sync");

      await this.runStep("send-payment", () =>
        this.sendPaymentAndWait(config.paymentTargetPubkey, config.paymentAmount, config)
      );
      this.state.metrics.sendPaymentMs = this.stepDuration("send-payment");

      await this.runStep("stop", () => this.client.stopFiber());
      await this.runStep("restart", () => this.client.startFiber(config));

      await this.runStep("restart-recovery", () => this.waitForRestartRecovery(config));
      this.state.metrics.restartRecoveryMs = this.stepDuration("restart-recovery");

      await this.runStep("restart-payment", () =>
        this.sendPaymentAndWait(config.paymentTargetPubkey, config.paymentAmount, config)
      );
      this.state.metrics.restartPaymentMs = this.stepDuration("restart-payment");

      await this.runStep("shutdown", () => this.shutdownReadyChannels(this.client, config));
      this.state.metrics.shutdownMs = this.stepDuration("shutdown");

      this.log("success", "Flow finished successfully.");
    } catch (error) {
      const message = errorMessage(error);
      this.state.lastError = message;
      this.log("error", message, error);
    } finally {
      this.state.running = false;
      this.state.endedAt = new Date().toISOString();
      this.emit();
    }

    return this.state;
  }

  async stop(): Promise<void> {
    await this.client.stopFiber();
    await this.resetLocalClients();
    this.state.running = false;
    this.log("info", "Fiber WASM node stopped.");
    this.emit();
  }

  getState(): FlowRunState {
    return structuredClone(this.state);
  }

  private async runStep<T>(id: StepId, task: () => Promise<T>): Promise<T> {
    const step = this.step(id);
    step.status = "running";
    step.startedAt = new Date().toISOString();
    step.endedAt = undefined;
    step.durationMs = undefined;
    step.error = undefined;
    step.result = undefined;
    this.log("info", `Running ${step.label}.`);
    this.emit();

    try {
      const result = await task();
      step.status = "success";
      step.result = compactPayload(result);
      step.endedAt = new Date().toISOString();
      step.durationMs = elapsedMs(step.startedAt, step.endedAt);
      this.log("success", `${step.label} succeeded.`, result);
      this.emit();
      return result;
    } catch (error) {
      step.status = "failed";
      step.error = errorMessage(error);
      step.endedAt = new Date().toISOString();
      step.durationMs = elapsedMs(step.startedAt, step.endedAt);
      this.log("error", `${step.label} failed: ${step.error}`, error);
      this.markIdleStepsSkipped();
      this.emit();
      throw error;
    }
  }

  private async channelKeys(pubkey: string): Promise<Set<string>> {
    return this.channelKeysForClient(this.client, pubkey);
  }

  private async channelKeysForClient(client: FiberClient, pubkey: string): Promise<Set<string>> {
    const channels = await client.listChannels(pubkey);
    return new Set(channels.channels.map(channelKey).filter(Boolean));
  }

  private async runLocalMultiNode(config: FlowConfig): Promise<void> {
    const nodeCount = config.localNodes.length;
    this.state.metrics.localNodeCount = nodeCount;
    this.log("info", `Starting ${nodeCount} local WASM Fiber nodes.`);

    await this.runStep("local-start-nodes", async () => {
      const started = [];
      for (const [index, localNode] of config.localNodes.entries()) {
        const nodeName = localNode.name || `local-${index + 1}`;
        const client = new FiberClient(nodeName, (entry) => this.addRpcLog(entry));
        this.localClients.push(client);
        this.localClientNames.push(nodeName);
        await client.startFiber({
          ...config,
          fiberSecretKeyHex: localNode.fiberSecretKeyHex,
          ckbSecretKeyHex: localNode.ckbSecretKeyHex,
          databasePrefix: localNode.databasePrefix || `${config.databasePrefix}-${nodeName}`
        });
        started.push({
          name: nodeName,
          databasePrefix: localNode.databasePrefix || `${config.databasePrefix}-${nodeName}`
        });
      }
      return started;
    });

    const nodeInfos = await this.runStep<Array<Record<string, unknown>>>(
      "local-node-info",
      async () => {
        const infos = [];
        for (const [index, client] of this.localClients.entries()) {
          const nodeInfo = await client.nodeInfo<Record<string, unknown>>();
          infos.push(nodeInfo);
          this.log("success", `local-${index + 1} node_info`, nodeInfo);
        }
        return infos;
      }
    );

    this.state.nodePubkey = nodeInfos.map((info) => stringValue(info.pubkey)).join(", ");

    await this.runStep("local-connect-peers", async () => {
      const connected = [];
      for (const [index, client] of this.localClients.entries()) {
        const localNode = config.localNodes[index];
        const peer = await this.connectPeerByPubkeyUntilConnected(
          client,
          localNode.externalPeerPubkey,
          config
        );
        connected.push({
          node: localNode.name || `local-${index + 1}`,
          externalPeerPubkey: localNode.externalPeerPubkey,
          peer
        });
      }
      return connected;
    });
    this.state.metrics.localConnectPeersMs = this.stepDuration("local-connect-peers");

    const openResults = await this.runStep<Array<Record<string, unknown>>>(
      "local-open-channels",
      async () => {
        const opened = [];
        for (const [index, client] of this.localClients.entries()) {
          const localNode = config.localNodes[index];
          const existingKeys = await this.channelKeysForClient(client, localNode.externalPeerPubkey);
          const openResult = await client.openChannel(
            localNode.externalPeerPubkey,
            localNode.fundingAmount || config.fundingAmount
          );
          opened.push({
            node: localNode.name || `local-${index + 1}`,
            externalPeerPubkey: localNode.externalPeerPubkey,
            existingKeys: Array.from(existingKeys),
            openResult
          });
        }
        return opened;
      }
    );

    const readyChannels = await this.runStep<Array<Record<string, unknown>>>(
      "local-channel-ready",
      async () => {
        const ready = [];
        for (const [index, client] of this.localClients.entries()) {
          const localNode = config.localNodes[index];
          const existingKeys = new Set(openResults[index].existingKeys as string[]);
          const channel = await this.waitForReadyChannelWithClient(
            client,
            localNode.externalPeerPubkey,
            existingKeys,
            config
          );
          ready.push({
            node: localNode.name || `local-${index + 1}`,
            externalPeerPubkey: localNode.externalPeerPubkey,
            channel
          });
        }
        return ready;
      }
    );
    this.state.metrics.localChannelReadyMs = this.stepDuration("local-channel-ready");

    await this.runStep("local-graph-sync", async () => {
      const synced = [];
      for (const [observerIndex, observer] of this.localClients.entries()) {
        for (const [channelIndex, ready] of readyChannels.entries()) {
          if (observerIndex === channelIndex) {
            continue;
          }

          const channel = ready.channel as Record<string, unknown>;
          const channelOutpoint = stringValue(channel.channel_outpoint);
          if (!channelOutpoint) {
            throw new Error(`Ready channel from ${ready.node} has no channel_outpoint.`);
          }
          const graphChannel = await this.waitForGraphChannelWithClient(
            observer,
            channelOutpoint,
            config
          );
          synced.push({
            observer: config.localNodes[observerIndex]?.name || `local-${observerIndex + 1}`,
            source: config.localNodes[channelIndex]?.name || `local-${channelIndex + 1}`,
            channelOutpoint,
            graphChannel
          });
        }
      }
      return synced;
    });
    this.state.metrics.localGraphSyncMs = this.stepDuration("local-graph-sync");

    const payments = await this.runStep<Array<Record<string, unknown>>>(
      "local-send-payments",
      () => this.sendPaymentsBetweenLocalNodes(nodeInfos, config)
    );
    this.state.metrics.localPaymentCount = payments.length;
    this.state.metrics.sendPaymentMs = this.stepDuration("local-send-payments");

    await this.runStep("local-stop", async () => {
      const stopped = [];
      for (const [index, client] of this.localClients.entries()) {
        await client.stopFiber();
        stopped.push({
          node: this.localClientNames[index] || `local-${index + 1}`
        });
      }
      return stopped;
    });

    await this.runStep("local-restart", async () => {
      await this.resetLocalClients();
      const restarted = [];
      for (const [index, localNode] of config.localNodes.entries()) {
        const nodeName = localNode.name || `local-${index + 1}`;
        const client = new FiberClient(nodeName, (entry) => this.addRpcLog(entry));
        this.localClients.push(client);
        this.localClientNames.push(nodeName);
        const databasePrefix = localNode.databasePrefix || `${config.databasePrefix}-${nodeName}`;
        await client.startFiber({
          ...config,
          fiberSecretKeyHex: localNode.fiberSecretKeyHex,
          ckbSecretKeyHex: localNode.ckbSecretKeyHex,
          databasePrefix
        });
        const nodeInfo = await client.nodeInfo<Record<string, unknown>>();
        const expectedPubkey = stringValue(nodeInfos[index].pubkey);
        const actualPubkey = stringValue(nodeInfo.pubkey);
        if (expectedPubkey && actualPubkey !== expectedPubkey) {
          throw new Error(
            `${nodeName} restarted with unexpected pubkey ${actualPubkey}, expected ${expectedPubkey}.`
          );
        }
        restarted.push({
          node: nodeName,
          databasePrefix,
          pubkey: actualPubkey
        });
      }
      return restarted;
    });

    await this.runStep("local-restart-recovery", async () => {
      const recovered = [];
      for (const [index, client] of this.localClients.entries()) {
        const localNode = config.localNodes[index];
        const result = await this.waitForRestartRecoveryWithClient(
          client,
          localNode.externalPeerPubkey,
          config
        );
        recovered.push({
          node: localNode.name || `local-${index + 1}`,
          externalPeerPubkey: localNode.externalPeerPubkey,
          result
        });
      }
      return recovered;
    });
    this.state.metrics.localRestartRecoveryMs = this.stepDuration("local-restart-recovery");

    const restartPayments = await this.runStep<Array<Record<string, unknown>>>(
      "local-restart-payment",
      () => this.sendPaymentsBetweenLocalNodes(nodeInfos, config)
    );
    this.state.metrics.localRestartPaymentMs = this.stepDuration("local-restart-payment");
    this.state.metrics.localPaymentCount += restartPayments.length;

    await this.runStep("local-shutdown", async () => {
      const results = [];
      for (const client of this.localClients) {
        results.push(await this.shutdownReadyChannels(client, config));
      }
      return results;
    });
    this.state.metrics.shutdownMs = this.stepDuration("local-shutdown");
  }

  private async resetLocalClients(): Promise<void> {
    await Promise.allSettled(this.localClients.map((client) => client.stopFiber()));
    this.localClients.length = 0;
    this.localClientNames.length = 0;
  }

  private async sendPaymentsBetweenLocalNodes(
    nodeInfos: Array<Record<string, unknown>>,
    config: FlowConfig
  ): Promise<Array<Record<string, unknown>>> {
    const results = [];
    for (let from = 0; from < this.localClients.length; from += 1) {
      for (let to = 0; to < this.localClients.length; to += 1) {
        if (from === to) {
          continue;
        }

        const src = this.localClients[from];
        const targetPubkey = stringValue(nodeInfos[to].pubkey);
        const result = await this.sendPaymentAndWaitWithClient(
          src,
          targetPubkey,
          config.paymentAmount,
          config
        );
        results.push({
          from: config.localNodes[from]?.name || `local-${from + 1}`,
          to: config.localNodes[to]?.name || `local-${to + 1}`,
          result
        });
      }
    }
    return results;
  }

  private async connectPeerAndWait(config: FlowConfig): Promise<Record<string, unknown>> {
    return this.connectPeerByPubkeyUntilConnected(this.client, config.peerPubkey, config);
  }

  private async connectPeerByPubkeyUntilConnected(
    client: FiberClient,
    pubkey: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        await client.connectPeerByPubkey(pubkey);
        const peers = await client.listPeers();
        return peers.peers.find((peer) => peer.pubkey === pubkey);
      },
      config.connectPeerTimeoutMs,
      config.pollIntervalMs,
      `connect_peer by pubkey returned, but peer ${pubkey} did not appear in list_peers before timeout.`
    );
  }

  private async waitForPeerConnected(config: FlowConfig): Promise<Record<string, unknown>> {
    return this.waitForPeerConnectedWithClient(this.client, config.peerPubkey, config);
  }

  private async waitForPeerConnectedWithClient(
    client: FiberClient,
    pubkey: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        const peers = await client.listPeers();
        return peers.peers.find((peer) => peer.pubkey === pubkey);
      },
      config.connectPeerTimeoutMs,
      config.pollIntervalMs,
      "connect_peer returned, but target peer did not appear in list_peers before timeout."
    );
  }

  private async waitForReadyChannel(
    config: FlowConfig,
    existingKeys: Set<string>
  ): Promise<Record<string, unknown>> {
    return this.waitForReadyChannelWithClient(this.client, config.peerPubkey, existingKeys, config);
  }

  private async waitForReadyChannelWithClient(
    client: FiberClient,
    pubkey: string,
    existingKeys: Set<string>,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        const channels = await client.listChannels(pubkey);
        return channels.channels.find((channel) => {
          const key = channelKey(channel);
          return (
            key &&
            !existingKeys.has(key) &&
            stateName(channel) === "ChannelReady" &&
            typeof channel.channel_outpoint === "string"
          );
        });
      },
      config.channelReadyTimeoutMs,
      config.pollIntervalMs,
      "New channel did not reach ChannelReady before timeout."
    );
  }

  private async waitForGraphChannel(
    config: FlowConfig,
    channelOutpoint: string
  ): Promise<Record<string, unknown>> {
    return this.waitForGraphChannelWithClient(this.client, channelOutpoint, config, true);
  }

  private async waitForGraphChannelWithClient(
    client: FiberClient,
    channelOutpoint: string,
    config: FlowConfig,
    updateGraphMetric = false
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        const graph = await client.graphChannels();
        if (updateGraphMetric) {
          this.state.metrics.graphChannelCount = graph.channels.length;
          this.emit();
        }
        return graph.channels.find((channel) => channel.channel_outpoint === channelOutpoint);
      },
      config.graphSyncTimeoutMs,
      config.pollIntervalMs,
      "New channel did not appear in graph_channels before timeout."
    );
  }

  private async sendPaymentAndWait(
    targetPubkey: string,
    amount: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return this.sendPaymentAndWaitWithClient(this.client, targetPubkey, amount, config);
  }

  private async sendPaymentAndWaitWithClient(
    client: FiberClient,
    targetPubkey: string,
    amount: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    await this.waitForDryRunPaymentWithClient(client, targetPubkey, amount, config);
    const payment = await client.sendPayment(targetPubkey, amount);
    const paymentHash = stringValue(payment.payment_hash);

    return poll(
      async () => {
        const current = await client.getPayment(paymentHash);
        if (current.status === "Success") {
          return current;
        }

        if (current.status === "Failed") {
          throw new Error(`Payment failed: ${stringValue(current.failed_error) || "unknown"}`);
        }

        return undefined;
      },
      config.paymentTimeoutMs,
      config.pollIntervalMs,
      "Payment did not reach Success before timeout."
    );
  }

  private async waitForDryRunPaymentWithClient(
    client: FiberClient,
    targetPubkey: string,
    amount: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        return client.dryRunPayment(targetPubkey, amount);
      },
      config.paymentTimeoutMs,
      config.pollIntervalMs,
      "Dry-run payment kept failing before timeout."
    );
  }

  private async waitForRestartRecovery(config: FlowConfig): Promise<Record<string, unknown>> {
    return this.waitForRestartRecoveryWithClient(this.client, config.peerPubkey, config);
  }

  private async waitForRestartRecoveryWithClient(
    client: FiberClient,
    pubkey: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        const [peers, channels] = await Promise.all([
          client.listPeers(),
          client.listChannels(pubkey)
        ]);
        const peerRecovered = peers.peers.some((peer) => peer.pubkey === pubkey);
        const channelRecovered = channels.channels.some(
          (channel) => stateName(channel) === "ChannelReady"
        );

        if (peerRecovered && channelRecovered) {
          return { peerRecovered, channelRecovered, peers, channels };
        }

        return undefined;
      },
      config.restartRecoveryTimeoutMs,
      config.pollIntervalMs,
      "Restart recovery did not restore peer and channel visibility before timeout."
    );
  }

  private async shutdownReadyChannels(
    client: FiberClient,
    config: FlowConfig
  ): Promise<Array<Record<string, unknown>>> {
    const channels = await client.listChannels();
    const readyChannels = channels.channels.filter(
      (channel) => stateName(channel) === "ChannelReady" && stringValue(channel.channel_id)
    );
    const results = [];

    for (const channel of readyChannels) {
      const channelId = stringValue(channel.channel_id);
      await client.shutdownChannel(channelId);
      const closed = await this.waitForChannelClosed(client, channelId, config);
      results.push(closed);
    }

    return results;
  }

  private async waitForChannelClosed(
    client: FiberClient,
    channelId: string,
    config: FlowConfig
  ): Promise<Record<string, unknown>> {
    return poll(
      async () => {
        const channels = await client.listChannels();
        return channels.channels.find(
          (channel) => stringValue(channel.channel_id) === channelId && stateName(channel) === "Closed"
        );
      },
      config.channelReadyTimeoutMs,
      config.pollIntervalMs,
      `Channel ${channelId} did not reach Closed before timeout.`
    );
  }

  private step(id: StepId): FlowStep {
    const step = this.state.steps.find((candidate) => candidate.id === id);
    if (!step) {
      throw new Error(`Unknown step: ${id}`);
    }

    return step;
  }

  private stepDuration(id: StepId): number | undefined {
    return this.step(id).durationMs;
  }

  private markIdleStepsSkipped(): void {
    this.state.steps.forEach((step) => {
      if (step.status === "idle") {
        step.status = "skipped";
      }
    });
  }

  private log(level: "info" | "success" | "error", message: string, payload?: unknown): void {
    const nextLogs = [
      ...this.state.logs,
      {
        at: new Date().toISOString(),
        level,
        message,
        payload: compactPayload(payload)
      }
    ];

    if (nextLogs.length > MAX_FLOW_LOGS) {
      const dropped = nextLogs.length - MAX_FLOW_LOGS;
      this.state.logs = nextLogs.slice(dropped);
      this.state.flowLogDroppedCount += dropped;
    } else {
      this.state.logs = nextLogs;
    }
  }

  private addRpcLog(entry: RpcLog): void {
    const nextLogs = [...this.state.rpcLogs, compactRpcLog(entry)];
    if (nextLogs.length > MAX_RPC_LOGS) {
      const dropped = nextLogs.length - MAX_RPC_LOGS;
      this.state.rpcLogs = nextLogs.slice(dropped);
      this.state.rpcLogDroppedCount += dropped;
    } else {
      this.state.rpcLogs = nextLogs;
    }
    this.emit();
  }

  private emit(): void {
    this.callbacks.onUpdate(this.getState());
  }
}

function createInitialState(scenario: FlowConfig["scenario"]): FlowRunState {
  return {
    runId: crypto.randomUUID(),
    scenario,
    running: false,
    metrics: {},
    steps: getFlowStepDefinitions(scenario).map(([id, label]) => ({
      id,
      label,
      status: "idle"
    })),
    logs: [],
    flowLogDroppedCount: 0,
    rpcLogs: [],
    rpcLogDroppedCount: 0
  };
}

function assertBrowserIsolation(): void {
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    throw new Error(
      "SharedArrayBuffer is unavailable. Start the app through Vite so COOP/COEP headers are applied."
    );
  }
}

async function poll<T>(
  read: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs: number,
  timeoutMessage: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (message.startsWith("Payment failed:")) {
        throw error;
      }
    }

    await wait(intervalMs);
  }

  if (lastError) {
    throw new Error(`${timeoutMessage} Last error: ${errorMessage(lastError)}`);
  }

  throw new Error(timeoutMessage);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function channelKey(channel: Record<string, unknown>): string {
  return stringValue(channel.channel_id) || stringValue(channel.channel_outpoint);
}

function stateName(channel: Record<string, unknown>): string {
  const state = channel.state as { state_name?: string } | undefined;
  return state?.state_name ?? "";
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function elapsedMs(startedAt: string, endedAt: string): number {
  return new Date(endedAt).getTime() - new Date(startedAt).getTime();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

export function createRawExportSnapshot(state: FlowRunState): Record<string, unknown> {
  return {
    runId: state.runId,
    scenario: state.scenario,
    running: state.running,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
    nodePubkey: state.nodePubkey,
    lastError: state.lastError,
    metrics: state.metrics,
    steps: state.steps,
    logs: state.logs,
    flowLogDroppedCount: state.flowLogDroppedCount,
    rpcLogs: state.rpcLogs,
    rpcLogDroppedCount: state.rpcLogDroppedCount,
    exportNote:
      "Large payloads are compacted and logs are capped to keep browser memory bounded."
  };
}

function compactRpcLog(entry: RpcLog): RpcLog {
  return {
    ...entry,
    args: compactPayload(entry.args) as unknown[],
    result: compactPayload(entry.result),
    error: entry.error
  };
}

function compactPayload(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message),
      stack: truncateString(value.stack ?? "")
    };
  }

  if (typeof value === "string") {
    return truncateString(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (depth >= MAX_EXPORT_DEPTH) {
    return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_EXPORT_ARRAY_ITEMS)
      .map((item) => compactPayload(item, depth + 1, seen));
    if (value.length > MAX_EXPORT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_EXPORT_ARRAY_ITEMS} more items truncated]`);
    }
    return items;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_EXPORT_ARRAY_ITEMS)) {
    output[key] = compactPayload(nestedValue, depth + 1, seen);
  }

  const keyCount = Object.keys(value).length;
  if (keyCount > MAX_EXPORT_ARRAY_ITEMS) {
    output.__truncatedKeys = keyCount - MAX_EXPORT_ARRAY_ITEMS;
  }

  return output;
}

function truncateString(value: string): string {
  if (value.length <= MAX_EXPORT_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_EXPORT_STRING_LENGTH)}... [truncated ${value.length - MAX_EXPORT_STRING_LENGTH} chars]`;
}
