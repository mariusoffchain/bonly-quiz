# Mise en place de zéro : Tailscale et Pinggy

Cette note part d'un Mac où rien n'est installé et va jusqu'à une partie jouable depuis
n'importe quel téléphone, en 4G ou sur n'importe quel Wi-Fi. Elle décrit les deux façons
de mettre le quiz en ligne :

| | Tailscale (principale) | Pinggy (secours) |
|---|---|---|
| À installer | l'application Tailscale + un compte gratuit | rien |
| Adresse des joueurs | toujours la même (`https://mac.xxxx.ts.net`) | nouvelle à chaque lancement |
| Écran « Caution » chez les joueurs | non | oui, à passer une fois |
| Durée | illimitée | 60 minutes, puis relancer |
| Commande | `TUNNEL=tailscale PORT=8788 npm run online` | `TUNNEL=pinggy PORT=8788 npm run online` |

Dans les deux cas, le quiz tourne sur le Mac. Le tunnel donne seulement une adresse
publique en HTTPS, et le QR code du grand écran la reprend tout seul. Les joueurs
n'installent rien.

Chaque commande se tape dans le Terminal, puis Entrée. Attendre qu'elle soit finie (la
ligne `… %` réapparaît) avant de taper la suivante.

---

## Étape 1 : préparer le Mac (une seule fois, commun aux deux)

**Ouvrir le Terminal** : Cmd + Espace, taper « Terminal », Entrée.

**Installer Homebrew**, l'outil qui installe les autres programmes (il demande le mot de
passe du Mac ; rien ne s'affiche pendant qu'on le tape, c'est normal) :

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

À la fin, Homebrew affiche « Next steps » avec deux ou trois lignes à copier-coller :
les taper, puis fermer et rouvrir le Terminal.

**Installer Node et Git** :

```bash
brew install node git
```

Vérifier que Node est en version 22 ou plus :

```bash
node -v
```

**Récupérer le quiz** dans le dossier Documents :

```bash
cd ~/Documents
```

```bash
git clone https://github.com/mariusoffchain/bonly-quiz.git
```

```bash
cd bonly-quiz
```

Tant que le travail n'est pas fusionné dans la branche principale, se placer sur la
branche en cours :

```bash
git checkout claude/gracious-pascal-j2zb2v
```

**Installer et compiler le quiz** :

```bash
npm install
```

```bash
npm run build
```

**Le port.** Le quiz utilise normalement le port 8787. Sur le Mac de l'animation, un autre
programme (`workerd`) l'occupe déjà : on utilise donc **8788**, d'où le `PORT=8788` dans
toutes les commandes. Sur un autre Mac, 8788 marche aussi.

**Les VPN.** Couper ProtonVPN (ou tout autre VPN) avant de lancer le quiz.

---

## Étape 2A : Tailscale (la solution principale)

### Une seule fois : installer et autoriser

1. **Créer un compte** sur https://tailscale.com (bouton « Get started »). On peut se
   connecter avec un compte Google, Apple, Microsoft ou GitHub. L'offre gratuite suffit.

2. **Installer l'application** :

   ```bash
   brew install --cask tailscale
   ```

   (ou depuis https://tailscale.com/download, ou depuis le Mac App Store).

3. **Ouvrir Tailscale** (Cmd + Espace, « Tailscale »). Accepter l'ajout de la
   configuration VPN demandée par macOS, puis se connecter avec le compte créé. L'icône
   apparaît en haut à droite de l'écran ; elle doit indiquer **Connected**.

4. **Premier lancement du quiz** :

   ```bash
   cd ~/Documents/bonly-quiz
   ```

   ```bash
   TUNNEL=tailscale PORT=8788 npm run online
   ```

   - Si le terminal affiche un lien `https://login.tailscale.com/…` : l'ouvrir dans le
     navigateur et valider l'activation de **Funnel** (et des certificats HTTPS si c'est
     demandé). Le terminal continue tout seul ensuite.
   - Quand il affiche **« Available on the internet »** suivi de l'adresse
     (`https://mac.xxxx.ts.net/`), Funnel est actif. **Noter cette adresse** : elle ne
     changera plus.

5. **Obtenir le certificat HTTPS.** Sans lui, l'adresse ne s'ouvre pas sur les téléphones,
   même si le terminal dit « Available on the internet ». Certains Wi-Fi (hôtels, salles)
   empêchent de l'obtenir : le faire depuis le **partage de connexion de l'iPhone**.

   Mettre le Mac sur le partage de connexion, laisser le quiz tourner, ouvrir une deuxième
   fenêtre de Terminal (Cmd + N), puis (remplacer l'adresse par la vôtre, sans `https://`
   ni `/` à la fin) :

   ```bash
   cd /tmp
   ```

   ```bash
   /Applications/Tailscale.app/Contents/MacOS/Tailscale cert mac.tail991840.ts.net
   ```

   La 1re fois, la commande peut travailler une à deux minutes. C'est bon quand elle
   répond « Wrote public cert » et « Wrote private key ». Supprimer les deux fichiers
   qu'elle a écrits (Tailscale garde sa propre copie) :

   ```bash
   rm /tmp/mac.tail991840.ts.net.crt /tmp/mac.tail991840.ts.net.key
   ```

   Le certificat est gardé environ 3 mois, puis renouvelé tout seul. S'il échoue un jour
   sur un Wi-Fi bloqué, refaire cette étape depuis le partage de connexion.

6. **Tester.** Remettre le Mac sur le Wi-Fi habituel. Dans la deuxième fenêtre (remplacer
   l'adresse par la vôtre) :

   ```bash
   curl -sS -m 60 -o /dev/null -w "%{http_code}\n" https://mac.tail991840.ts.net/play
   ```

   `200` veut dire que c'est bon. Puis le vrai test : un téléphone **en 4G, Wi-Fi coupé,
   sans Tailscale**, qui scanne le QR code de `http://localhost:8788/board`.

### À chaque fois

1. Vérifier que Tailscale est **Connected** (icône en haut à droite).
2. Dans le Terminal :

   ```bash
   cd ~/Documents/bonly-quiz
   ```

   ```bash
   TUNNEL=tailscale PORT=8788 npm run online
   ```

3. Ouvrir `http://localhost:8788/board` (écran) et `http://localhost:8788/console`
   (console) sur le Mac.

Pour arrêter : Ctrl + C dans la fenêtre du quiz.

### Si ça coince

| Ce qu'on voit | Quoi faire |
|---|---|
| « Tailscale est introuvable » | Installer l'application (point 2), l'ouvrir, se connecter. |
| « Tailscale n'est pas connecté » | Ouvrir Tailscale, se connecter, attendre « Connected », relancer. |
| « Available on the internet » mais rien ne s'ouvre sur le téléphone | Il manque le certificat : refaire le point 5 depuis le partage de connexion. |
| L'adresse ne s'ouvre pas juste après la toute 1re activation | Attendre jusqu'à 10 minutes : internet doit apprendre la nouvelle adresse. |
| « Le port 8788 est déjà utilisé » | Un ancien quiz tourne encore : `kill $(lsof -t -iTCP:8788 -sTCP:LISTEN)`, puis relancer. |

---

## Étape 2B : Pinggy (le secours, sans rien installer)

Pinggy passe par le programme `ssh`, déjà présent sur tous les Mac. Pas de compte, pas
d'installation. À utiliser si Tailscale ne marche pas le jour J.

### Lancer

```bash
cd ~/Documents/bonly-quiz
```

```bash
TUNNEL=pinggy PORT=8788 npm run online
```

- Si un **mot de passe** est demandé : appuyer simplement sur **Entrée** (il n'y en a pas).
- L'écran de Pinggy s'affiche quelques secondes avec des adresses en
  `….pinggy-free.link` ou `….pinggy.net`, puis le quiz démarre et affiche
  `adresse publique : https://…`. Le QR code de l'écran prend cette adresse tout seul.

Ouvrir ensuite `http://localhost:8788/board` et `http://localhost:8788/console` sur le Mac,
comme d'habitude.

### Ce qu'il faut savoir

- **L'écran « Caution »** : à la première ouverture, chaque téléphone voit une page de
  Pinggy qui demande de confirmer qu'on fait confiance au site. Les joueurs touchent le
  bouton pour continuer, une seule fois. L'annoncer au micro.
- **60 minutes maximum** : le tunnel gratuit se coupe au bout d'une heure. Relancer la
  même commande : la partie reprend où elle en était, mais l'**adresse change**. Les
  joueurs rescannent le QR code ; si leur téléphone ne les reconnaît pas, ils touchent
  « Déjà inscrit ? Reprendre ma place » et tapent leur pseudo exact.
- Une partie de 21 questions dure environ 30 à 40 minutes : lancer Pinggy juste avant
  d'ouvrir les inscriptions, pas une heure avant.

### Arrêter

Ctrl + C. Si rien ne se passe : Entrée, puis `~`, puis `.` (point).

### Si ça coince

| Ce qu'on voit | Quoi faire |
|---|---|
| Ça reste bloqué sur la demande de mot de passe | Appuyer sur Entrée. |
| « le tunnel Pinggy s'est arrêté » | Relancer la même commande ; la partie reprend. |
| « Le port 8788 est déjà utilisé » | `kill $(lsof -t -iTCP:8788 -sTCP:LISTEN)`, puis relancer. |

---

## Étape 3 : la veille de l'événement

1. Mettre le quiz à jour :

   ```bash
   cd ~/Documents/bonly-quiz
   ```

   ```bash
   git pull
   ```

   ```bash
   npm install
   ```

   ```bash
   npm run build
   ```

2. Si possible sur le Wi-Fi de la salle : lancer **Tailscale**, tester avec un téléphone en
   4G. Si ça ne marche pas, essayer **Pinggy**, et noter laquelle marche.
3. Arrêter avec Ctrl + C. Le jour J, suivre `docs/lancement.md`, avec la commande qui a
   marché.

Changer de solution en pleine partie est possible : Ctrl + C, puis lancer l'autre
commande. La partie reprend où elle en était ; seuls les joueurs rescannent le QR code si
l'adresse a changé.
