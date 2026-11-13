import assert from "node:assert/strict";
import { test } from "node:test";
import { Engine, type ChainPort, type Notifier, type ProtocolPort } from "../src/core/engine.ts";
import { emptyState } from "../src/core/state.ts";
import type { Address, DecodedLog, Watcher } from "../src/core/types.ts";
import { ALICE, BOB, log } from "./helpers.ts";

const watchers: Watcher[] = [
  { address: ALICE, label: "Alice", telegramChatId: "1" },
  { address: BOB, label: "Bob", telegramChatId: "2" },
];

class FakeNotifier implements Notifier {
  sent: { chatId: string; text: string }[] = [];
  failNext = 0;
  async send(chatId: string, text: string) {
    if (this.failNext > 0) { this.failNext--; throw new Error("Telegram indisponible"); }
    this.sent.push({ chatId, text });
  }
}

function protocol(name: string, holders: Address[]): ProtocolPort & { checks: number } {
  const p = {
    name, chain: "ethereum" as const, contracts: [], checks: 0,
    async hasPosition(user: Address) { p.checks++; return holders.includes(user); },
  };
  return p;
}

class FakeChain implements ChainPort {
  chain = "ethereum" as const;
  scans: { protocol: string; from: bigint; to: bigint }[] = [];
  failHead = false;
  headBlock: bigint;
  list: ProtocolPort[];
  logs: Record<string, DecodedLog[]>;
  constructor(headBlock: bigint, list: ProtocolPort[], logs: Record<string, DecodedLog[]>) {
    this.headBlock = headBlock;
    this.list = list;
    this.logs = logs;
  }
  async head() { if (this.failHead) throw new Error("RPC en panne"); return this.headBlock; }
  async protocols() { return this.list; }
  async scan(p: ProtocolPort, from: bigint, to: bigint) {
    this.scans.push({ protocol: p.name, from, to });
    return (this.logs[p.name] ?? []).filter((l) => l.blockNumber >= from && l.blockNumber <= to);
  }
}

const opts = { confirmations: 2, maxBlocksPerCycle: 1000, minSeverity: "warning" as const };

test("premier démarrage : part du bloc sûr courant, sans relire l'historique", async () => {
  const chain = new FakeChain(1000n, [protocol("Aave V3", [ALICE])], {});
  const state = emptyState();
  await new Engine([chain], watchers, new FakeNotifier(), opts).runCycle(state);
  assert.equal(state.lastBlock.ethereum, 998n);
  assert.equal(chain.scans.length, 0);
});

test("alerte envoyée seulement aux adresses qui ont une position", async () => {
  const aave = protocol("Aave V3", [ALICE]);
  const other = protocol("Autre", []);
  const chain = new FakeChain(1010n, [aave, other], {
    "Aave V3": [log("Upgraded", { implementation: BOB }, { blockNumber: 1005n })],
    Autre: [log("Paused", { account: BOB }, { blockNumber: 1005n })],
  });
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const notifier = new FakeNotifier();
  const [report] = await new Engine([chain], watchers, notifier, opts).runCycle(state);

  assert.deepEqual(notifier.sent.map((s) => s.chatId), ["1"]);
  assert.deepEqual(report!.protocolsWithPositions, ["Aave V3"]);
  assert.deepEqual(chain.scans, [{ protocol: "Aave V3", from: 1001n, to: 1008n }]); // « Autre » n'est pas lu
  assert.equal(state.lastBlock.ethereum, 1008n);
});

test("pas de doublon d'un cycle à l'autre, même si la plage est relue", async () => {
  const l = log("Upgraded", { implementation: BOB }, { blockNumber: 1005n });
  const chain = new FakeChain(1010n, [protocol("Aave V3", [ALICE, BOB])], { "Aave V3": [l] });
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const notifier = new FakeNotifier();
  const engine = new Engine([chain], watchers, notifier, opts);
  await engine.runCycle(state);
  state.lastBlock.ethereum = 1000n; // réorganisation simulée : on relit
  await engine.runCycle(state);
  assert.equal(notifier.sent.length, 2); // une fois pour Alice, une fois pour Bob
});

test("filtre de gravité minimale", async () => {
  const chain = new FakeChain(1010n, [protocol("Aave V3", [ALICE])], {
    "Aave V3": [log("Unpaused", { account: BOB }, { blockNumber: 1003n }), log("Paused", { account: BOB }, { blockNumber: 1004n })],
  });
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const notifier = new FakeNotifier();
  await new Engine([chain], watchers, notifier, opts).runCycle(state);
  assert.equal(notifier.sent.length, 1);
  assert.match(notifier.sent[0]!.text, /Contrat mis en pause/);
});

test("plage bornée par maxBlocksPerCycle", async () => {
  const chain = new FakeChain(10_000n, [protocol("Aave V3", [ALICE])], {});
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  await new Engine([chain], watchers, new FakeNotifier(), { ...opts, maxBlocksPerCycle: 500 }).runCycle(state);
  assert.deepEqual(chain.scans[0], { protocol: "Aave V3", from: 1001n, to: 1500n });
  assert.equal(state.lastBlock.ethereum, 1500n);
});

test("RPC en panne : le curseur ne bouge pas et l'erreur est signalée", async () => {
  const chain = new FakeChain(1010n, [protocol("Aave V3", [ALICE])], {});
  chain.failHead = true;
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const [report] = await new Engine([chain], watchers, new FakeNotifier(), opts).runCycle(state);
  assert.equal(report!.error, "RPC en panne");
  assert.equal(state.lastBlock.ethereum, 1000n);
});

test("envoi en échec : mis en attente puis réessayé au cycle suivant", async () => {
  const chain = new FakeChain(1010n, [protocol("Aave V3", [ALICE])], { "Aave V3": [log("Upgraded", { implementation: BOB }, { blockNumber: 1005n })] });
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const notifier = new FakeNotifier();
  notifier.failNext = 1;
  const engine = new Engine([chain], watchers, notifier, opts);
  await engine.runCycle(state);
  assert.equal(state.pending.length, 1);
  assert.equal(notifier.sent.length, 0);
  await engine.runCycle(state);
  assert.equal(state.pending.length, 0);
  assert.equal(notifier.sent.length, 1);
  assert.equal(state.sent.length, 1);
});

test("positions mises en cache pendant la durée prévue", async () => {
  let now = 0;
  const aave = protocol("Aave V3", [ALICE]);
  const chain = new FakeChain(1010n, [aave], {});
  const state = emptyState();
  state.lastBlock.ethereum = 1000n;
  const engine = new Engine([chain], watchers, new FakeNotifier(), { ...opts, positionTtlMs: 1000, now: () => now });
  await engine.runCycle(state);
  chain.headBlock = 1020n;
  await engine.runCycle(state);
  assert.equal(aave.checks, 2); // 2 adresses, une seule vérification chacune
  now = 2000;
  chain.headBlock = 1030n;
  await engine.runCycle(state);
  assert.equal(aave.checks, 4);
});
