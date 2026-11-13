import type { AdminAlert, Category, ChainName, Severity, Watcher } from "./types.ts";

export const EXPLORERS: Record<ChainName, string> = {
  ethereum: "https://etherscan.io",
  arbitrum: "https://arbiscan.io",
  optimism: "https://optimistic.etherscan.io",
  polygon: "https://polygonscan.com",
  base: "https://basescan.org",
};

export const CHAIN_LABELS: Record<ChainName, string> = {
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  base: "Base",
};

const SEVERITY_ICON: Record<Severity, string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };

export const CATEGORY_LABELS: Record<Category, string> = {
  scheduled: "Opération planifiée",
  upgrade: "Mise à jour",
  role: "Rôles et permissions",
  pause: "Pause",
  oracle: "Oracle",
  ownership: "Propriété",
};

export const DISCLAIMER =
  "Fait observé sur la chaîne. AdminWatch lit seulement la blockchain et ne peut pas agir sur vos fonds. Ceci n'est pas un conseil financier.";

export function txUrl(alert: Pick<AdminAlert, "chain" | "txHash">): string {
  return `${EXPLORERS[alert.chain]}/tx/${alert.txHash}`;
}

/** Message texte brut pour Telegram (pas de Markdown : rien à échapper, rien à injecter). */
export function formatAlert(alert: AdminAlert, watcher?: Pick<Watcher, "label" | "address">): string {
  const lines = [
    `${SEVERITY_ICON[alert.severity]} ${alert.protocol} (${CHAIN_LABELS[alert.chain]}) : ${alert.title}`,
    `Catégorie : ${CATEGORY_LABELS[alert.category]}`,
    `Contrat : ${alert.contract.label} ${alert.contract.address}`,
    ...alert.details,
    `Bloc : ${alert.blockNumber.toString()}`,
    `Transaction : ${txUrl(alert)}`,
  ];
  if (watcher) lines.push(`Vous recevez cette alerte car ${watcher.label} (${shortAddress(watcher.address)}) a une position dans ce protocole.`);
  lines.push("", DISCLAIMER);
  return lines.join("\n");
}

export function shortAddress(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
