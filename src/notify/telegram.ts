import type { Notifier } from "../core/engine.ts";

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Envoi par l'API Bot de Telegram (sendMessage), en texte brut. */
export class TelegramNotifier implements Notifier {
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async send(chatId: string, text: string): Promise<void> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Le jeton fait partie de l'URL : on ne l'écrit jamais dans les erreurs.
      throw new Error(`Telegram a répondu ${res.status}`);
    }
  }
}

/** Affiche les alertes dans la console au lieu de les envoyer (mode --dry-run). */
export class ConsoleNotifier implements Notifier {
  async send(chatId: string, text: string): Promise<void> {
    console.log(`\n--- vers ${chatId} ---\n${text}`);
  }
}
