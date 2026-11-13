/**
 * Cycle de surveillance, indépendant de viem : les accès à la chaîne et à
 * Telegram passent par des « ports » injectés, ce qui rend le moteur testable
 * avec de faux ports.
 *
 * Un cycle, pour chaque chaîne :
 *  1. lire le bloc courant et fixer la plage [dernier traité + 1, courant - confirmations] ;
 *  2. trouver, parmi les protocoles connus, ceux où une adresse surveillée a une position ;
 *  3. lire les événements d'administration de ces protocoles sur la plage ;
 *  4. classer, filtrer par gravité, envoyer une alerte par adresse concernée, sans doublon ;
 *  5. avancer le curseur seulement si la lecture a réussi.
 */
import { classify } from "./classify.ts";
import { formatAlert } from "./format.ts";
import { MAX_ATTEMPTS, MAX_PENDING, markSent, type State } from "./state.ts";
import { SEVERITY_RANK, type AdminAlert, type Address, type ChainName, type DecodedLog, type Severity, type WatchedContract, type Watcher } from "./types.ts";

export interface ProtocolPort {
  name: string;
  chain: ChainName;
  contracts: WatchedContract[];
  hasPosition(user: Address): Promise<boolean>;
}

export interface ChainPort {
  chain: ChainName;
  head(): Promise<bigint>;
  protocols(): Promise<ProtocolPort[]>;
  scan(protocol: ProtocolPort, fromBlock: bigint, toBlock: bigint): Promise<DecodedLog[]>;
}

export interface Notifier {
  send(chatId: string, text: string): Promise<void>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface EngineOptions {
  confirmations: number;
  maxBlocksPerCycle: number;
  minSeverity: Severity;
  /** Durée de validité du cache des positions (ms). */
  positionTtlMs?: number;
  /** Au premier démarrage, nombre de blocs relus en arrière (0 = partir du bloc courant). */
  initialLookback?: number;
  now?: () => number;
}

export interface CycleReport {
  chain: ChainName;
  fromBlock?: bigint;
  toBlock?: bigint;
  protocolsWithPositions: string[];
  alerts: AdminAlert[];
  sent: number;
  error?: string;
}

const silentLogger: Logger = { info() {}, warn() {} };

export class Engine {
  private readonly positionCache = new Map<string, { value: boolean; at: number }>();
  private readonly now: () => number;
  private readonly ports: ChainPort[];
  private readonly watchers: Watcher[];
  private readonly notifier: Notifier;
  private readonly options: EngineOptions;
  private readonly log: Logger;

  constructor(ports: ChainPort[], watchers: Watcher[], notifier: Notifier, options: EngineOptions, log: Logger = silentLogger) {
    this.ports = ports;
    this.watchers = watchers;
    this.notifier = notifier;
    this.options = options;
    this.log = log;
    this.now = options.now ?? Date.now;
  }

  async positionsFor(protocol: ProtocolPort): Promise<Watcher[]> {
    const ttl = this.options.positionTtlMs ?? 10 * 60_000;
    const result: Watcher[] = [];
    for (const w of this.watchers) {
      const key = `${protocol.chain}|${protocol.name}|${w.address}`;
      const cached = this.positionCache.get(key);
      let has: boolean;
      if (cached && this.now() - cached.at < ttl) {
        has = cached.value;
      } else {
        has = await protocol.hasPosition(w.address);
        this.positionCache.set(key, { value: has, at: this.now() });
      }
      if (has) result.push(w);
    }
    return result;
  }

  async runCycle(state: State): Promise<CycleReport[]> {
    await this.flushPending(state);
    const reports: CycleReport[] = [];
    for (const port of this.ports) {
      try {
        reports.push(await this.runChain(port, state));
      } catch (err) {
        // Une chaîne en panne (RPC indisponible) n'empêche pas les autres ; le curseur ne bouge pas.
        const message = err instanceof Error ? err.message : String(err);
        this.log.warn(`[${port.chain}] cycle interrompu : ${message}`);
        reports.push({ chain: port.chain, protocolsWithPositions: [], alerts: [], sent: 0, error: message });
      }
    }
    return reports;
  }

  private async runChain(port: ChainPort, state: State): Promise<CycleReport> {
    const head = await port.head();
    const safeHead = head - BigInt(this.options.confirmations);
    const last = state.lastBlock[port.chain];
    const fromBlock = last === undefined ? safeHead - BigInt(this.options.initialLookback ?? 0) + 1n : last + 1n;
    if (fromBlock > safeHead) {
      if (last === undefined) state.lastBlock[port.chain] = safeHead;
      return { chain: port.chain, protocolsWithPositions: [], alerts: [], sent: 0 };
    }
    const toBlock = fromBlock + BigInt(this.options.maxBlocksPerCycle) - 1n < safeHead ? fromBlock + BigInt(this.options.maxBlocksPerCycle) - 1n : safeHead;

    const report: CycleReport = { chain: port.chain, fromBlock, toBlock, protocolsWithPositions: [], alerts: [], sent: 0 };
    const minRank = SEVERITY_RANK[this.options.minSeverity];

    for (const protocol of await port.protocols()) {
      const holders = await this.positionsFor(protocol);
      if (holders.length === 0) continue;
      report.protocolsWithPositions.push(protocol.name);

      const logs = await port.scan(protocol, fromBlock, toBlock);
      const alerts = logs
        .map(classify)
        .filter((a): a is AdminAlert => a !== null && SEVERITY_RANK[a.severity] >= minRank)
        .sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));

      for (const alert of alerts) {
        report.alerts.push(alert);
        for (const w of holders) {
          const key = `${alert.id}|${w.telegramChatId}`;
          if (state.sent.includes(key) || state.pending.some((p) => p.key === key)) continue;
          const text = formatAlert(alert, w);
          try {
            await this.notifier.send(w.telegramChatId, text);
            markSent(state, key);
            report.sent++;
          } catch (err) {
            this.log.warn(`[${port.chain}] envoi différé (${err instanceof Error ? err.message : err})`);
            if (state.pending.length < MAX_PENDING) state.pending.push({ key, chatId: w.telegramChatId, text, attempts: 1 });
          }
        }
      }
    }

    state.lastBlock[port.chain] = toBlock;
    this.log.info(`[${port.chain}] blocs ${fromBlock}–${toBlock} : ${report.alerts.length} alerte(s), ${report.sent} envoi(s)`);
    return report;
  }

  /** Réessaie les envois qui avaient échoué (Telegram indisponible, limite de débit…). */
  async flushPending(state: State): Promise<void> {
    const remaining = [];
    for (const p of state.pending) {
      try {
        await this.notifier.send(p.chatId, p.text);
        markSent(state, p.key);
      } catch {
        if (p.attempts + 1 < MAX_ATTEMPTS) remaining.push({ ...p, attempts: p.attempts + 1 });
        else this.log.warn(`Alerte abandonnée après ${MAX_ATTEMPTS} essais : ${p.key}`);
      }
    }
    state.pending = remaining;
  }
}
