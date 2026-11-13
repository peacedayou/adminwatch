/**
 * Catalogue des événements d'administration surveillés.
 *
 * Les signatures sont au format « ABI lisible » : viem les transforme en ABI
 * (parseAbi) côté chaîne, et le cœur s'en sert pour calculer les sujets (topic0)
 * dans les tests. Une seule source de vérité.
 */
import { keccakHex } from "./keccak.ts";

export const ADMIN_EVENT_SIGNATURES = [
  // Mandataires ERC-1967 (mises à jour de contrats)
  "event Upgraded(address indexed implementation)",
  "event AdminChanged(address previousAdmin, address newAdmin)",
  "event BeaconUpgraded(address indexed beacon)",
  // OpenZeppelin AccessControl
  "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender)",
  "event RoleAdminChanged(bytes32 indexed role, bytes32 indexed previousAdminRole, bytes32 indexed newAdminRole)",
  // OpenZeppelin Ownable
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  // OpenZeppelin Pausable
  "event Paused(address account)",
  "event Unpaused(address account)",
  // OpenZeppelin TimelockController
  "event CallScheduled(bytes32 indexed id, uint256 indexed index, address target, uint256 value, bytes data, bytes32 predecessor, uint256 delay)",
  "event MinDelayChange(uint256 oldDuration, uint256 newDuration)",
  // Timelock de type Compound
  "event QueueTransaction(bytes32 indexed txHash, address indexed target, uint256 value, string signature, bytes data, uint256 eta)",
  "event NewDelay(uint256 indexed newDelay)",
  // Aave V3 : PoolAddressesProvider, PoolConfigurator, AaveOracle
  "event PoolUpdated(address indexed oldAddress, address indexed newAddress)",
  "event PoolConfiguratorUpdated(address indexed oldAddress, address indexed newAddress)",
  "event ACLManagerUpdated(address indexed oldAddress, address indexed newAddress)",
  "event PriceOracleUpdated(address indexed oldAddress, address indexed newAddress)",
  "event ReservePaused(address indexed asset, bool paused)",
  "event AssetSourceUpdated(address indexed asset, address indexed source)",
] as const;

/** Transforme « event Nom(type indexed a, type b) » en signature canonique « Nom(type,type) ». */
export function canonicalSignature(humanReadable: string): string {
  const m = /^event\s+(\w+)\((.*)\)$/.exec(humanReadable.trim());
  if (!m) throw new Error(`Signature invalide : ${humanReadable}`);
  const types = m[2]!
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/\s+/)[0]);
  return `${m[1]}(${types.join(",")})`;
}

export function eventName(humanReadable: string): string {
  return canonicalSignature(humanReadable).split("(")[0]!;
}

export function topic0(humanReadable: string): `0x${string}` {
  return keccakHex(canonicalSignature(humanReadable));
}

export const ADMIN_EVENT_NAMES: ReadonlySet<string> = new Set(ADMIN_EVENT_SIGNATURES.map(eventName));
