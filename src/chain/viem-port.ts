/**
 * Accès à la chaîne avec viem : lecture seule (eth_blockNumber, eth_call, eth_getLogs).
 * Aucune clé privée, aucune transaction.
 */
import { createPublicClient, http, parseAbi, type AbiEvent } from "viem";
import type { CustomProtocol } from "../core/config.ts";
import type { ChainPort, ProtocolPort } from "../core/engine.ts";
import { ADMIN_EVENT_SIGNATURES } from "../core/events.ts";
import type { Address, ChainName, DecodedLog, Hex, WatchedContract } from "../core/types.ts";

export const ADMIN_EVENTS = parseAbi(ADMIN_EVENT_SIGNATURES) as unknown as readonly AbiEvent[];

/** Pools Aave V3 (mêmes adresses que LiquiGuard). Le reste est découvert à partir du Pool. */
export const AAVE_V3_POOLS: Record<ChainName, Address> = {
  ethereum: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
  arbitrum: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
  optimism: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
  polygon: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
  base: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
};

const poolAbi = parseAbi([
  "function ADDRESSES_PROVIDER() view returns (address)",
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
]);

const providerAbi = parseAbi([
  "function getPoolConfigurator() view returns (address)",
  "function getACLManager() view returns (address)",
  "function getPriceOracle() view returns (address)",
]);

const erc20Abi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

type Client = ReturnType<typeof makeClient>;

function makeClient(rpcUrl: string) {
  return createPublicClient({ transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
}

const lower = (a: string) => a.toLowerCase() as Address;

export async function discoverAaveV3(client: Client, chain: ChainName): Promise<ProtocolPort> {
  const pool = AAVE_V3_POOLS[chain];
  const provider = lower(await client.readContract({ address: pool, abi: poolAbi, functionName: "ADDRESSES_PROVIDER" }));
  const [configurator, aclManager, oracle] = await Promise.all([
    client.readContract({ address: provider, abi: providerAbi, functionName: "getPoolConfigurator" }),
    client.readContract({ address: provider, abi: providerAbi, functionName: "getACLManager" }),
    client.readContract({ address: provider, abi: providerAbi, functionName: "getPriceOracle" }),
  ]);
  const contracts: WatchedContract[] = [
    { address: pool, label: "Pool" },
    { address: provider, label: "PoolAddressesProvider" },
    { address: lower(configurator), label: "PoolConfigurator" },
    { address: lower(aclManager), label: "ACLManager" },
    { address: lower(oracle), label: "AaveOracle" },
  ];
  return {
    name: "Aave V3",
    chain,
    contracts,
    async hasPosition(user) {
      const [collateral, debt] = await client.readContract({ address: pool, abi: poolAbi, functionName: "getUserAccountData", args: [user] });
      return collateral > 0n || debt > 0n;
    },
  };
}

export function customProtocol(client: Client, p: CustomProtocol): ProtocolPort {
  return {
    name: p.name,
    chain: p.chain,
    contracts: p.contracts,
    async hasPosition(user) {
      if (p.positionTokens.length === 0) return true; // surveillé explicitement
      for (const token of p.positionTokens) {
        const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [user] });
        if (balance > 0n) return true;
      }
      return false;
    },
  };
}

interface RawLog {
  address: string;
  eventName?: string;
  args?: Record<string, unknown> | readonly unknown[];
  transactionHash: Hex | null;
  blockNumber: bigint | null;
  logIndex: number | null;
}

export class ViemChainPort implements ChainPort {
  readonly chain: ChainName;
  private readonly client: Client;
  private readonly opts: { aaveV3: boolean; custom: CustomProtocol[] };
  private cache?: { at: number; protocols: ProtocolPort[] };

  constructor(chain: ChainName, rpcUrl: string, opts: { aaveV3: boolean; custom: CustomProtocol[] }) {
    this.chain = chain;
    this.opts = opts;
    this.client = makeClient(rpcUrl);
  }

  head(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  /** Découverte mise en cache une heure : les adresses d'Aave peuvent changer par gouvernance. */
  async protocols(): Promise<ProtocolPort[]> {
    if (this.cache && Date.now() - this.cache.at < 3_600_000) return this.cache.protocols;
    const list: ProtocolPort[] = [];
    if (this.opts.aaveV3) list.push(await discoverAaveV3(this.client, this.chain));
    for (const p of this.opts.custom.filter((c) => c.chain === this.chain)) list.push(customProtocol(this.client, p));
    this.cache = { at: Date.now(), protocols: list };
    return list;
  }

  async scan(protocol: ProtocolPort, fromBlock: bigint, toBlock: bigint): Promise<DecodedLog[]> {
    const byAddress = new Map(protocol.contracts.map((c) => [c.address.toLowerCase(), c]));
    const raw = await this.getLogsSplitting([...byAddress.keys()] as Address[], fromBlock, toBlock, 0);
    const out: DecodedLog[] = [];
    for (const log of raw) {
      const contract = byAddress.get(log.address.toLowerCase());
      if (!contract || !log.eventName || !log.args || Array.isArray(log.args) || log.transactionHash === null || log.blockNumber === null || log.logIndex === null) continue;
      out.push({
        chain: this.chain,
        protocol: protocol.name,
        contract,
        eventName: log.eventName,
        args: log.args as Record<string, unknown>,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
      });
    }
    return out;
  }

  /** Beaucoup de fournisseurs RPC limitent la plage d'eth_getLogs : on coupe en deux en cas de refus. */
  private async getLogsSplitting(address: Address[], fromBlock: bigint, toBlock: bigint, depth: number): Promise<RawLog[]> {
    try {
      // strict: true écarte les journaux dont la structure ne correspond pas exactement à l'ABI.
      return (await this.client.getLogs({ address, events: ADMIN_EVENTS, fromBlock, toBlock, strict: true })) as unknown as RawLog[];
    } catch (err) {
      if (fromBlock >= toBlock || depth >= 8) throw err;
      const mid = (fromBlock + toBlock) / 2n;
      const left = await this.getLogsSplitting(address, fromBlock, mid, depth + 1);
      const right = await this.getLogsSplitting(address, mid + 1n, toBlock, depth + 1);
      return [...left, ...right];
    }
  }
}
