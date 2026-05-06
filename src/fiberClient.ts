import { Fiber } from "@nervosnetwork/fiber-js";
import type { FlowConfig, LogLevel, RpcLog } from "./types";

type FiberInstance = InstanceType<typeof Fiber>;
type RpcHex = `0x${string}`;

export class FiberClient {
  private fiber: FiberInstance | null = null;

  constructor(
    private readonly name = "fiber",
    private readonly onRpcLog?: (entry: RpcLog) => void
  ) {}

  async startFiber(config: FlowConfig): Promise<void> {
    await this.stopFiber();

    this.fiber = new Fiber();
    await this.fiber.start(
      config.configYaml,
      hexToBytes(config.fiberSecretKeyHex),
      hexToBytes(config.ckbSecretKeyHex),
      undefined,
      config.logLevel as LogLevel,
      config.databasePrefix
    );
    exposeDebugFiber(this.name, this.fiber);
  }

  async stopFiber(): Promise<void> {
    if (!this.fiber) {
      return;
    }

    await this.fiber.stop();
    exposeDebugFiber(this.name, undefined);
    this.fiber = null;
  }

  async invoke<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
    return this.invokeLogged<T>(name, args);
  }

  async nodeInfo<T = Record<string, unknown>>(): Promise<T> {
    return this.invokeLogged<T>("node_info", []);
  }

  async connectPeer(address: string): Promise<void> {
    await this.invokeLogged("connect_peer", [{ address, save: true }]);
  }

  async connectPeerByPubkey(pubkey: string): Promise<void> {
    await this.invokeLogged("connect_peer", [{ pubkey, save: true }]);
  }

  async openChannel(pubkey: string, fundingAmount: string): Promise<Record<string, unknown>> {
    return (await this.invokeLogged("open_channel", [{
      pubkey,
      funding_amount: toRpcHex(fundingAmount),
      public: true
    }])) as unknown as Record<string, unknown>;
  }

  async listChannels(pubkey?: string): Promise<{ channels: Array<Record<string, unknown>> }> {
    return (await this.invokeLogged("list_channels", [{
      pubkey,
      include_closed: true
    }])) as unknown as { channels: Array<Record<string, unknown>> };
  }

  async graphChannels(): Promise<{ channels: Array<Record<string, unknown>> }> {
    return (await this.invokeLogged("graph_channels", [{ limit: "0xffff" }])) as unknown as {
      channels: Array<Record<string, unknown>>;
    };
  }

  async sendPayment(
    targetPubkey: string,
    amount: string
  ): Promise<Record<string, unknown>> {
    return (await this.invokeLogged("send_payment", [{
      target_pubkey: targetPubkey,
      amount: toRpcHex(amount),
      keysend: true
    }])) as unknown as Record<string, unknown>;
  }

  async dryRunPayment(
    targetPubkey: string,
    amount: string
  ): Promise<Record<string, unknown>> {
    return (await this.invokeLogged("send_payment", [{
      target_pubkey: targetPubkey,
      amount: toRpcHex(amount),
      keysend: true,
      dry_run: true
    }])) as unknown as Record<string, unknown>;
  }

  async getPayment(paymentHash: string): Promise<Record<string, unknown>> {
    return (await this.invokeLogged("get_payment", [{
      payment_hash: paymentHash as RpcHex
    }])) as unknown as Record<string, unknown>;
  }

  async listPeers(): Promise<{ peers: Array<Record<string, unknown>> }> {
    return (await this.invokeLogged("list_peers", [])) as unknown as {
      peers: Array<Record<string, unknown>>;
    };
  }

  async shutdownChannel(channelId: string): Promise<Record<string, unknown>> {
    return (await this.invokeLogged("shutdown_channel", [{
      channel_id: channelId,
      fee_rate: "0x3FC"
    }])) as unknown as Record<string, unknown>;
  }

  private activeFiber(): FiberInstance {
    if (!this.fiber) {
      throw new Error("Fiber WASM node has not been started.");
    }

    return this.fiber;
  }

  private async invokeLogged<T>(method: string, args: unknown[]): Promise<T> {
    const startedAt = new Date().toISOString();
    const startedMs = performance.now();
    this.onRpcLog?.({
      at: startedAt,
      node: this.name,
      method,
      args,
      status: "started"
    });

    try {
      const result = await this.activeFiber().invokeCommand(method, args);
      this.onRpcLog?.({
        at: new Date().toISOString(),
        node: this.name,
        method,
        args,
        status: "success",
        durationMs: Math.round(performance.now() - startedMs),
        result
      });
      return result as T;
    } catch (error) {
      this.onRpcLog?.({
        at: new Date().toISOString(),
        node: this.name,
        method,
        args,
        status: "failed",
        durationMs: Math.round(performance.now() - startedMs),
        error: errorMessage(error)
      });
      throw error;
    }
  }
}

export function randomSecretKeyHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function toRpcHex(value: string): RpcHex {
  const trimmed = value.trim();
  if (!trimmed) {
    return "0x0";
  }

  if (trimmed.startsWith("0x")) {
    return trimmed as RpcHex;
  }

  return `0x${BigInt(trimmed).toString(16)}`;
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Secret key must be a 32-byte hex string.");
  }

  const bytes = new Uint8Array(32);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function exposeDebugFiber(name: string, fiber: FiberInstance | undefined): void {
  const debugWindow = window as typeof window & {
    fibers?: Record<string, FiberInstance | undefined>;
  };
  debugWindow.fibers = debugWindow.fibers ?? {};

  if (fiber) {
    debugWindow.fibers[name] = fiber;
  } else {
    delete debugWindow.fibers[name];
  }
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
