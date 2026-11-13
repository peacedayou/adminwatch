/**
 * Lecture et validation de la configuration (fichier JSON).
 * Les valeurs « ${VAR} » sont remplacées par des variables d'environnement,
 * pour garder les URL RPC et le jeton Telegram hors du fichier.
 */
import { CHAIN_NAMES, SEVERITY_RANK, type Address, type ChainName, type Severity, type Watcher } from "./types.ts";

export interface CustomContract {
  address: Address;
  label: string;
}

export interface CustomProtocol {
  name: string;
  chain: ChainName;
  contracts: CustomContract[];
  /** Jetons de reçu (parts de coffre, jetons LP…) : un solde non nul = une position. Vide = toujours surveillé. */
  positionTokens: Address[];
}

export interface Config {
  chains: Partial<Record<ChainName, { rpcUrl: string }>>;
  watchers: Watcher[];
  aaveV3: boolean;
  customProtocols: CustomProtocol[];
  pollSeconds: number;
  confirmations: number;
  maxBlocksPerCycle: number;
  minSeverity: Severity;
  telegramBotToken: string;
  statePath: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export class ConfigError extends Error {}

function fail(msg: string): never {
  throw new ConfigError(msg);
}

export function normalizeAddress(value: unknown, where: string): Address {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) fail(`${where} : adresse Ethereum invalide`);
  return value.toLowerCase() as Address;
}

function chainName(value: unknown, where: string): ChainName {
  if (!CHAIN_NAMES.includes(value as ChainName)) fail(`${where} : chaîne inconnue (${CHAIN_NAMES.join(", ")})`);
  return value as ChainName;
}

export function substituteEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, name: string) => {
    const v = env[name];
    if (v === undefined || v === "") fail(`Variable d'environnement manquante : ${name}`);
    return v;
  });
}

function int(value: unknown, def: number, min: number, max: number, where: string): number {
  if (value === undefined) return def;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fail(`${where} : entier attendu entre ${min} et ${max}`);
  return value as number;
}

export function parseConfig(raw: unknown, env: Record<string, string | undefined> = process.env): Config {
  if (typeof raw !== "object" || raw === null) fail("La configuration doit être un objet JSON");
  const r = raw as Record<string, unknown>;

  const chains: Config["chains"] = {};
  for (const [name, value] of Object.entries((r.chains ?? {}) as Record<string, { rpcUrl?: unknown }>)) {
    const chain = chainName(name, `chains.${name}`);
    if (typeof value?.rpcUrl !== "string") fail(`chains.${name}.rpcUrl manquant`);
    const url = substituteEnv(value.rpcUrl, env);
    if (!/^https?:\/\//.test(url)) fail(`chains.${name}.rpcUrl doit commencer par http(s)://`);
    chains[chain] = { rpcUrl: url };
  }
  if (Object.keys(chains).length === 0) fail("Au moins une chaîne doit être configurée");

  if (!Array.isArray(r.watchers) || r.watchers.length === 0) fail("watchers : au moins une adresse à surveiller");
  const watchers: Watcher[] = r.watchers.map((w: Record<string, unknown>, i: number) => {
    const chatId = String(w.telegramChatId ?? "");
    if (!/^-?\d{1,20}$/.test(chatId)) fail(`watchers[${i}].telegramChatId invalide`);
    return {
      address: normalizeAddress(w.address, `watchers[${i}].address`),
      label: typeof w.label === "string" && w.label.trim() ? w.label.trim().slice(0, 60) : `Adresse ${i + 1}`,
      telegramChatId: chatId,
    };
  });

  const customProtocols: CustomProtocol[] = ((r.customProtocols ?? []) as Record<string, unknown>[]).map((p, i) => {
    if (typeof p.name !== "string" || !p.name.trim()) fail(`customProtocols[${i}].name manquant`);
    const chain = chainName(p.chain, `customProtocols[${i}].chain`);
    if (!chains[chain]) fail(`customProtocols[${i}] : la chaîne ${chain} n'a pas d'URL RPC`);
    if (!Array.isArray(p.contracts) || p.contracts.length === 0) fail(`customProtocols[${i}].contracts vide`);
    return {
      name: p.name.trim().slice(0, 40),
      chain,
      contracts: p.contracts.map((c: Record<string, unknown>, j: number) => ({
        address: normalizeAddress(c.address, `customProtocols[${i}].contracts[${j}]`),
        label: typeof c.label === "string" ? c.label.slice(0, 40) : "Contrat",
      })),
      positionTokens: ((p.positionTokens ?? []) as unknown[]).map((t, j) => normalizeAddress(t, `customProtocols[${i}].positionTokens[${j}]`)),
    };
  });

  const minSeverity = (r.minSeverity ?? "warning") as Severity;
  if (!(minSeverity in SEVERITY_RANK)) fail("minSeverity : info, warning ou critical");

  const token = substituteEnv(String(r.telegramBotToken ?? "${TELEGRAM_BOT_TOKEN}"), env);
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) fail("Jeton du robot Telegram invalide");

  return {
    chains,
    watchers,
    aaveV3: r.aaveV3 !== false,
    customProtocols,
    pollSeconds: int(r.pollSeconds, 60, 15, 3600, "pollSeconds"),
    confirmations: int(r.confirmations, 3, 0, 64, "confirmations"),
    maxBlocksPerCycle: int(r.maxBlocksPerCycle, 2000, 10, 50_000, "maxBlocksPerCycle"),
    minSeverity,
    telegramBotToken: token,
    statePath: typeof r.statePath === "string" ? r.statePath : "data/state.json",
  };
}
