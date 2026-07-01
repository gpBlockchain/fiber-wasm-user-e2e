export type RpcHex = `0x${string}`;

export interface KeysendPaymentParams {
  target_pubkey: string;
  amount: RpcHex;
  keysend: true;
  timeout: RpcHex;
  dry_run?: true;
}

export function createKeysendPaymentParams(
  targetPubkey: string,
  amount: string,
  timeoutMs: number,
  dryRun = false
): KeysendPaymentParams {
  const params: KeysendPaymentParams = {
    target_pubkey: targetPubkey,
    amount: toRpcHex(amount),
    keysend: true,
    timeout: toRpcHex(paymentTimeoutSeconds(timeoutMs))
  };

  if (dryRun) {
    params.dry_run = true;
  }

  return params;
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

function paymentTimeoutSeconds(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Payment timeout must be a positive number of milliseconds.");
  }

  return String(Math.ceil(timeoutMs / 1000));
}
