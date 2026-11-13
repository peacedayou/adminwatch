export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type ChainName = "ethereum" | "arbitrum" | "optimism" | "polygon" | "base";
export const CHAIN_NAMES: readonly ChainName[] = ["ethereum", "arbitrum", "optimism", "polygon", "base"];

/** Les quatre familles d'actions privilégiées demandées, plus la propriété du contrat. */
export type Category = "scheduled" | "upgrade" | "role" | "pause" | "oracle" | "ownership";
export type Severity = "info" | "warning" | "critical";

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

/** Contrat surveillé : son adresse et ce qu'il représente dans le protocole. */
export interface WatchedContract {
  address: Address;
  /** Rôle lisible, par exemple « Pool » ou « ACLManager ». */
  label: string;
}

/** Journal d'événement déjà décodé (par viem en production, à la main dans les tests). */
export interface DecodedLog {
  chain: ChainName;
  protocol: string;
  contract: WatchedContract;
  eventName: string;
  args: Record<string, unknown>;
  txHash: Hex;
  blockNumber: bigint;
  logIndex: number;
}

export interface AdminAlert {
  /** Identifiant stable : chaîne, transaction et position du journal. */
  id: string;
  chain: ChainName;
  protocol: string;
  contract: WatchedContract;
  category: Category;
  severity: Severity;
  title: string;
  details: string[];
  txHash: Hex;
  blockNumber: bigint;
}

export interface Watcher {
  address: Address;
  label: string;
  telegramChatId: string;
}
