# Réglages des points : ce que change chaque profil

Question de départ : avec 10 TH par bonne réponse, un bonus pour les plus rapides et +10 %
par réponse d'affilée, les bons joueurs prennent-ils trop d'avance sur les autres au moment
du tirage ?

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
| **Équilibré** (par défaut) | 4,3 % | 2,8 % | 1,8 % | 0,5 % | 12,7 % | 69,7 % | x2,3 |
| **Ouvert** | 3,4 % | 2,6 % | 1,9 % | 0,9 % | 10,1 % | 76,9 % | x1,8 |
| **Compétitif** | 5,8 % | 3,0 % | 1,6 % | 0,3 % | 16,7 % | 62,1 % | x3,6 |
| Équilibré, rapidité top 10 (+10 % à +1 %) | 4,3 % | 2,8 % | 1,8 % | 0,5 % | 12,7 % | 68,5 % | x2,4 |
| Équilibré, sans bonus de rapidité | 4,2 % | 2,8 % | 1,8 % | 0,5 % | 12,6 % | 69,5 % | x2,3 |
| Ancien bonus : top 3 à +50 / +30 / +10 % | 4,5 % | 2,8 % | 1,8 % | 0,4 % | 13,4 % | 68,6 % | x2,5 |
| Sans aucun bonus | 3,6 % | 2,7 % | 1,9 % | 0,5 % | 10,7 % | 73,0 % | x1,8 |
| Équilibré, base 100 (100/200/300) | 4,3 % | 2,8 % | 1,8 % | 0,5 % | 12,6 % | 69,4 % | x2,3 |
| Écart x10 (10/30/100) | 4,9 % | 2,9 % | 1,8 % | 0,3 % | 14,3 % | 65,5 % | x2,8 |
| Équilibré, 6/6/6 + 3 expert | 4,6 % | 2,8 % | 1,8 % | 0,5 % | 13,5 % | 68,7 % | x2,6 |
| Équilibré, public homogène | 3,7 % | 2,6 % | 1,9 % | 0,8 % | 11,4 % | 76,0 % | x1,9 |
| Équilibré, public très hétérogène | 4,4 % | 3,2 % | 1,8 % | 0,3 % | 13,2 % | 62,4 % | x2,5 |

Chances égales pour tous : 2 % chacun. Marge d'erreur de la simulation : environ ±0,5 point
sur les colonnes podium.

## Ce qu'on en retient

- **Base 10 ou base 100 : aucune différence.** Le tirage ne regarde que les parts de
  chacun ; multiplier tous les gains par 10 ne change aucune part. Le jeu est en base 10,
  avec des gains au dixième de TH près (+0,5 TH), ce qui ne change pas les chances (lignes
  Équilibré et base 100).
- **Écart x3 entre facile et difficile (10/20/30)** : à peine plus sélectif que
  l'ancien x2. Même x10 ne fait passer le favori que de 4,2 % à 4,8 %.
- **Questions expert à 50 TH (x5)** : 3 questions expert sur 21 font passer le favori
  de 4,2 % à 4,6 %. Utile pour récompenser une vraie difficulté, sans effet de rupture.
- **Le bonus de rapidité** ne va qu'aux 3 premières bonnes réponses reçues par le serveur :
  +10 %, +5 %, +2 % du gain de base (question facile : +1, +0,5, +0,2 TH). C'est volontairement
  léger : il départage, il ne fait pas le classement (4,3 % de chances pour le favori, contre
  4,2 % sans bonus de rapidité). L'ancien bonus à +50 / +30 / +10 % donnait 4,5 %.
- **Le bonus de série** pèse davantage : sans aucun bonus (ni rapidité ni série) le favori a
  3,6 %, avec le profil Compétitif 5,8 %. Il reste modeste.
- **Le hashrate de départ** (profil Ouvert, 100 TH pour tous) rapproche tout le
  monde : même un joueur qui ne trouve rien garde une petite chance (0,9 % contre 0,4 %).

Si un jour on veut que le niveau compte beaucoup plus, ce n'est pas le barème qu'il faut
changer mais le tirage lui-même : par exemple le réserver aux 10 premiers, ou faire
compter le hashrate au carré. Ça s'éloigne du minage réel, donc ce n'est pas fait.

## Les trois profils

Choisis dans la console (Réglages, « Profil de points ») avant la 1re question. Chaque
champ reste modifiable à la main ensuite.

| Profil | Gains facile / moyenne / difficile / expert | Rapidité (1re, 2e, 3e… bonne réponse) | Série | Départ |
|---|---|---|---|---|
| Équilibré | 10 / 20 / 30 / 50 | +10 / +5 / +2 % | +10 % par réponse, max +50 % | 0 |
| Ouvert | 10 / 20 / 30 / 50 | +5 / +3 / +1 % | +5 % par réponse, max +25 % | 100 TH |
| Compétitif | 10 / 20 / 30 / 50 | +10, +9, +8… +1 % (10 premiers) | +25 % par réponse, max +200 % | 0 |

Dans la console, « Bonus rapidité par rang » se règle librement, par exemple `10, 5, 2`
ou `10, 9, 8, 7, 6, 5, 4, 3, 2, 1`.

## Hypothèses de la simulation

Ce sont des hypothèses, pas des mesures : à revoir une fois les vraies questions écrites.

- Chaque joueur a un niveau tiré au hasard (loi normale). La probabilité de bonne réponse
  dépend de l'écart entre son niveau et la difficulté, avec un plancher de 25 % (4 choix,
  on peut deviner). En moyenne : 85 % de bonnes réponses aux questions faciles, 62 % aux
  moyennes, 43 % aux difficiles, 33 % aux expert.
- Les bons joueurs répondent un peu plus vite. Temps de réponse médian : 6 s sur 20. Le
  bonus de rapidité va aux premières bonnes réponses, comme dans le jeu.
- 3 % des réponses manquent (distraction, téléphone verrouillé).
- « Public homogène » et « très hétérogène » font varier l'écart de niveau entre joueurs
  (la moitié et 1,6 fois celui des autres lignes).

Relancer : `npm run simulate` (50 joueurs, 4 000 parties par ligne, environ 15 s) ou
`npm run simulate -- 80 20000` (80 joueurs, 20 000 parties).
