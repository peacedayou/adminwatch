import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigError, parseConfig } from "../src/core/config.ts";
import { FileStateStore, MAX_SENT, deserialize, emptyState, markSent, serialize } from "../src/core/state.ts";
import { TelegramNotifier } from "../src/notify/telegram.ts";
import { ALICE } from "./helpers.ts";

const TOKEN = "123456:ABCdefGHIjklMNOpqrSTUvwxYZ_123";
const env = { ETH_RPC: "https://rpc.example.com", TELEGRAM_BOT_TOKEN: TOKEN };
const base = {
  chains: { ethereum: { rpcUrl: "${ETH_RPC}" } },
  watchers: [{ address: ALICE.toUpperCase().replace("0X", "0x"), telegramChatId: "-100123", label: "Coffre" }],
};

test("configuration valide : variables substituées, adresses en minuscules, valeurs par défaut", () => {
  const c = parseConfig(base, env);
  assert.equal(c.chains.ethereum!.rpcUrl, "https://rpc.example.com");
  assert.equal(c.watchers[0]!.address, ALICE);
  assert.equal(c.telegramBotToken, TOKEN);
  assert.equal(c.minSeverity, "warning");
  assert.equal(c.aaveV3, true);
});

test("variable d'environnement manquante", () => {
  assert.throws(() => parseConfig(base, { TELEGRAM_BOT_TOKEN: TOKEN }), /ETH_RPC/);
});

test("erreurs de configuration explicites", () => {
  assert.throws(() => parseConfig({ ...base, watchers: [{ address: "0x123", telegramChatId: "1" }] }, env), ConfigError);
  assert.throws(() => parseConfig({ ...base, chains: { solana: { rpcUrl: "https://x" } } }, env), /chaîne inconnue/);
  assert.throws(() => parseConfig({ ...base, chains: { ethereum: { rpcUrl: "file:///etc/passwd" } } }, env), /http/);
  assert.throws(() => parseConfig({ ...base, pollSeconds: 1 }, env), /pollSeconds/);
  assert.throws(() => parseConfig(base, { ...env, TELEGRAM_BOT_TOKEN: "abc" }), /Telegram/);
  assert.throws(
    () => parseConfig({ ...base, customProtocols: [{ name: "X", chain: "base", contracts: [{ address: ALICE }] }] }, env),
    /pas d'URL RPC/,
  );
});

test("protocole personnalisé", () => {
  const c = parseConfig({ ...base, customProtocols: [{ name: "Coffre X", chain: "ethereum", contracts: [{ address: ALICE, label: "Vault" }], positionTokens: [ALICE] }] }, env);
  assert.deepEqual(c.customProtocols[0]!.contracts, [{ address: ALICE, label: "Vault" }]);
});

test("état : aller-retour avec bigint", () => {
  const s = emptyState();
  s.lastBlock.ethereum = 21_000_000n;
  markSent(s, "a|1");
  const back = deserialize(serialize(s));
  assert.equal(back.lastBlock.ethereum, 21_000_000n);
  assert.deepEqual(back.sent, ["a|1"]);
});

test("état : la liste des envois reste bornée", () => {
  const s = emptyState();
  for (let i = 0; i < MAX_SENT + 10; i++) markSent(s, String(i));
  assert.equal(s.sent.length, MAX_SENT);
  assert.equal(s.sent[0], "10");
});

test("FileStateStore : fichier absent puis écriture atomique en 0600", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aw-"));
  const store = new FileStateStore(join(dir, "sub", "state.json"));
  const s = await store.load();
  s.lastBlock.base = 5n;
  await store.save(s);
  assert.equal((await store.load()).lastBlock.base, 5n);
  assert.equal((await stat(join(dir, "sub", "state.json"))).mode & 0o777, 0o600);
  assert.match(await readFile(join(dir, "sub", "state.json"), "utf8"), /"version": 1/);
});

test("Telegram : requête correcte et jeton absent des erreurs", async () => {
  const calls: { url: string; body: string }[] = [];
  const ok = new TelegramNotifier(TOKEN, async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, status: 200, text: async () => "" }; });
  await ok.send("-100123", "bonjour");
  assert.equal(calls[0]!.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(JSON.parse(calls[0]!.body), { chat_id: "-100123", text: "bonjour", disable_web_page_preview: true });

  const ko = new TelegramNotifier(TOKEN, async () => ({ ok: false, status: 429, text: async () => "" }));
  await assert.rejects(ko.send("1", "x"), (err: Error) => err.message.includes("429") && !err.message.includes(TOKEN));
});

test("config.example.json est valide", async () => {
  const raw = JSON.parse(await readFile(new URL("../config.example.json", import.meta.url), "utf8"));
  const c = parseConfig(raw, { ETHEREUM_RPC_URL: "https://a.example", BASE_RPC_URL: "https://b.example", TELEGRAM_BOT_TOKEN: TOKEN });
  assert.equal(c.watchers.length, 1);
  assert.equal(c.customProtocols[0]!.contracts.length, 2);
});
