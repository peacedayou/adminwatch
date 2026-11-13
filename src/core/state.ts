/**
 * État persistant : dernier bloc traité par chaîne, alertes déjà envoyées et
 * envois en attente. Un simple fichier JSON écrit de façon atomique suffit pour
 * un service mono-instance.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ChainName } from "./types.ts";

export interface PendingMessage {
  key: string;
  chatId: string;
  text: string;
  attempts: number;
}

export interface State {
  lastBlock: Partial<Record<ChainName, bigint>>;
  /** Clés « idAlerte|chatId » déjà envoyées, les plus récentes à la fin. */
  sent: string[];
  pending: PendingMessage[];
}

export const MAX_SENT = 5000;
export const MAX_PENDING = 500;
export const MAX_ATTEMPTS = 10;

export function emptyState(): State {
  return { lastBlock: {}, sent: [], pending: [] };
}

export function markSent(state: State, key: string): void {
  state.sent.push(key);
  if (state.sent.length > MAX_SENT) state.sent.splice(0, state.sent.length - MAX_SENT);
}

export function serialize(state: State): string {
  const lastBlock = Object.fromEntries(Object.entries(state.lastBlock).map(([k, v]) => [k, v!.toString()]));
  return JSON.stringify({ version: 1, lastBlock, sent: state.sent, pending: state.pending }, null, 2);
}

export function deserialize(text: string): State {
  const raw = JSON.parse(text) as { version?: number; lastBlock?: Record<string, string>; sent?: string[]; pending?: PendingMessage[] };
  if (raw.version !== 1) throw new Error("Version d'état inconnue");
  const lastBlock: State["lastBlock"] = {};
  for (const [k, v] of Object.entries(raw.lastBlock ?? {})) lastBlock[k as ChainName] = BigInt(v);
  return { lastBlock, sent: raw.sent ?? [], pending: raw.pending ?? [] };
}

export class FileStateStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<State> {
    try {
      return deserialize(await readFile(this.path, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw err;
    }
  }

  async save(state: State): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, serialize(state), { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
