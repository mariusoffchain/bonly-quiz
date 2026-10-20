# bonly-quiz

Quiz interactif pour B-only 2026 : les équipes sont des pools de minage fictives, leur
hashrate (en TH/s) grandit avec les bonnes réponses et leur rapidité, et chaque nouveau bloc
réel du réseau Bitcoin déclenche un tirage de bonus pondéré par les parts de hashrate.
Direction visuelle inspirée du tableau de bord de minage de mempool.space (voir `NOTICE.md`).

Le besoin et les décisions sont décrits dans la note Obsidian « B-only 2026, descriptif du
quiz interactif ». La documentation de reconstruction est dans « B-only 2026, quiz interactif,
fiche de reconstruction de l'application ».

## Démarrage rapide

Prérequis : Node 24 (testé avec 24.18), npm.

```bash
npm install
npm run import:planb      # optionnel, régénère le pack Plan B depuis le dépôt cloné
npm run dev               # serveur 8787 + client Vite 5173, avec rechargement
```

Le terminal affiche le jeton de la console, l'URL de la console, du board et le lien à
scanner. En développement les téléphones ouvrent le port 5173 (Vite relaie l'API et le
WebSocket vers 8787).

Version « production locale » sur un seul port :

```bash
npm run build
npm start                 # http://<ip-du-mac>:8787
```

Interfaces :

| Route | Rôle |
|---|---|
| `/play?s=CODE` | téléphone des participants (QR code affiché sur le board et la console) |
| `/board` | écran de présentation |
| `/console` | console d'animation, protégée par le jeton |

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8787` | port HTTP + WebSocket du serveur |
| `HOST` | `0.0.0.0` | interface d'écoute |
| `CONSOLE_TOKEN` | généré dans `data/console-token.txt` | jeton de la console |
| `PUBLIC_URL` | 1re IP LAN détectée | base des liens à scanner, ex. `http://192.168.1.20:8787` |
| `DATA_DIR` | `./data` | instantanés et journaux des sessions |
| `CONTENT_DIR` | `./content/questions` | packs de questions |
| `BLOCK_SOURCE` | `real` | `real` connecte mempool.space au démarrage, `off` attend la console |
| `MEMPOOL_URL` | `https://mempool.space` | instance mempool (une instance auto-hébergée fonctionne) |

## Tests

```bash
npm test                        # moteur, intégration WebSocket multi-clients, flux réel
QUIZ_SKIP_NETWORK=1 npm test    # sans le test de connexion à mempool.space
```

Les tests d'intégration utilisent des blocs **simulés**, étiquetés comme tels. Le test
`blocks-real` vérifie seulement la connexion et l'historique du flux réel, pas la réception
d'un nouveau bloc.

## Architecture

```
src/shared/     moteur pur (TypeScript, partagé serveur/client/tests)
  hashrate.ts   nano-TH/s en BigInt, pourcentages exacts, arrondi demi-supérieur
  config.ts     réglages de session et barème de rapidité
  scoring.ts    classement de rapidité et gains
  draw.ts       tirage pondéré (crypto), séries de lots avec exclusion
  game.ts       machine à états faisant autorité (manches, questions, réponses, blocs, lots)
  views.ts      vues filtrées par rôle (la bonne réponse n'est envoyée qu'après la clôture)
src/server/     Node : HTTP + WebSocket, persistance, flux de blocs
  app.ts        hub WebSocket, commandes console, timers de clôture
  blocks.ts     MempoolBlockSource (WS + REST) et SimulatedBlockSource
  store.ts      instantané JSON + journal JSONL par session
  content.ts    chargement et validation des packs
src/client/     React + Vite, routes /play /board /console
content/questions/  packs JSON (Plan B btc101 provisoire, démo)
scripts/import-planb.mjs  import depuis le dépôt Plan B Network
tests/          vitest
```

Le serveur fait autorité : horloge, acceptation des réponses, calculs, tirages. Les
téléphones n'envoient qu'un choix d'option. Chaque mutation est journalisée dans
`data/sessions/<CODE>.events.jsonl` avec les détails des tirages (total, nombre tiré,
cumuls), et l'état est sauvegardé dans `data/sessions/<CODE>.json` pour survivre à un
redémarrage.

## Règles implémentées et hypothèses provisoires

Décidées (fiche) : gains 10/50/100 TH/s, bonus de rapidité 3/2/1 % puis division par 2 sans
fin, bonus appliqué au gain de base seulement, mauvaise réponse = 0 sans pénalité, manches
indépendantes, bonus de bloc 2,1 % pour un seul gagnant tiré selon les parts de hashrate,
lots tirés du plus gros au plus petit avec exclusion des gagnants dans une même série.

Provisoires (modifiables dans la console) :

- référence de rapidité = heure serveur de la **dernière** modification (`speedReference`) ;
- ex æquo au même instant : même rang, rang suivant sauté ;
- arrondi au nano-TH/s le plus proche ;
- absence de réponse = 0, sans bonus ni pénalité ;
- hashrate initial 10 TH/s par manche (`initialHashrateThs`), tirage ignoré et journalisé si
  le total vaut 0 ;
- assiette du 2,1 % = hashrate courant du gagnant (`blockBonusBase: own`), alternative
  `total` ;
- bloc éligible = reçu pendant une manche en cours, hauteur supérieure à la pointe connue au
  début de la manche, hash jamais traité ;
- lots : une série par manche sur son hashrate final (`prizeScope: round`), option explicite
  `sumOfRounds`, option d'exclusion entre séries ;
- numéros Bitaxe dans l'ordre d'inscription ;
- un seul format jouable, choix simple ; le champ `type` des questions est prévu pour
  d'autres formats.

## Remplacer les questions

Un pack est un fichier JSON dans `content/questions/` :

```json
{
  "name": "Nom du pack",
  "questions": [
    { "id": "q1", "type": "single-choice", "text": "…", "options": ["a", "b", "c", "d"],
      "correctIndex": 2, "difficulty": "easy|intermediate|hard", "durationMs": 10000,
      "explanation": "…", "source": { "provider": "…", "license": "…" } }
  ],
  "rounds": [ { "id": "r1", "title": "Manche 1", "questionIds": ["q1"] } ]
}
```

Le nombre de manches et de questions est libre. La console permet de changer la difficulté
et la durée de chaque question, et de charger un autre pack tant qu'aucune manche ne tourne.
