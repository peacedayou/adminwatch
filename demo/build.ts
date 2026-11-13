/**
 * Génère la page de démonstration (GitHub Pages) à partir du vrai code de
 * classification et de formatage, appliqué à des événements d'exemple.
 * Les adresses et transactions sont fictives : les liens d'explorateur sont donc retirés.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { classify } from "../src/core/classify.ts";
import { CATEGORY_LABELS, formatAlert } from "../src/core/format.ts";
import { keccakHex, selector } from "../src/core/keccak.ts";
import type { AdminAlert, DecodedLog } from "../src/core/types.ts";

const A = (n: number) => `0x${n.toString(16).repeat(40).slice(0, 40)}` as const;
let i = 0;
function ex(eventName: string, args: Record<string, unknown>, contract: string, chain: DecodedLog["chain"] = "ethereum"): DecodedLog {
  i++;
  return {
    chain, protocol: "Aave V3", contract: { address: A(10 + i), label: contract }, eventName, args,
    txHash: `0x${i.toString(16).padStart(64, "0")}`, blockNumber: 21_500_000n + BigInt(i * 37), logIndex: i,
  };
}

const examples: DecodedLog[] = [
  ex("CallScheduled", {
    id: keccakHex("exemple"), index: 0n, target: A(3), value: 0n,
    data: `${selector("upgradeToAndCall(address,bytes)")}${"0".repeat(64)}`, predecessor: `0x${"0".repeat(64)}`, delay: 86_400n,
  }, "Timelock"),
  ex("Upgraded", { implementation: A(4) }, "Pool"),
  ex("RoleGranted", { role: keccakHex("EMERGENCY_ADMIN"), account: A(5), sender: A(6) }, "ACLManager", "arbitrum"),
  ex("ReservePaused", { asset: A(7), paused: true }, "PoolConfigurator", "base"),
  ex("AssetSourceUpdated", { asset: A(8), source: A(9) }, "AaveOracle", "optimism"),
  ex("Unpaused", { account: A(6) }, "Pool", "polygon"),
];

const alerts = examples.map(classify).filter((a): a is AdminAlert => a !== null);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cards = alerts
  .map((a) => {
    const text = formatAlert(a, { label: "Mon portefeuille", address: A(1) }).replace(/^Transaction : .*$/m, "Transaction : (fictive dans cette démo)");
    return `<article class="msg" data-sev="${a.severity}"><header><span class="tag ${a.severity}">${a.severity}</span><span class="cat">${esc(CATEGORY_LABELS[a.category])}</span></header><pre>${esc(text)}</pre></article>`;
  })
  .join("\n");

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AdminWatch – démonstration</title>
<style>
  :root { --bg:#0f1419; --panel:#182029; --ink:#e7edf3; --mute:#8b98a5; --line:#26313d; --crit:#ff6b6b; --warn:#f5b041; --info:#5dade2; --accent:#7ee2b8; }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--ink); }
  main { max-width: 980px; margin: 0 auto; padding: 48px 20px 80px; }
  h1 { font-size: 2.2rem; margin: 0 0 .25rem; letter-spacing: -.02em; }
  h1 span { color: var(--accent); }
  .lead { color: var(--mute); max-width: 680px; margin: 0 0 2rem; }
  .note { border-left: 3px solid var(--warn); padding: .5rem 1rem; background: var(--panel); color: var(--mute); margin: 1.5rem 0; font-size: .92rem; }
  .steps { display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin: 2rem 0; }
  .steps div { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px; font-size: .92rem; }
  .steps b { display:block; color: var(--accent); margin-bottom: 4px; }
  .filters { display:flex; gap:8px; align-items:center; margin: 2rem 0 1rem; flex-wrap: wrap; color: var(--mute); }
  .filters button { background: var(--panel); color: var(--ink); border:1px solid var(--line); border-radius: 999px; padding: 6px 14px; cursor:pointer; font: inherit; font-size:.9rem; }
  .filters button[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
  .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
  .msg { background: var(--panel); border:1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
  .msg[hidden] { display:none; }
  .msg header { display:flex; gap:8px; align-items:center; margin-bottom: 6px; font-size: .8rem; }
  .tag { text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
  .tag.critical { color: var(--crit); } .tag.warning { color: var(--warn); } .tag.info { color: var(--info); }
  .cat { color: var(--mute); }
  pre { margin:0; white-space: pre-wrap; overflow-wrap: anywhere; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  footer { margin-top: 3rem; color: var(--mute); font-size: .88rem; }
  a { color: var(--accent); }
  @media (max-width: 520px) { .grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <h1>Admin<span>Watch</span></h1>
  <p class="lead">Alertes Telegram en français quand un protocole DeFi où votre adresse a une position planifie une mise à jour, change un rôle, se met en pause ou change d'oracle. Lecture seule : aucune clé privée, aucune transaction.</p>
  <div class="steps">
    <div><b>1. Positions</b>AdminWatch vérifie sur la chaîne dans quels protocoles chaque adresse a une position (Aave V3 par défaut, d'autres par configuration).</div>
    <div><b>2. Événements</b>Il lit seulement les événements d'administration de ces protocoles : timelocks, mandataires, rôles, pause, oracles.</div>
    <div><b>3. Alertes</b>Chaque action est classée par gravité et envoyée une seule fois à chaque adresse concernée, avec le lien de la transaction.</div>
  </div>
  <p class="note">Les messages ci-dessous sont produits par le code réel d'AdminWatch à partir d'événements d'exemple. Les adresses et transactions sont fictives.</p>
  <div class="filters" role="group" aria-label="Gravité minimale">Gravité minimale :
    <button data-min="0" aria-pressed="false">info</button>
    <button data-min="1" aria-pressed="true">warning (défaut)</button>
    <button data-min="2" aria-pressed="false">critical</button>
  </div>
  <section class="grid">
${cards}
  </section>
  <footer>Code source et instructions : <a href="https://github.com/peacedayou/adminwatch">github.com/peacedayou/adminwatch</a>. Faits observés sur la chaîne, aucun conseil financier.</footer>
</main>
<script>
  const rank = { info: 0, warning: 1, critical: 2 };
  const buttons = document.querySelectorAll(".filters button");
  function apply(min) {
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.min === String(min))));
    document.querySelectorAll(".msg").forEach((m) => { m.hidden = rank[m.dataset.sev] < min; });
  }
  buttons.forEach((b) => b.addEventListener("click", () => apply(Number(b.dataset.min))));
  apply(1);
</script>
</body>
</html>
`;

const out = process.argv[2] ?? "_site";
await mkdir(out, { recursive: true });
await writeFile(`${out}/index.html`, html);
console.log(`Démo écrite dans ${out}/index.html (${alerts.length} alertes)`);
