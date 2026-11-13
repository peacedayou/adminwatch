/**
 * Transforme un journal décodé en alerte factuelle.
 *
 * Règle d'écriture : on décrit ce qui s'est passé sur la chaîne, sans interpréter
 * l'intention de l'équipe et sans dire quoi faire. Les détails sont des faits
 * vérifiables dans la transaction.
 */
import { keccakHex, selector } from "./keccak.ts";
import type { AdminAlert, Category, DecodedLog, Severity } from "./types.ts";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;

/** Noms de rôles connus (OpenZeppelin et ACLManager d'Aave V3). */
const ROLE_NAMES: Record<string, string> = Object.fromEntries([
  [ZERO_HASH, "DEFAULT_ADMIN_ROLE"],
  ...[
    "POOL_ADMIN", "EMERGENCY_ADMIN", "RISK_ADMIN", "FLASH_BORROWER", "BRIDGE", "ASSET_LISTING_ADMIN",
    "PAUSER_ROLE", "UNPAUSER_ROLE", "UPGRADER_ROLE", "MINTER_ROLE", "BURNER_ROLE", "OPERATOR_ROLE",
    "PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE", "TIMELOCK_ADMIN_ROLE", "GUARDIAN_ROLE",
  ].map((name) => [keccakHex(name), name]),
]);

/** Rôles dont l'attribution donne le pouvoir de geler, de mettre à jour ou de déplacer des fonds. */
const POWERFUL_ROLES = new Set([
  "DEFAULT_ADMIN_ROLE", "POOL_ADMIN", "EMERGENCY_ADMIN", "UPGRADER_ROLE", "TIMELOCK_ADMIN_ROLE",
  "PROPOSER_ROLE", "PAUSER_ROLE", "MINTER_ROLE",
]);

export function roleName(role: unknown): string {
  const hex = String(role).toLowerCase();
  return ROLE_NAMES[hex] ?? `rôle ${hex.slice(0, 10)}…`;
}

/** Appels internes reconnus dans une opération planifiée. */
const KNOWN_CALLS: Record<string, { label: string; category: Category; severity: Severity }> = {};
function known(sig: string, label: string, category: Category, severity: Severity) {
  KNOWN_CALLS[selector(sig)] = { label, category, severity };
}
known("upgradeTo(address)", "mise à jour du contrat (upgradeTo)", "upgrade", "critical");
known("upgradeToAndCall(address,bytes)", "mise à jour du contrat (upgradeToAndCall)", "upgrade", "critical");
known("upgrade(address,address)", "mise à jour d'un mandataire (ProxyAdmin.upgrade)", "upgrade", "critical");
known("upgradeAndCall(address,address,bytes)", "mise à jour d'un mandataire (ProxyAdmin.upgradeAndCall)", "upgrade", "critical");
known("grantRole(bytes32,address)", "attribution d'un rôle (grantRole)", "role", "critical");
known("revokeRole(bytes32,address)", "retrait d'un rôle (revokeRole)", "role", "warning");
known("transferOwnership(address)", "transfert de propriété (transferOwnership)", "ownership", "critical");
known("pause()", "mise en pause (pause)", "pause", "critical");
known("unpause()", "fin de la pause (unpause)", "pause", "info");
known("setPoolImpl(address)", "nouvelle implémentation du Pool Aave (setPoolImpl)", "upgrade", "critical");
known("setPriceOracle(address)", "nouvel oracle de prix Aave (setPriceOracle)", "oracle", "critical");
known("setAssetSources(address[],address[])", "nouvelles sources de prix (setAssetSources)", "oracle", "critical");
known("setReservePause(address,bool)", "pause d'une réserve Aave (setReservePause)", "pause", "critical");
known("setPoolPause(bool)", "pause du Pool Aave (setPoolPause)", "pause", "critical");
known("updateDelay(uint256)", "changement du délai du timelock (updateDelay)", "role", "warning");

/** Décrit l'appel contenu dans les données d'une opération planifiée. */
export function describeCall(data: unknown): { label: string; category: Category; severity: Severity } {
  const hex = typeof data === "string" ? data.toLowerCase() : "";
  if (hex.length < 10) return { label: "appel sans données (transfert de valeur ou fonction de repli)", category: "scheduled", severity: "warning" };
  return KNOWN_CALLS[hex.slice(0, 10)] ?? { label: `appel de la fonction ${hex.slice(0, 10)}`, category: "scheduled", severity: "warning" };
}

/** Pour QueueTransaction (Compound), la signature est fournie en clair. */
function describeSignature(signature: string, data: unknown) {
  if (!signature) return describeCall(data);
  return KNOWN_CALLS[selector(signature)] ?? { label: `appel de ${signature}`, category: "scheduled" as Category, severity: "warning" as Severity };
}

export function formatDuration(seconds: bigint): string {
  const s = Number(seconds);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86_400)} jours`;
}

function addr(v: unknown): string {
  return String(v);
}

interface Draft {
  category: Category;
  severity: Severity;
  title: string;
  details: string[];
}

function draft(log: DecodedLog): Draft | null {
  const a = log.args;
  switch (log.eventName) {
    case "Upgraded":
      return { category: "upgrade", severity: "critical", title: "Contrat mis à jour", details: [`Nouvelle implémentation : ${addr(a.implementation)}`] };
    case "BeaconUpgraded":
      return { category: "upgrade", severity: "critical", title: "Balise de mise à jour remplacée", details: [`Nouvelle balise : ${addr(a.beacon)}`] };
    case "AdminChanged":
      return { category: "role", severity: "critical", title: "Administrateur du mandataire changé", details: [`Ancien : ${addr(a.previousAdmin)}`, `Nouveau : ${addr(a.newAdmin)}`] };
    case "RoleGranted": {
      const name = roleName(a.role);
      return {
        category: "role",
        severity: POWERFUL_ROLES.has(name) ? "critical" : "warning",
        title: `Rôle attribué : ${name}`,
        details: [`Bénéficiaire : ${addr(a.account)}`, `Attribué par : ${addr(a.sender)}`],
      };
    }
    case "RoleRevoked":
      return { category: "role", severity: "warning", title: `Rôle retiré : ${roleName(a.role)}`, details: [`Compte : ${addr(a.account)}`, `Retiré par : ${addr(a.sender)}`] };
    case "RoleAdminChanged":
      return {
        category: "role", severity: "warning", title: `Administrateur du rôle ${roleName(a.role)} changé`,
        details: [`Ancien rôle administrateur : ${roleName(a.previousAdminRole)}`, `Nouveau : ${roleName(a.newAdminRole)}`],
      };
    case "OwnershipTransferred":
      // Le constructeur émet ce même événement depuis l'adresse nulle : ce n'est pas un changement.
      if (String(a.previousOwner).toLowerCase() === ZERO_ADDRESS) return null;
      return {
        category: "ownership",
        severity: "critical",
        title: String(a.newOwner).toLowerCase() === ZERO_ADDRESS ? "Propriété du contrat abandonnée" : "Propriété du contrat transférée",
        details: [`Ancien propriétaire : ${addr(a.previousOwner)}`, `Nouveau : ${addr(a.newOwner)}`],
      };
    case "Paused":
      return { category: "pause", severity: "critical", title: "Contrat mis en pause", details: [`Par : ${addr(a.account)}`] };
    case "Unpaused":
      return { category: "pause", severity: "info", title: "Fin de la pause", details: [`Par : ${addr(a.account)}`] };
    case "ReservePaused":
      return a.paused
        ? { category: "pause", severity: "critical", title: "Réserve mise en pause", details: [`Actif : ${addr(a.asset)}`] }
        : { category: "pause", severity: "info", title: "Réserve réactivée", details: [`Actif : ${addr(a.asset)}`] };
    case "CallScheduled": {
      const call = describeCall(a.data);
      const delay = typeof a.delay === "bigint" ? a.delay : BigInt(String(a.delay ?? 0));
      return {
        category: "scheduled",
        severity: call.severity === "info" ? "warning" : call.severity,
        title: `Opération planifiée : ${call.label}`,
        details: [`Contrat visé : ${addr(a.target)}`, `Exécutable dans : ${formatDuration(delay)} (délai du timelock)`, `Identifiant : ${String(a.id)}`],
      };
    }
    case "QueueTransaction": {
      const call = describeSignature(String(a.signature ?? ""), a.data);
      const eta = typeof a.eta === "bigint" ? a.eta : BigInt(String(a.eta ?? 0));
      const date = new Date(Number(eta) * 1000).toISOString().replace("T", " ").slice(0, 16);
      return {
        category: "scheduled",
        severity: call.severity === "info" ? "warning" : call.severity,
        title: `Opération planifiée : ${call.label}`,
        details: [`Contrat visé : ${addr(a.target)}`, `Exécutable à partir du : ${date} UTC`],
      };
    }
    case "MinDelayChange":
      return { category: "role", severity: "warning", title: "Délai du timelock modifié", details: [`Avant : ${formatDuration(BigInt(String(a.oldDuration)))}`, `Après : ${formatDuration(BigInt(String(a.newDuration)))}`] };
    case "NewDelay":
      return { category: "role", severity: "warning", title: "Délai du timelock modifié", details: [`Nouveau délai : ${formatDuration(BigInt(String(a.newDelay)))}`] };
    case "PoolUpdated":
      return { category: "upgrade", severity: "critical", title: "Implémentation du Pool remplacée", details: [`Ancienne : ${addr(a.oldAddress)}`, `Nouvelle : ${addr(a.newAddress)}`] };
    case "PoolConfiguratorUpdated":
      return { category: "upgrade", severity: "critical", title: "PoolConfigurator remplacé", details: [`Ancien : ${addr(a.oldAddress)}`, `Nouveau : ${addr(a.newAddress)}`] };
    case "ACLManagerUpdated":
      return { category: "role", severity: "critical", title: "Gestionnaire des rôles (ACLManager) remplacé", details: [`Ancien : ${addr(a.oldAddress)}`, `Nouveau : ${addr(a.newAddress)}`] };
    case "PriceOracleUpdated":
      return { category: "oracle", severity: "critical", title: "Oracle de prix remplacé", details: [`Ancien : ${addr(a.oldAddress)}`, `Nouveau : ${addr(a.newAddress)}`] };
    case "AssetSourceUpdated":
      return { category: "oracle", severity: "warning", title: "Source de prix d'un actif modifiée", details: [`Actif : ${addr(a.asset)}`, `Nouvelle source : ${addr(a.source)}`] };
    default:
      return null;
  }
}

export function alertId(log: Pick<DecodedLog, "chain" | "txHash" | "logIndex">): string {
  return `${log.chain}:${log.txHash.toLowerCase()}:${log.logIndex}`;
}

/** Renvoie null si l'événement n'est pas une action privilégiée à signaler. */
export function classify(log: DecodedLog): AdminAlert | null {
  const d = draft(log);
  if (!d) return null;
  return {
    id: alertId(log),
    chain: log.chain,
    protocol: log.protocol,
    contract: log.contract,
    category: d.category,
    severity: d.severity,
    title: d.title,
    details: d.details,
    txHash: log.txHash,
    blockNumber: log.blockNumber,
  };
}
