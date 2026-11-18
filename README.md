> **⚠️ Projet éducatif — portfolio étudiant.** Ce dépôt n'est ni un produit ni un service commercial : aucune vente, aucun abonnement, aucun déploiement en production. À ne pas exécuter avec des fonds ou des données réels.

# AdminWatch

[![CI](https://github.com/peacedayou/adminwatch/actions/workflows/ci.yml/badge.svg)](https://github.com/peacedayou/adminwatch/actions/workflows/ci.yml)
[![Démo](https://github.com/peacedayou/adminwatch/actions/workflows/pages.yml/badge.svg)](https://peacedayou.github.io/adminwatch/)

Alertes **Telegram**, en français, quand un protocole DeFi où **votre adresse a une position**
planifie une mise à jour, change un rôle, se met en pause ou modifie un oracle.

Les déposants apprennent souvent ces changements une fois qu'il est trop tard pour réagir.
Les plateformes de surveillance existantes visent les entreprises ; AdminWatch vise les
particuliers : il détecte lui-même vos positions et ne vous parle que des protocoles qui vous concernent.

**Démo :** <https://peacedayou.github.io/adminwatch/> (messages produits par le vrai code à partir d'événements d'exemple).

> AdminWatch **lit** la blockchain, rien de plus. Il ne demande jamais de clé privée, n'envoie
> aucune transaction et ne peut pas toucher aux fonds. Les alertes décrivent des faits observés
> sur la chaîne ; ce ne sont pas des conseils financiers.

## Ça vous intéresse ?

**Pour qui :** Particuliers et petits fonds qui ont des positions sur Aave, Compound ou d'autres protocoles DeFi et veulent être prévenus avant un changement d'administration.

**Essayez la démo :** <https://peacedayou.github.io/adminwatch/>

- ⭐ Ajoutez une étoile ou suivez le dépôt (**Watch**) pour être prévenu des nouvelles versions.
- 📝 Dites-moi votre besoin : [ouvrez une fiche « Je suis intéressé »](https://github.com/peacedayou/adminwatch/issues/new?template=interet.yml).
  Cela m'aide à choisir les prochaines fonctions. Aucune vente ni aucun engagement : c'est une simple liste d'intérêt.
- 💬 Une question ou une idée ? Ouvrez une *issue* ; je réponds en français ou en anglais.

## Comment ça marche

```
          ┌────────────── toutes les 60 s, par chaîne ──────────────┐
adresses ─▶ 1. positions ─▶ 2. événements d'administration ─▶ 3. classement ─▶ Telegram
           (eth_call)       (eth_getLogs filtré par sujets)    (gravité, doublons)
```

1. **Positions.** Pour chaque protocole connu, AdminWatch vérifie si l'adresse y a une position :
   `getUserAccountData` pour Aave V3 (comme [LiquiGuard](https://github.com/peacedayou/liquiguard)),
   `balanceOf` sur des jetons de reçu pour les protocoles ajoutés par configuration.
   Le résultat est gardé en cache 10 minutes.
2. **Événements.** Seuls les contrats d'administration des protocoles où une adresse a une position
   sont lus, et seulement pour les événements du catalogue ci-dessous (filtre `topic0` côté nœud).
   La plage s'arrête à `bloc courant − confirmations` pour limiter l'effet des réorganisations.
3. **Alertes.** Chaque événement devient un message factuel avec sa gravité, le contrat, les
   adresses en jeu et le lien vers la transaction. Il est envoyé une seule fois par destinataire,
   même si la plage est relue. Un envoi qui échoue est réessayé aux cycles suivants.

### Événements surveillés

| Catégorie | Événements | Gravité |
| --- | --- | --- |
| Opération planifiée | `CallScheduled` (TimelockController OpenZeppelin), `QueueTransaction` (timelock de type Compound). L'appel planifié est décodé : mise à jour, rôle, propriété, pause, oracle… | critique si l'appel est une mise à jour, une attribution de rôle ou une pause ; sinon avertissement |
| Mise à jour | `Upgraded`, `BeaconUpgraded` (ERC-1967), `PoolUpdated`, `PoolConfiguratorUpdated` (Aave) | critique |
| Rôles et permissions | `RoleGranted`, `RoleRevoked`, `RoleAdminChanged`, `AdminChanged`, `ACLManagerUpdated`, `MinDelayChange`, `NewDelay` | critique pour les rôles puissants (`POOL_ADMIN`, `EMERGENCY_ADMIN`, `DEFAULT_ADMIN_ROLE`…), sinon avertissement |
| Pause | `Paused`, `ReservePaused(asset, true)` / `Unpaused`, `ReservePaused(asset, false)` | critique / info |
| Oracle | `PriceOracleUpdated`, `AssetSourceUpdated` (Aave) | critique / avertissement |
| Propriété | `OwnershipTransferred` (sauf depuis l'adresse nulle, qui marque le déploiement) | critique |

Les noms de rôles et les sélecteurs de fonctions sont calculés au démarrage avec un Keccak-256
écrit en TypeScript ([src/core/keccak.ts](src/core/keccak.ts)), testé contre des vecteurs de référence.

### Protocoles

- **Aave V3** sur Ethereum, Arbitrum, Optimism, Polygon et Base, activé par défaut. Seule l'adresse
  du Pool est codée en dur ; `PoolAddressesProvider`, `PoolConfigurator`, `ACLManager` et `AaveOracle`
  sont découverts sur la chaîne et rafraîchis toutes les heures.
- **Tout autre protocole** par configuration (`customProtocols`) : liste des contrats d'administration
  (mandataire, timelock, gestionnaire de rôles…) et, facultatif, des jetons de reçu qui signalent une position.
  C'est aussi la façon d'ajouter les contrats de gouvernance d'Aave (exécuteurs, timelocks).

## Installation

Il faut Node.js 22.18 ou plus récent : il exécute le TypeScript directement, sans compilation.

```bash
git clone https://github.com/peacedayou/adminwatch && cd adminwatch
npm install
cp config.example.json config.json   # vos adresses et identifiants Telegram
cp .env.example .env                 # jeton du robot et URL RPC
```

1. Créez un robot avec [@BotFather](https://t.me/BotFather) et copiez son jeton dans `TELEGRAM_BOT_TOKEN`.
2. Écrivez au robot, puis récupérez votre identifiant de conversation (`telegramChatId`).
3. Ajoutez une URL RPC par chaîne surveillée.

### Configuration

| Clé | Rôle | Défaut |
| --- | --- | --- |
| `chains.<chaîne>.rpcUrl` | URL RPC ; `${VAR}` est remplacé par la variable d'environnement | obligatoire |
| `watchers[]` | `address`, `label`, `telegramChatId` | obligatoire |
| `aaveV3` | surveiller Aave V3 | `true` |
| `customProtocols[]` | `name`, `chain`, `contracts[]`, `positionTokens[]` | `[]` |
| `minSeverity` | `info`, `warning` ou `critical` | `warning` |
| `pollSeconds` | intervalle entre deux cycles | `60` |
| `confirmations` | blocs d'attente avant lecture | `3` |
| `maxBlocksPerCycle` | taille maximale d'une plage lue | `2000` |
| `statePath` | fichier d'état (dernier bloc, alertes envoyées) | `data/state.json` |

## Utilisation

```bash
# Surveillance continue
node --env-file=.env src/cli.ts run --config config.json

# Un seul cycle, alertes affichées au lieu d'être envoyées
node --env-file=.env src/cli.ts run --config config.json --dry-run --once

# Rejouer l'historique d'Aave V3 sur une plage de blocs (sans filtre de position)
node src/cli.ts scan --chain ethereum --rpc https://… --from 21000000 --to 21010000

# Dans quels protocoles cette adresse a-t-elle une position ?
node src/cli.ts positions --chain base --rpc https://… --address 0x…
```

### Avec Docker

L'image est publiée sur GitHub Container Registry à chaque fusion dans `main`.

```bash
docker compose up -d     # lit ./config.json et ./.env
docker compose logs -f
```

Le conteneur tourne sans privilèges (`USER node`, système de fichiers en lecture seule,
`cap_drop: ALL`) ; seul le volume `/data` est inscriptible.

## Sécurité

| Risque | Protection |
| --- | --- |
| Vol de fonds | Lecture seule (`eth_blockNumber`, `eth_call`, `eth_getLogs`) ; aucune clé privée |
| Fuite du jeton Telegram | Lu dans l'environnement, jamais écrit dans les journaux ni dans les messages d'erreur (test dédié) |
| Injection dans les messages | Texte brut, sans mode Markdown ni HTML |
| Alertes en double ou perdues | Identifiant stable `chaîne:transaction:index`, curseur avancé seulement après une lecture réussie, file de réessai bornée |
| Réorganisations | Confirmations configurables avant lecture |
| Fournisseur RPC limité | Plage d'`eth_getLogs` coupée en deux automatiquement en cas de refus |
| Journaux mal formés | `strict: true` : un journal qui ne correspond pas exactement à l'ABI est ignoré |
| Dépendances vulnérables | `npm audit` à chaque commit ; une seule dépendance de production (viem) |

## Développement

```bash
npm test            # tests unitaires (node:test), sans réseau
npm run typecheck   # TypeScript strict
npm run demo        # régénère la page de démonstration dans _site/
```

```
src/core/     cœur sans dépendance : classement, formatage, moteur, état, configuration, Keccak
src/chain/    accès à la chaîne avec viem (Aave V3 et protocoles personnalisés)
src/notify/   envoi Telegram
test/         tests du cœur avec de faux ports (chaîne, Telegram)
demo/         génération de la page GitHub Pages
```

Le moteur ne connaît pas viem : il reçoit des « ports » (chaîne, protocoles, notificateur).
Les tests remplacent ces ports par des faux et couvrent le premier démarrage, le filtrage
par position, les doublons, la gravité minimale, les plages bornées, les pannes RPC,
les réessais Telegram et le cache des positions.

## Limites connues

- Les positions sont détectées par protocole connu ; un protocole absent de la configuration n'est pas surveillé.
- Une opération planifiée dont la fonction n'est pas reconnue est signalée avec son sélecteur brut.
- Les adresses sont affichées telles quelles ; les noms d'actifs ne sont pas résolus.
- Le service est mono-instance (état dans un fichier JSON).

## Avertissement

AdminWatch rapporte des faits observés sur la blockchain. Il ne dit pas quoi faire de vos fonds
et ne constitue pas un conseil financier. Vérifiez toujours la transaction sur l'explorateur.

## Licence

MIT
