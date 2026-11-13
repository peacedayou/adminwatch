import type { DecodedLog, Hex } from "../src/core/types.ts";

export const POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2" as const;
export const ALICE = "0x1111111111111111111111111111111111111111" as const;
export const BOB = "0x2222222222222222222222222222222222222222" as const;

let counter = 0;
export function txHash(): Hex {
  counter++;
  return `0x${counter.toString(16).padStart(64, "0")}`;
}

export function log(eventName: string, args: Record<string, unknown>, extra: Partial<DecodedLog> = {}): DecodedLog {
  return {
    chain: "ethereum",
    protocol: "Aave V3",
    contract: { address: POOL, label: "Pool" },
    eventName,
    args,
    txHash: txHash(),
    blockNumber: 100n,
    logIndex: 0,
    ...extra,
  };
}
