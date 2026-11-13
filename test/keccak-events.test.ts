import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_EVENT_NAMES, ADMIN_EVENT_SIGNATURES, canonicalSignature, topic0 } from "../src/core/events.ts";
import { keccakHex, selector } from "../src/core/keccak.ts";

test("keccak256 : vecteurs de référence", () => {
  assert.equal(keccakHex(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccakHex("Transfer(address,address,uint256)"), "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
});

test("keccak256 : entrée de plusieurs blocs (> 136 octets) stable et différente", () => {
  const a = keccakHex("a".repeat(300));
  assert.equal(a, keccakHex("a".repeat(300)));
  assert.notEqual(a, keccakHex("a".repeat(299)));
  assert.equal(a.length, 66);
});

test("sélecteurs connus", () => {
  assert.equal(selector("transfer(address,uint256)"), "0xa9059cbb");
  assert.equal(selector("getUserAccountData(address)"), "0xbf92857c"); // même valeur que LiquiGuard
  assert.equal(selector("upgradeTo(address)"), "0x3659cfe6");
  assert.equal(selector("upgradeToAndCall(address,bytes)"), "0x4f1ef286");
  assert.equal(selector("grantRole(bytes32,address)"), "0x2f2ff15d");
  assert.equal(selector("pause()"), "0x8456cb59");
});

test("signature canonique : retire indexed et les noms", () => {
  assert.equal(
    canonicalSignature("event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)"),
    "RoleGranted(bytes32,address,address)",
  );
  assert.equal(canonicalSignature("event Paused(address account)"), "Paused(address)");
});

test("topic0 des événements standards", () => {
  const byName = Object.fromEntries(ADMIN_EVENT_SIGNATURES.map((s) => [canonicalSignature(s).split("(")[0], topic0(s)]));
  assert.equal(byName.OwnershipTransferred, "0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0");
  assert.equal(byName.Upgraded, "0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b");
  assert.equal(byName.RoleGranted, "0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d");
  assert.equal(byName.Paused, "0x62e78cea01bee320cd4e420270b5ea74000d11b0c9f74754ebdbfc544b05a258");
});

test("aucun nom d'événement en double dans le catalogue", () => {
  assert.equal(ADMIN_EVENT_NAMES.size, ADMIN_EVENT_SIGNATURES.length);
});
