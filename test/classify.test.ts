import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, describeCall, formatDuration, roleName } from "../src/core/classify.ts";
import { formatAlert, DISCLAIMER } from "../src/core/format.ts";
import { keccakHex, selector } from "../src/core/keccak.ts";
import { ALICE, BOB, log } from "./helpers.ts";

const ZERO = "0x0000000000000000000000000000000000000000";

test("mise à jour ERC-1967 : critique", () => {
  const a = classify(log("Upgraded", { implementation: BOB }))!;
  assert.equal(a.category, "upgrade");
  assert.equal(a.severity, "critical");
  assert.match(a.details[0]!, new RegExp(BOB));
});

test("rôle puissant d'Aave reconnu par son nom", () => {
  const a = classify(log("RoleGranted", { role: keccakHex("POOL_ADMIN"), account: BOB, sender: ALICE }))!;
  assert.equal(a.category, "role");
  assert.equal(a.severity, "critical");
  assert.equal(a.title, "Rôle attribué : POOL_ADMIN");
});

test("rôle inconnu : avertissement avec empreinte abrégée", () => {
  const role = keccakHex("SOMETHING_ELSE");
  const a = classify(log("RoleGranted", { role, account: BOB, sender: ALICE }))!;
  assert.equal(a.severity, "warning");
  assert.equal(roleName(role), `rôle ${role.slice(0, 10)}…`);
  assert.equal(roleName(`0x${"0".repeat(64)}`), "DEFAULT_ADMIN_ROLE");
});

test("OwnershipTransferred depuis l'adresse nulle (déploiement) : ignoré", () => {
  assert.equal(classify(log("OwnershipTransferred", { previousOwner: ZERO, newOwner: ALICE })), null);
});

test("abandon de propriété vers l'adresse nulle", () => {
  const a = classify(log("OwnershipTransferred", { previousOwner: ALICE, newOwner: ZERO }))!;
  assert.equal(a.title, "Propriété du contrat abandonnée");
  assert.equal(a.category, "ownership");
});

test("pause et fin de pause", () => {
  assert.equal(classify(log("Paused", { account: ALICE }))!.severity, "critical");
  assert.equal(classify(log("Unpaused", { account: ALICE }))!.severity, "info");
  assert.equal(classify(log("ReservePaused", { asset: BOB, paused: true }))!.title, "Réserve mise en pause");
  assert.equal(classify(log("ReservePaused", { asset: BOB, paused: false }))!.severity, "info");
});

test("oracle : remplacement global critique, source d'un actif en avertissement", () => {
  assert.equal(classify(log("PriceOracleUpdated", { oldAddress: ALICE, newAddress: BOB }))!.severity, "critical");
  const a = classify(log("AssetSourceUpdated", { asset: ALICE, source: BOB }))!;
  assert.equal(a.category, "oracle");
  assert.equal(a.severity, "warning");
});

test("opération planifiée (TimelockController) contenant une mise à jour", () => {
  const data = `${selector("upgradeTo(address)")}${"0".repeat(24)}${BOB.slice(2)}`;
  const a = classify(log("CallScheduled", { id: `0x${"ab".repeat(32)}`, index: 0n, target: ALICE, value: 0n, data, predecessor: `0x${"0".repeat(64)}`, delay: 172_800n }))!;
  assert.equal(a.category, "scheduled");
  assert.equal(a.severity, "critical");
  assert.equal(a.title, "Opération planifiée : mise à jour du contrat (upgradeTo)");
  assert.ok(a.details.some((d) => d.includes("2 jours")));
});

test("opération planifiée inconnue : avertissement, sélecteur affiché", () => {
  const a = classify(log("CallScheduled", { id: "0x01", index: 0n, target: ALICE, value: 0n, data: "0xdeadbeef00", predecessor: "0x00", delay: 3600n }))!;
  assert.equal(a.severity, "warning");
  assert.match(a.title, /0xdeadbeef/);
});

test("planification d'une fin de pause : au moins un avertissement", () => {
  const a = classify(log("CallScheduled", { id: "0x01", index: 0n, target: ALICE, value: 0n, data: selector("unpause()"), predecessor: "0x00", delay: 3600n }))!;
  assert.equal(a.severity, "warning");
});

test("QueueTransaction (Compound) : la signature en clair est reconnue", () => {
  const a = classify(log("QueueTransaction", { txHash: "0x01", target: ALICE, value: 0n, signature: "transferOwnership(address)", data: "0x", eta: 1_800_000_000n }))!;
  assert.equal(a.category, "scheduled");
  assert.equal(a.severity, "critical");
  assert.ok(a.details.some((d) => d.includes("2027-01-15")));
});

test("événement hors catalogue : ignoré", () => {
  assert.equal(classify(log("Supply", { user: ALICE })), null);
});

test("identifiant stable et insensible à la casse", () => {
  const l = log("Paused", { account: ALICE }, { txHash: "0xABCD", logIndex: 7 });
  assert.equal(classify(l)!.id, "ethereum:0xabcd:7");
});

test("durées lisibles", () => {
  assert.equal(formatDuration(600n), "10 min");
  assert.equal(formatDuration(7200n), "2 h");
  assert.equal(formatDuration(604_800n), "7 jours");
});

test("appel sans données", () => {
  assert.equal(describeCall("0x").category, "scheduled");
});

test("message : lien d'explorateur, raison de l'envoi et avertissement légal", () => {
  const a = classify(log("Upgraded", { implementation: BOB }, { chain: "base" }))!;
  const text = formatAlert(a, { label: "Mon portefeuille", address: ALICE });
  assert.match(text, /https:\/\/basescan\.org\/tx\/0x/);
  assert.match(text, /Mon portefeuille \(0x1111…1111\)/);
  assert.ok(text.endsWith(DISCLAIMER));
  assert.doesNotMatch(text, /retire|vend|achète|conseill/i); // aucun conseil
});
