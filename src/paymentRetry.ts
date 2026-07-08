export interface PaymentFlowClient {
  dryRunPayment(targetPubkey: string, amount: string, timeoutMs: number): Promise<Record<string, unknown>>;
  sendPayment(targetPubkey: string, amount: string, timeoutMs: number): Promise<Record<string, unknown>>;
  getPayment(paymentHash: string): Promise<Record<string, unknown>>;
}

export interface PaymentRetryConfig {
  paymentTimeoutMs: number;
  pollIntervalMs: number;
}

class PaymentAttemptFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAttemptFailedError";
  }
}

export async function sendPaymentFlowUntilSuccess(
  client: PaymentFlowClient,
  targetPubkey: string,
  amount: string,
  config: PaymentRetryConfig
): Promise<Record<string, unknown>> {
  const deadlineMs = Date.now() + config.paymentTimeoutMs;
  let lastError: unknown;

  while (Date.now() < deadlineMs) {
    try {
      await waitForDryRunPayment(client, targetPubkey, amount, config, deadlineMs);
      const payment = await client.sendPayment(targetPubkey, amount, config.paymentTimeoutMs);
      const paymentHash = stringValue(payment.payment_hash);
      if (!paymentHash) {
        throw new Error("send_payment returned no payment_hash.");
      }

      return await waitForPaymentSuccess(client, paymentHash, config, deadlineMs);
    } catch (error) {
      lastError = error;
      if (!isPaymentAttemptFailed(error)) {
        throw error;
      }

      const remainingMs = remainingTimeoutMs(deadlineMs);
      if (remainingMs <= 0) {
        break;
      }
      await wait(Math.min(config.pollIntervalMs, remainingMs));
    }
  }

  if (lastError) {
    throw new Error(`Payment did not reach Success before timeout. Last error: ${errorMessage(lastError)}`);
  }

  throw new Error("Payment did not reach Success before timeout.");
}

async function waitForDryRunPayment(
  client: PaymentFlowClient,
  targetPubkey: string,
  amount: string,
  config: PaymentRetryConfig,
  deadlineMs: number
): Promise<Record<string, unknown>> {
  return poll(
    () => client.dryRunPayment(targetPubkey, amount, config.paymentTimeoutMs),
    deadlineMs,
    config.pollIntervalMs,
    "Dry-run payment kept failing before timeout."
  );
}

async function waitForPaymentSuccess(
  client: PaymentFlowClient,
  paymentHash: string,
  config: PaymentRetryConfig,
  deadlineMs: number
): Promise<Record<string, unknown>> {
  return poll(
    async () => {
      const current = await client.getPayment(paymentHash);
      if (current.status === "Success") {
        return current;
      }

      if (current.status === "Failed") {
        throw new PaymentAttemptFailedError(
          `Payment failed: ${stringValue(current.failed_error) || "unknown"}`
        );
      }

      return undefined;
    },
    deadlineMs,
    config.pollIntervalMs,
    "Payment did not reach Success before timeout.",
    isPaymentAttemptFailed
  );
}

async function poll<T>(
  read: () => Promise<T | undefined>,
  deadlineMs: number,
  intervalMs: number,
  timeoutMessage: string,
  shouldRethrow: (error: unknown) => boolean = () => false
): Promise<T> {
  let lastError: unknown;

  while (Date.now() < deadlineMs) {
    try {
      const value = await read();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
      if (shouldRethrow(error)) {
        throw error;
      }
    }

    const remainingMs = remainingTimeoutMs(deadlineMs);
    if (remainingMs <= 0) {
      break;
    }
    await wait(Math.min(intervalMs, remainingMs));
  }

  if (lastError) {
    throw new Error(`${timeoutMessage} Last error: ${errorMessage(lastError)}`);
  }

  throw new Error(timeoutMessage);
}

function remainingTimeoutMs(deadlineMs: number): number {
  return Math.max(0, deadlineMs - Date.now());
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isPaymentAttemptFailed(error: unknown): boolean {
  return error instanceof PaymentAttemptFailedError;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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
