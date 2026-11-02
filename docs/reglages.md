# Réglages des points : ce que change chaque profil

Question de départ : avec 10 TH par bonne réponse, +50 % de rapidité et +10 % par
réponse d'affilée, les bons joueurs prennent-ils trop d'avance sur les autres au moment du
tirage ?

Pour répondre, `npm run simulate` joue 20 000 parties de 21 questions avec 50 joueurs
fictifs, puis tire le podium exactement comme le serveur (même calcul des points, même
tirage).

## Résultat

**Non, l'écart reste faible.** Avec 50 joueurs, le 1er du classement finit avec environ
2 fois le hashrate du joueur médian. Il a donc à peu près 4 % de chances de gagner la
1re place, contre 2 % pour un joueur moyen. 7 fois sur 10, au moins une personne de la
moitié basse du classement monte sur le podium.

C'est le principe du minage : avoir plus de hashrate donne plus de chances, mais avec
50 mineurs, personne ne pèse lourd. Le classement compte, le hasard compte davantage.

| Réglage | 1re place : chances du 1er du classement | du 10e | du joueur médian | du dernier | 1er du classement sur le podium | au moins un joueur de la moitié basse sur le podium | hashrate 1er / médian |
|---|---|---|---|---|---|---|---|
| **Équilibré** (par défaut) | 4,2 % | 2,9 % | 1,9 % | 0,4 % | 12,6 % | 69,3 % | x2,3 |
| **Ouvert** | 3,5 % | 2,6 % | 1,9 % | 0,9 % | 10,1 % | 76,4 % | x1,8 |
| **Compétitif** | 5,2 % | 3,0 % | 1,7 % | 0,4 % | 15,3 % | 63,9 % | x3,1 |
| Équilibré, base 100 (100/200/300) | 4,2 % | 2,9 % | 1,8 % | 0,4 % | 12,8 % | 69,0 % | x2,3 |
| Ancien réglage (100/150/200) | 4,0 % | 2,8 % | 1,9 % | 0,5 % | 12,0 % | 69,9 % | x2,1 |
| Sans aucun bonus | 3,6 % | 2,7 % | 1,9 % | 0,5 % | 10,8 % | 73,1 % | x1,8 |
| Écart x10 (10/30/100) | 4,8 % | 2,9 % | 1,8 % | 0,3 % | 14,4 % | 65,8 % | x2,7 |
| Équilibré, 6/6/6 + 3 expert | 4,6 % | 2,8 % | 1,8 % | 0,4 % | 13,4 % | 68,8 % | x2,5 |
| Équilibré, public homogène | 3,7 % | 2,6 % | 1,9 % | 0,7 % | 11,1 % | 76,1 % | x1,9 |
| Équilibré, public très hétérogène | 4,3 % | 3,2 % | 1,8 % | 0,2 % | 13,0 % | 61,5 % | x2,5 |

Chances égales pour tous : 2 % chacun. Marge d'erreur de la simulation : environ ±0,5 point
sur les colonnes podium.

## Ce qu'on en retient

- **Base 10 ou base 100 : aucune différence.** Le tirage ne regarde que les parts de
  chacun ; multiplier tous les gains par 10 ne change aucune part. Le jeu est en base 10 :
  les bonus sont arrondis au TH près (un bonus de rapidité vaut au plus 5 TH sur une
  question facile), ce qui ne change pas les chances (lignes Équilibré et base 100).
- **Écart x3 entre facile et difficile (10/20/30)** : à peine plus sélectif que
  l'ancien x2. Même x10 ne fait passer le favori que de 4,2 % à 4,8 %.
- **Questions expert à 50 TH (x5)** : 3 questions expert sur 21 font passer le favori
  de 4,2 % à 4,6 %. Utile pour récompenser une vraie difficulté, sans effet de rupture.
- **Les bonus** : sans aucun bonus le favori a 3,6 %, avec les bonus doublés
  (Compétitif) 5,2 %. C'est le réglage qui pèse le plus, et il reste modeste.
- **Le hashrate de départ** (profil Ouvert, 100 TH pour tous) rapproche tout le
  monde : même un joueur qui ne trouve rien garde une petite chance (0,9 % contre 0,4 %).

Si un jour on veut que le niveau compte beaucoup plus, ce n'est pas le barème qu'il faut
changer mais le tirage lui-même : par exemple le réserver aux 10 premiers, ou faire
compter le hashrate au carré. Ça s'éloigne du minage réel, donc ce n'est pas fait.

## Les trois profils

Choisis dans la console (Réglages, « Profil de points ») avant la 1re question. Chaque
champ reste modifiable à la main ensuite.

| Profil | Gains facile / moyenne / difficile / expert | Rapidité | Série | Départ |
|---|---|---|---|---|
| Équilibré | 10 / 20 / 30 / 50 | jusqu'à +50 % | +10 % par réponse, max +50 % | 0 |
| Ouvert | 10 / 20 / 30 / 50 | jusqu'à +25 % | +5 % par réponse, max +25 % | 100 TH |
| Compétitif | 10 / 20 / 30 / 50 | jusqu'à +100 % | +25 % par réponse, max +200 % | 0 |

## Hypothèses de la simulation

Ce sont des hypothèses, pas des mesures : à revoir une fois les vraies questions écrites.

- Chaque joueur a un niveau tiré au hasard (loi normale). La probabilité de bonne réponse
  dépend de l'écart entre son niveau et la difficulté, avec un plancher de 25 % (4 choix,
  on peut deviner). En moyenne : 85 % de bonnes réponses aux questions faciles, 62 % aux
  moyennes, 43 % aux difficiles, 33 % aux expert.
- Les bons joueurs répondent un peu plus vite. Temps de réponse médian : 6 s sur 20.
- 3 % des réponses manquent (distraction, téléphone verrouillé).
- « Public homogène » et « très hétérogène » font varier l'écart de niveau entre joueurs
  (la moitié et 1,6 fois celui des autres lignes).

Relancer : `npm run simulate` (50 joueurs, 4 000 parties par ligne, environ 15 s) ou
`npm run simulate -- 80 20000` (80 joueurs, 20 000 parties).
