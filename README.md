# bonly-quiz

Quiz interactif pour B-only 2026. 21 questions sur Bitcoin. Chaque bonne réponse rapporte
du hashrate fictif (en TH/s). À la fin, on « mine » un bloc : chaque joueur a une chance de
le trouver égale à sa part du hashrate total. Le plus gros mineur est favori, mais rien
n'est garanti.

## Règles

| | Par défaut |
|---|---|
| Bonne réponse | 100 TH/s (facile), 150 (moyenne), 200 (difficile) |
| ⚡ Rapidité | jusqu'à +50 % du gain de base pour une réponse instantanée, diminue linéairement jusqu'à 0 à la fin du chrono |
| 🔥 Série | +10 % du gain de base par bonne réponse d'affilée après la 1re (2e d'affilée +10 %, 3e +20 %…), plafonné à +50 % |
| Mauvaise réponse / pas de réponse | 0 TH/s, série remise à zéro, aucune pénalité |
| Bloc final | 1 gagnant tiré au hasard (Web Crypto), probabilité = hashrate du joueur / hashrate total |

Une seule réponse par question, verrouillée dès l'envoi. Le chrono (20 s) est tenu par le
serveur. La réponse s'affiche dès que tous les joueurs connectés ont répondu.

La console peut miner plusieurs blocs à la suite, 1 par lot. Par défaut, un joueur qui a
déjà trouvé un bloc ne participe plus aux tirages suivants. Le gagnant est fixé par le
serveur au clic, puis révélé après 8 s d'animation.

Tous ces réglages se changent dans la console avant la 1re question.

## Démarrage

Prérequis : Node 22 ou plus, npm.

```bash
npm install
npm run build
npm start
```

Le terminal affiche le jeton de la console et les 3 adresses :

| Route | Rôle |
|---|---|
| `/board` | écran projeté : QR code, questions, résultats, minage |
| `/console` | console d'animation (jeton requis), 1 gros bouton « étape suivante » |
| `/play` | téléphone des joueurs (le QR code y mène) |

L'adresse `/play` ne change pas d'une partie à l'autre : un QR code imprimé reste valable.

Développement avec rechargement : `npm run dev` (serveur 8787, client Vite 5173 ; les
téléphones ouvrent le port 5173).

## Déroulé d'une partie

1. Projeter `/board`, ouvrir `/console` sur l'ordinateur ou un téléphone de l'animateur.
2. Les joueurs scannent le QR code et choisissent un nom (le leur ou celui de leur équipe).
3. Console : « Lancer la question 1 ». La réponse s'affiche à la fin du chrono, ou dès que
   tout le monde a répondu. L'écran montre la bonne réponse, les meilleurs gains et le
   classement ; chaque téléphone montre le gain détaillé, le rang et les chances de bloc.
4. Console : « Question 2 / 21 », et ainsi de suite.
5. Après la 21e : « Classement final », puis « Miner le bloc » (champ optionnel pour le
   nom du lot). Recommencer pour chaque lot.

En cas d'erreur sur une question : « Annuler la question » la ferme sans attribuer de
points et sans casser les séries. « Nouvelle partie » repart de zéro (les joueurs se
réinscrivent). « Exporter la partie » télécharge l'état et le journal complet.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8787` | port HTTP + WebSocket |
| `HOST` | `0.0.0.0` | interface d'écoute |
| `CONSOLE_TOKEN` | généré dans `data/console-token.txt` | jeton de la console |
| `PUBLIC_URL` | 1re IP LAN détectée | base du lien à scanner, ex. `http://192.168.1.20:8787` |
| `DATA_DIR` | `./data` | sauvegardes et journaux des parties |
| `CONTENT_DIR` | `./content/questions` | packs de questions |

La console accepte aussi `/console?token=…` pour se connecter sans saisir le jeton.

## Questions

`content/questions/bonly-21-fr.json` est le pack par défaut : 21 questions du cours btc101
de Plan B Network (7 faciles, 7 moyennes, 7 difficiles, dans cet ordre), licence
CC BY-SA 4.0. `demo-fr.json` (5 questions) sert aux répétitions. La console permet de
changer de pack avant la 1re question ; la partie joue les N premières questions du pack
(N = 21 par défaut).

Format d'un pack :

```json
{
  "name": "Nom du pack",
  "questions": [
    { "id": "q1", "type": "single-choice", "text": "…", "options": ["a", "b", "c", "d"],
      "correctIndex": 2, "difficulty": "easy|intermediate|hard", "durationMs": 20000,
      "explanation": "…", "source": { "provider": "…", "license": "…" } }
  ]
}
```

2 à 4 options par question. `durationMs` et `explanation` sont facultatifs.
`npm run import:planb` régénère `planb-btc101-fr.json` (50 questions) depuis un clone du
dépôt Plan B Network.

## Tests

```bash
npm test         # règles de score, tirage, partie complète, serveur WebSocket multi-clients
npm run typecheck
```

## Architecture

```
src/shared/     moteur pur, partagé serveur/client/tests
  config.ts     réglages et valeurs par défaut
  scoring.ts    gain d'une réponse (base + rapidité + série)
  draw.ts       tirage pondéré par le hashrate (Web Crypto, sans biais)
  game.ts       machine à états : lobby → question → reveal → … → final (blocs)
  views.ts      vues par rôle (la bonne réponse et le gagnant d'un bloc ne partent qu'au bon moment) + protocole
src/server/     Node : HTTP + WebSocket, chronos, sauvegarde
src/client/     React + Vite : /play, /board, /console
content/questions/  packs JSON
tests/          vitest
```

Le serveur fait autorité : horloge, réponses, calculs, tirages. Chaque événement est
journalisé dans `data/sessions/<CODE>.events.jsonl` (y compris le nombre tiré et les poids
de chaque bloc) et l'état est sauvegardé dans `data/sessions/<CODE>.json` : un redémarrage
reprend la partie en cours, et les téléphones se reconnectent seuls.

Les sauvegardes de l'ancienne version (manches, blocs réels, lots) ne sont pas reprises :
le serveur démarre une nouvelle partie s'il en trouve une.
