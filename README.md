# Proof of Brain

Le quiz de B-only 2026 (dépôt `bonly-quiz`). 21 questions sur Bitcoin, en 3 parties de plus en plus
difficiles. Chaque bonne réponse rapporte du hashrate fictif (en TH). À la fin, on tire au
sort le gagnant comme on mine un bloc : à chaque tirage, les chances d'un joueur sont égales à sa part du
hashrate. Le plus gros mineur est favori, mais rien n'est garanti.

## Règles

| | Par défaut |
|---|---|
| Bonne réponse | 10 TH (facile), 20 (moyenne), 30 (difficile), 50 (expert) |
| Rapidité | les 3 premières bonnes réponses reçues : +10 %, +5 %, +2 % du gain de base (facile : +1, +0,5, +0,2 TH) ; rien pour les suivantes |
| Série | +10 % du gain de base par bonne réponse d'affilée après la 1re (2e d'affilée +10 %, 3e +20 %…), plafonné à +50 % |
| Réinvestissement | chaque bonne réponse ajoute aussi 21 % des TH déjà gagnés : l'écart se creuse entre les bons joueurs et les autres (le 1er finit avec environ 50 fois le hashrate du dernier) |
| Mauvaise réponse / pas de réponse | 0 TH, série remise à zéro, aucune pénalité |
| Tirage | 1 gagnant tiré au sort (Web Crypto), probabilité = hashrate du joueur / hashrate total ; le classement final par TH sert aux autres lots |

Une seule réponse par question, verrouillée dès l'envoi. Le chrono (21 s) est tenu par le
serveur. La bonne réponse ne s'affiche (écran et téléphones) qu'à la fin du chrono, ou dès
que tous les inscrits ont répondu, y compris ceux dont le téléphone s'est mis en veille.
L'animateur peut aussi la révéler plus tôt depuis la console. Les gains sont comptés au
dixième de TH.

Le gagnant est fixé par le serveur au clic, puis révélé après 8 s d'animation. Le réglage
« Gagnants tirés au sort » permet d'en tirer plusieurs (1re, 2e, 3e place…) : un joueur
déjà tiré ne participe plus aux tirages suivants.

Un joueur qui change de téléphone, ou dont le téléphone ne le reconnaît plus parce que
l'adresse du quiz a changé, retrouve sa place et ses TH avec « Déjà inscrit ? Reprendre ma
place » et son pseudo exact. C'est possible seulement si sa place est hors ligne (personne
ne peut prendre celle d'un joueur connecté), et l'ancien téléphone perd alors l'accès : une
place n'est jamais sur deux téléphones.

Tous ces réglages se changent dans la console avant la 1re question, à la main ou avec
l'un des trois profils (Équilibré, Ouvert, Compétitif). `docs/reglages.md` compare leurs
effets sur les chances de chacun, simulation à l'appui : avec 50 joueurs, le 1er du
classement a environ 7 % de chances de gagner le tirage, le joueur médian 1,4 %, le dernier
0,2 %.

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

## En cas de problème

`docs/secours.md` donne la marche à suivre et les commandes exactes pour relancer le quiz,
garder une sauvegarde pendant la partie et tout reprendre sur un autre ordinateur
(`npm run restore` réimporte un export JSON de la console).

## Jouer en ligne (4G, sans Wi-Fi commun)

Avec `npm start`, les téléphones doivent être sur le même réseau que l'ordinateur. Pour
qu'ils se connectent depuis n'importe où (4G, Wi-Fi de la salle qui isole les appareils),
le serveur passe par un tunnel Cloudflare : il tourne toujours sur l'ordinateur, Cloudflare
lui donne une adresse publique en HTTPS, et le QR code pointe vers elle.

1. Installer `cloudflared` : `brew install cloudflared` (macOS),
   `winget install --id Cloudflare.cloudflared` (Windows).
2. Lancer :

   ```bash
   npm run build
   npm run online
   ```

   Sans réglage, l'adresse est temporaire (`https://xxx.trycloudflare.com`, sans compte,
   nouvelle à chaque lancement, sans garantie de disponibilité) : bien pour répéter.
3. Pour l'événement, une adresse fixe sur votre domaine est plus sûre : dans le tableau de
   bord Cloudflare (Zero Trust, Networks, Tunnels), créer un tunnel, lui ajouter le nom
   public `quiz.votre-domaine` vers `http://localhost:8787`, copier son jeton, puis :

   ```bash
   TUNNEL_TOKEN=eyJ... PUBLIC_URL=https://quiz.votre-domaine npm run online
   ```

   Le domaine doit être géré par Cloudflare (offre gratuite suffisante).

L'écran et la console s'ouvrent sur l'ordinateur en `http://localhost:8787/board` et
`/console`. L'ordinateur doit avoir une connexion internet fiable (prévoir un partage 4G
en secours) ; si elle coupe, les téléphones se reconnectent seuls dès son retour et la
partie reprend où elle en était.

Le trafic est faible : environ 40 Ko par téléphone pour une partie complète (voir
« Test de charge »).

## Déroulé d'une partie

1. Projeter `/board`, ouvrir `/console` sur l'ordinateur ou un téléphone de l'animateur.
2. Les joueurs scannent le QR code et choisissent un nom (le leur ou celui de leur équipe).
3. Console : « Annoncer la partie 1 ». L'écran présente la partie (titre, nombre de
   questions, gain) et le rappel des règles : c'est le moment de les expliquer.
4. Console : « Lancer la partie 1 ». La réponse s'affiche à la fin du chrono, ou dès que
   tout le monde a répondu. L'écran montre la bonne réponse, les meilleurs gains et le
   classement ; chaque téléphone montre le gain détaillé, le rang et les chances de bloc.
5. Console : « Question 2 / 21 », et ainsi de suite.
6. Après la 7e : « Fin de la partie 1 : classement ». L'écran affiche le classement
   provisoire et annonce la partie 2 ; chaque téléphone montre son bilan. L'animateur
   commente, puis « Lancer la partie 2 ». Pareil après la 14e.
7. Après la 21e : « Classement final », puis « Tirer le gagnant ».

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

`content/questions/bonly-21-fr.json` est le pack par défaut : 21 questions choisies dans
les cours de la Plan B Academy, licence CC BY-SA 4.0, en 3 parties de 7 :

| Partie | Niveau Plan B | Gain | Contenu |
|---|---|---|---|
| 1. Les bases | facile | 10 TH | 21 millions, halving, blockchain, 10 minutes, El Salvador, clés privées, CPU. Un débutant doit en connaître au moins 4 sur 7. |
| 2. Pour aller plus loin | moyen | 20 TH | 2140, Bitmain, livre blanc, généraux byzantins, bitcoins de Satoshi, Lightning, Schnorr |
| 3. Pour les experts | difficile | 30 TH | James Howells, inventeurs de Lightning, inventeurs de la preuve de travail, taille du nonce, bloc de la 1re transaction, taille de la mempool, date de naissance de Satoshi |

`demo-fr.json` (5 questions) sert aux répétitions. La console permet de changer de pack
avant la 1re question ; la partie joue les N premières questions du pack (N = 21 par
défaut), et les parties sont coupées d'autant.

La sélection est dans `scripts/pick-planb.mjs` (les 3 parties et leurs questions, une
ligne chacune). Pour en changer, modifier la liste puis, depuis un clone du dépôt Plan B
Network : `node scripts/pick-planb.mjs --repo chemin/vers/bitcoin-educational-content`.

Format d'un pack :

```json
{
  "name": "Nom du pack",
  "parts": [{ "title": "Les bases", "subtitle": "…", "questions": 7 }, …],
  "questions": [
    { "id": "q1", "type": "single-choice", "text": "…", "options": ["a", "b", "c", "d"],
      "correctIndex": 2, "difficulty": "easy|intermediate|hard|expert", "durationMs": 20000,
      "explanation": "…", "source": { "provider": "…", "license": "…" } }
  ]
}
```

2 à 4 options par question. `parts`, `durationMs` et `explanation` sont facultatifs ; les
parties se suivent dans l'ordre et leurs `questions` additionnées font le total du pack.
`npm run import:planb` régénère `planb-btc101-fr.json` (50 questions) depuis un clone du
dépôt Plan B Network.

## Tests

```bash
npm test         # règles de score, tirage, partie complète, serveur WebSocket multi-clients
npm run typecheck
npm run simulate # chances de chacun selon les réglages (voir docs/reglages.md)
```

### Test de charge

`npm run build` puis `npm run loadtest -- 50` lance un vrai serveur et 50 téléphones
simulés qui jouent les 21 questions et le podium : réponses à des moments aléatoires
(un tiers dans les 2 premières secondes), 5 % de questions sans réponse, 5 téléphones qui
perdent la connexion à la 11e question et reviennent. Résultats sur la machine de
développement :

| | 50 téléphones | 150 téléphones |
|---|---|---|
| inscription (confirmation reçue) | médiane 7 ms | médiane 2 ms, max 51 ms |
| question affichée sur les téléphones après le clic console | médiane 19 ms, max 33 ms | médiane 92 ms, max 183 ms |
| réponse → accusé de réception | médiane 2 ms, max 18 ms | médiane 3 ms, max 158 ms |
| trafic par téléphone pour toute la partie | environ 40 Ko (800 Ko si un proxy retire la compression) | environ 135 Ko |
| serveur | 2,4 % d'un cœur, 100 Mo de mémoire | 7,6 % d'un cœur, 180 Mo |
| erreurs, hashrates incohérents | 0 | 0 |

Ces temps ne comptent pas le réseau : en 4G et via le tunnel, ajouter de l'ordre de 50 à
200 ms.

Un serveur déjà en ligne peut être testé avec
`npm run loadtest -- 50 https://quiz.votre-domaine JETON_CONSOLE` (crée une nouvelle partie
sur ce serveur : pas pendant l'événement).

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
