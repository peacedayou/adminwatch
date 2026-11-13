#!/usr/bin/env node
/**
 * adminwatch run       --config config.json [--dry-run] [--once]
 * adminwatch scan      --chain ethereum --rpc URL --from N [--to N]
 * adminwatch positions --chain ethereum --rpc URL --address 0x...
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { classify } from "./core/classify.ts";
import { ConfigError, normalizeAddress, parseConfig } from "./core/config.ts";
import { Engine, type Logger } from "./core/engine.ts";
import { formatAlert } from "./core/format.ts";
import { FileStateStore } from "./core/state.ts";
import { CHAIN_NAMES, type ChainName } from "./core/types.ts";
import { ViemChainPort } from "./chain/viem-port.ts";
import { ConsoleNotifier, TelegramNotifier } from "./notify/telegram.ts";

const logger: Logger = {
  info: (m) => console.log(`${new Date().toISOString()} INFO ${m}`),
  warn: (m) => console.warn(`${new Date().toISOString()} WARN ${m}`),
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

function chainArg(v: string | undefined): ChainName {
  if (!v || !CHAIN_NAMES.includes(v as ChainName)) throw new ConfigError(`--chain : ${CHAIN_NAMES.join(", ")}`);
  return v as ChainName;
}

async function run(args: string[]) {
  const { values } = parseArgs({ args, options: { config: { type: "string", default: "config.json" }, "dry-run": { type: "boolean" }, once: { type: "boolean" } } });
  const env = values["dry-run"] ? { TELEGRAM_BOT_TOKEN: "0:dry-run-xxxxxxxxxxxxxxxxxxxx", ...process.env } : process.env;
  const config = parseConfig(JSON.parse(await readFile(values.config!, "utf8")), env);
  const ports = Object.entries(config.chains).map(([chain, c]) => new ViemChainPort(chain as ChainName, c!.rpcUrl, { aaveV3: config.aaveV3, custom: config.customProtocols }));
  const notifier = values["dry-run"] ? new ConsoleNotifier() : new TelegramNotifier(config.telegramBotToken);
  const engine = new Engine(ports, config.watchers, notifier, { confirmations: config.confirmations, maxBlocksPerCycle: config.maxBlocksPerCycle, minSeverity: config.minSeverity }, logger);
  const store = new FileStateStore(config.statePath);
  const state = await store.load();

  const stop = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => stop.abort());
  logger.info(`AdminWatch démarré : ${config.watchers.length} adresse(s), chaînes ${Object.keys(config.chains).join(", ")}`);

  while (!stop.signal.aborted) {
    await engine.runCycle(state);
    await store.save(state);
    if (values.once) break;
    await sleep(config.pollSeconds * 1000, stop.signal);
  }
  logger.info("Arrêt propre.");
}

async function scan(args: string[]) {
  const { values } = parseArgs({ args, options: { chain: { type: "string" }, rpc: { type: "string" }, from: { type: "string" }, to: { type: "string" } } });
  if (!values.rpc || !values.from) throw new ConfigError("--rpc et --from sont obligatoires");
  const port = new ViemChainPort(chainArg(values.chain), values.rpc, { aaveV3: true, custom: [] });
  const to = values.to ? BigInt(values.to) : await port.head();
  let count = 0;
  for (const protocol of await port.protocols()) {
    for (const log of await port.scan(protocol, BigInt(values.from), to)) {
      const alert = classify(log);
      if (alert) { count++; console.log(`\n${formatAlert(alert)}`); }
    }
  }
  console.log(`\n${count} action(s) privilégiée(s) entre les blocs ${values.from} et ${to}.`);
}

async function positions(args: string[]) {
  const { values } = parseArgs({ args, options: { chain: { type: "string" }, rpc: { type: "string" }, address: { type: "string" } } });
  if (!values.rpc) throw new ConfigError("--rpc est obligatoire");
  const address = normalizeAddress(values.address, "--address");
  const port = new ViemChainPort(chainArg(values.chain), values.rpc, { aaveV3: true, custom: [] });
  for (const p of await port.protocols()) console.log(`${p.name} : ${(await p.hasPosition(address)) ? "position détectée" : "aucune position"}`);
}

const [command, ...rest] = process.argv.slice(2);
const commands: Record<string, (a: string[]) => Promise<void>> = { run, scan, positions };
const fn = commands[command ?? ""];
if (!fn) {
  console.error("Usage : adminwatch <run|scan|positions> [options]  (voir README)");
  process.exit(2);
}
fn(rest).catch((err) => {
  console.error(err instanceof ConfigError ? `Configuration : ${err.message}` : err);
  process.exit(1);
});
