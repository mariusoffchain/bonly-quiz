# Fiche de lancement : Proof of Brain

À suivre dans l'ordre, sur le Mac de l'animation. Chaque commande se tape dans le Terminal,
puis Entrée, et on attend qu'elle soit finie avant la suivante.

Le quiz est dans `Documents/bonly-quiz`. Il tourne sur le port **8788** : sur ce Mac, un
autre programme (`workerd`) occupe déjà le port 8787 habituel.

## 1. La veille : mettre à jour et tester

Ouvrir le Terminal : Cmd + Espace, taper « Terminal », Entrée.

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

Puis faire un essai complet avec la partie 2 ci-dessous, et arrêter avec Ctrl + C.

## 2. Le jour J : lancer le quiz

**Terminal 1, le quiz.** Ouvrir le Terminal, puis :

```bash
cd ~/Documents/bonly-quiz
```

```bash
PORT=8788 npm run online
```

Laisser cette fenêtre ouverte toute la partie : la fermer arrête le quiz. Elle affiche :

- `adresse publique : https://….trycloudflare.com` : l'adresse des téléphones (le QR code
  de l'écran la reprend tout seul) ;
- `console token: …` : le jeton de la console, à noter sur papier.

**Terminal 2, la sauvegarde automatique.** Cmd + N pour une nouvelle fenêtre, puis :

```bash
cd ~/Documents/bonly-quiz
```

```bash
while true; do rsync -a data/ ~/Desktop/bonly-sauvegarde/; sleep 30; done
```

Elle recopie la partie toutes les 30 secondes dans `Bureau/bonly-sauvegarde`. La laisser
tourner aussi.

**Navigateur.**

| Page | Adresse | Où |
|---|---|---|
| Écran | `http://localhost:8788/board` | sur le projecteur, en plein écran : Cmd + Ctrl + F |
| Console | `http://localhost:8788/console` | sur l'ordinateur, avec le jeton |
| Console sur un téléphone | l'adresse `trycloudflare.com` + `/console` | si l'animateur pilote depuis la scène |

## 3. Avant d'ouvrir les inscriptions

Dans la console :

- [ ] « Nouvelle partie » si une partie de test traîne (le bouton doit afficher « Annoncer la
      partie 1 » et 0 joueur).
- [ ] Réglages : profil **Équilibré**, chrono **21 s**, **1** gagnant.
- [ ] Scanner le QR code avec son propre téléphone, s'inscrire, vérifier que ça marche, puis
      « retirer » ce joueur de test dans la console.

## 4. Pendant le jeu : les boutons de la console

Un seul gros bouton, qui change à chaque étape :

1. **Annoncer la partie 1** : l'écran présente la partie et les règles. On les explique.
2. **Lancer la partie 1** : 1re question. La réponse s'affiche seule à la fin des 21 s, ou
   dès que tout le monde a répondu (« Révéler la réponse maintenant » pour forcer).
3. **Question 2 / 21**, et ainsi de suite.
4. Après la 7e : **Fin de la partie 1 : classement** (classement provisoire à l'écran), puis
   **Lancer la partie 2**. Pareil après la 14e.
5. Après la 21e : **Classement final**, puis **Tirer le gagnant** (8 s d'animation).

À la fin : cliquer sur « Exporter la partie (JSON) » dans la console pour garder une
trace, puis Ctrl + C dans les deux terminaux.

## 5. En cas de problème

**Le quiz ne répond plus.** Dans le terminal 1 : Ctrl + C, puis

```bash
PORT=8788 npm run online
```

La partie reprend où elle en était. L'adresse `trycloudflare.com` change : les joueurs
rescannent le QR code et, si leur téléphone ne les reconnaît pas, touchent « Déjà inscrit ?
Reprendre ma place » et tapent leur pseudo exact.

**« Le port 8788 est déjà utilisé ».** Le quiz tourne sans doute déjà dans une autre
fenêtre : la retrouver, ou lancer sur un autre port (et ouvrir alors
`localhost:8789/board` et `/console`) :

```bash
PORT=8789 npm run online
```

**Plus d'internet.** Passer le Mac sur le partage de connexion d'un téléphone, puis
relancer comme ci-dessus.

**Le Mac tombe en panne.** Suivre `docs/secours.md`, section « L'ancien ordinateur est hors
service », avec le dossier `Bureau/bonly-sauvegarde` ou l'export JSON.
