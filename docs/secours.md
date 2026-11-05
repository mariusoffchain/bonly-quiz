# Note de secours : relancer le quiz ou passer sur un autre ordinateur

Le lancement normal est dans `docs/lancement.md`. Sur le Mac de l'animation, le quiz tourne
sur le port 8788 (`PORT=8788 npm run online`, adresses `localhost:8788`) ; ailleurs, le port
8787 par défaut convient.

Le quiz tourne sur l'ordinateur de l'animation (`npm run online`). Toute la partie en cours
(joueurs, réponses, TH, tirage) est enregistrée en continu dans le dossier `data/` du projet.
Tant qu'on a ce dossier, ou un export de la partie, on peut reprendre exactement où on en
était, sur le même ordinateur ou sur un autre.

Les téléphones gardent leur place tant que l'adresse du quiz ne change pas. Si elle change
(nouveau lancement avec une adresse `trycloudflare.com`, autre ordinateur), chaque joueur
rescanne le QR code, touche « Déjà inscrit ? Reprendre ma place » et tape son pseudo
exact (la console affiche la liste des pseudos). La reprise ne marche que si la place est
hors ligne, et l'ancien téléphone perd alors l'accès : une place n'est jamais sur deux
téléphones.

## 1. La veille : préparer l'ordinateur de secours

À faire une fois, au calme, sur le second ordinateur.

**Installer les outils**

Sur Mac (avec [Homebrew](https://brew.sh)) :

```bash
brew install node git cloudflared
```

Sur Windows (PowerShell) :

```powershell
winget install OpenJS.NodeJS.LTS
```

```powershell
winget install Git.Git
```

```powershell
winget install Cloudflare.cloudflared
```

Fermer puis rouvrir le terminal pour que ces programmes soient trouvés.

Vérifier que Node est en version 22 ou plus :

```bash
node -v
```

**Récupérer le quiz**

```bash
git clone https://github.com/mariusoffchain/bonly-quiz.git
```

```bash
cd bonly-quiz
```

Tant que la PR n'est pas fusionnée, se placer sur la branche du travail en cours :

```bash
git checkout claude/gracious-pascal-j2zb2v
```

Sans Git ou sans accès GitHub en ligne de commande : sur github.com, ouvrir le dépôt, choisir
la branche, bouton « Code » puis « Download ZIP », dézipper, puis ouvrir un terminal dans le
dossier.

**Installer et compiler**

```bash
npm install
```

```bash
npm run build
```

**Faire un essai** (puis `Ctrl+C` pour arrêter) :

```bash
npm run online
```

**Utiliser le même jeton de console sur les deux ordinateurs.** Le jeton est dans
`data/console-token.txt` sur l'ordinateur principal. On peut aussi l'imposer au lancement,
sur les deux machines :

Mac :

```bash
CONSOLE_TOKEN=le-jeton npm run online
```

Windows (PowerShell) :

```powershell
$env:CONSOLE_TOKEN="le-jeton"; npm run online
```

## 2. Pendant la partie : garder une sauvegarde à jour

Deux protections, à cumuler.

**Sauvegarde automatique du dossier `data/`.** Dans un second terminal, dans le dossier
`bonly-quiz`, cette commande recopie la partie toutes les 30 secondes vers un autre endroit
(clé USB, ou dossier iCloud Drive, Dropbox, Google Drive…). Adapter le chemin de destination.

Mac (ici vers le bureau) :

```bash
while true; do rsync -a data/ ~/Desktop/bonly-sauvegarde/; sleep 30; done
```

Windows (PowerShell, ici vers `C:\bonly-sauvegarde`) :

```powershell
while ($true) { robocopy data C:\bonly-sauvegarde /MIR /NJH /NJS /NDL /NFL | Out-Null; Start-Sleep 30 }
```

**Export depuis la console.** Le lien « Exporter la partie (JSON) » télécharge un fichier
`bonly-quiz-XXXX.json` qui contient toute la partie. Il marche depuis n'importe quel appareil
connecté à la console, y compris le téléphone de l'animateur : utile si l'ordinateur principal
meurt. En faire un toutes les 5 questions environ.

## 3. En cas de problème

### Le quiz ne répond plus, l'ordinateur marche

Dans le terminal du quiz : `Ctrl+C`, puis

```bash
npm run online
```

La partie reprend où elle en était. Avec une adresse `trycloudflare.com`, l'adresse change :
le QR code de l'écran se met à jour tout seul, les joueurs le rescannent et, si leur téléphone
ne les reconnaît pas, reprennent leur place avec leur pseudo exact.

Si la connexion internet de l'ordinateur est en cause : passer sur le partage de connexion
d'un téléphone, puis relancer de la même façon.

### La page affiche `{"error":"Not found"}` ou « Le port 8787 est déjà utilisé »

Un autre programme de l'ordinateur occupe le port du quiz (un serveur de développement,
par exemple `workerd` de Cloudflare, ou le quiz déjà lancé dans un autre terminal). Pour
voir lequel :

```bash
lsof -i :8787
```

Le fermer, ou lancer le quiz sur un autre port, puis ouvrir `http://localhost:8788/board`
et `http://localhost:8788/console` :

```bash
PORT=8788 npm run online
```

### Changer d'ordinateur, l'ancien marche encore

1. Sur l'ancien ordinateur : `Ctrl+C` dans le terminal du quiz.
2. Copier le dossier `bonly-quiz/data` (clé USB, AirDrop…) dans le dossier `bonly-quiz` du
   nouvel ordinateur, à la place de son `data` s'il en a un.
3. Sur le nouvel ordinateur, dans `bonly-quiz` :

   ```bash
   npm run online
   ```

4. Ouvrir `http://localhost:8787/board` (écran) et `http://localhost:8787/console`
   (console, même jeton qu'avant).
5. Les joueurs rescannent le QR code et reprennent leur place avec leur pseudo exact.

### L'ancien ordinateur est hors service

Avec la sauvegarde automatique : copier le contenu du dossier de sauvegarde
(`bonly-sauvegarde`) dans `bonly-quiz/data` sur le nouvel ordinateur, puis
`npm run online`.

Avec un export JSON de la console : sur le nouvel ordinateur, dans `bonly-quiz` :

```bash
npm run restore -- chemin/vers/bonly-quiz-XXXX.json
```

```bash
npm run online
```

La partie reprend à l'état de l'export : ce qui s'est passé après l'export est perdu. Si
une question était ouverte au moment de l'export, elle se ferme au redémarrage avec les
réponses déjà reçues.

### Aucune sauvegarde

Lancer `npm run online`, puis « Nouvelle partie » dans la console. Les joueurs se
réinscrivent et repartent de 0 TH. On peut alors réduire le nombre de questions dans les
Réglages pour finir à l'heure.

## 4. Check-list du jour J

- [ ] Ordinateur principal branché sur secteur, mise en veille désactivée.
- [ ] Partage de connexion 4G prêt en secours.
- [ ] `npm run online` lancé ; écran et console ouverts sur `localhost:8787`.
- [ ] Sauvegarde automatique lancée dans un second terminal.
- [ ] Jeton de la console noté sur papier.
- [ ] Ordinateur de secours préparé et testé la veille (section 1).
- [ ] Au lancement, rappeler aux joueurs qu'en cas de souci ils retrouvent leur place
      avec « Déjà inscrit ? » et leur pseudo exact.
