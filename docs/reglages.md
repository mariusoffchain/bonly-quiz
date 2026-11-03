# Réglages des points : ce que change chaque profil

Le tirage final suit le minage : chacun a une chance égale à sa part du hashrate. Le barème
décide donc de l'écart entre les joueurs. Trop faible, le tirage est une loterie ; trop fort,
le meilleur gagne presque à coup sûr.

`npm run simulate` joue 20 000 parties de 21 questions avec 50 joueurs fictifs et tire le
gagnant exactement comme le serveur (même calcul des points, même tirage).

## Résultat

Objectif retenu : au moins x10 à x20 de hashrate entre le meilleur et le dernier, sans
qu'une seule erreur ruine une partie. Le **réinvestissement** y parvient : à chaque bonne
réponse, le joueur gagne aussi 15 % des TH qu'il a déjà, comme un mineur qui rachète des
machines avec ses gains. L'écart se creuse au fil des bonnes réponses, et une mauvaise
réponse ne fait rien perdre.

Avec le profil Équilibré, le 1er du classement finit en moyenne avec 4 fois le hashrate du
joueur médian et 29 fois celui du dernier. Il a environ 6 % de chances de gagner, le joueur
médian 1,6 %, le dernier 0,2 %. Le gagnant vient de la moitié basse du classement environ
une fois sur 5.

| Réglage | Chances de gagner : 1er du classement | 10e | joueur médian | dernier | Gagnant dans la moitié basse | Hashrate 1er ÷ médian | 1er ÷ dernier |
|---|---|---|---|---|---|---|---|
| **Équilibré** (par défaut) | 6,2 % | 3,2 % | 1,6 % | 0,2 % | 22,1 % | x4,0 | x29 |
| **Ouvert** | 3,4 % | 2,6 % | 1,9 % | 0,9 % | 37,7 % | x1,8 | x3,7 |
| **Compétitif** | 9,3 % | 3,4 % | 1,2 % | 0,1 % | 13,9 % | x8,0 | x107 |
| Équilibré sans réinvestissement | 4,3 % | 2,8 % | 1,8 % | 0,5 % | 31,6 % | x2,3 | x9,2 |
| Équilibré, réinvestissement +20 % | 7,1 % | 3,3 % | 1,4 % | 0,2 % | 19,8 % | x5,0 | x45 |
| Équilibré, réinvestissement +25 % | 8,2 % | 3,4 % | 1,3 % | 0,1 % | 16,0 % | x6,4 | x72 |
| Sans aucun bonus | 3,6 % | 2,7 % | 1,9 % | 0,5 % | 34,8 % | x1,8 | x6,7 |
| Équilibré, base 100 (100/200/300) | 6,2 % | 3,2 % | 1,6 % | 0,2 % | 22,8 % | x4,0 | x29 |
| Équilibré, 6/6/6 + 3 expert | 6,8 % | 3,1 % | 1,5 % | 0,2 % | 22,9 % | x4,4 | x28 |
| Équilibré, public homogène | 5,3 % | 2,8 % | 1,8 % | 0,5 % | 30,3 % | x3,0 | x12 |
| Équilibré, public très hétérogène | 6,1 % | 3,7 % | 1,4 % | 0,1 % | 17,0 % | x4,4 | x55 |

Chances égales pour tous : 2 % chacun. Les écarts sont des médianes sur les parties
simulées ; le « dernier » est le dernier joueur qui a au moins une bonne réponse (un joueur
à 0 TH n'a aucune chance).

## Ce qu'on en retient

- **Le réinvestissement est le réglage qui creuse vraiment l'écart.** De 0 à +25 %,
  l'écart entre le 1er et le dernier passe de x9 à x72, et les chances du 1er de 4,3 % à
  8,2 %.
- **Même très fort, le tirage reste ouvert.** 49 autres joueurs se partagent le reste : le
  favori reste sous 10 % de chances. Le classement final par TH récompense les meilleurs
  avec les autres lots.
- **Le bonus de rapidité** ne va qu'aux 3 premières bonnes réponses reçues par le serveur :
  +10 %, +5 %, +2 % du gain de base. Il départage, il ne fait pas le classement.
- **Le bonus de série** (+10 % par bonne réponse d'affilée, jusqu'à +50 %) pèse modérément.
  Le pousser beaucoup plus haut récompenserait surtout les séries parfaites : une seule
  erreur remettrait tout à zéro.
- **Base 10 ou base 100 : aucune différence.** Le tirage ne regarde que les parts de chacun.
  Le jeu est en base 10, avec des gains au dixième de TH près, et passe en PH au-delà de
  1 000 TH.
- **Le hashrate de départ** (profil Ouvert, 100 TH pour tous) rapproche tout le monde.

## Les trois profils

Choisis dans la console (Réglages, « Profil de points ») avant la 1re question. Chaque
champ reste modifiable à la main ensuite.

| Profil | Gains facile / moyenne / difficile / expert | Rapidité (1re, 2e, 3e… bonne réponse) | Série | Réinvestissement | Départ |
|---|---|---|---|---|---|
| Équilibré | 10 / 20 / 30 / 50 | +10 / +5 / +2 % | +10 % par réponse, max +50 % | +15 % | 0 |
| Ouvert | 10 / 20 / 30 / 50 | +5 / +3 / +1 % | +5 % par réponse, max +25 % | aucun | 100 TH |
| Compétitif | 10 / 20 / 30 / 50 | +10, +9, +8… +1 % (10 premiers) | +25 % par réponse, max +200 % | +25 % | 0 |

## Hypothèses de la simulation

Ce sont des hypothèses, pas des mesures.

- Chaque joueur a un niveau tiré au hasard (loi normale). La probabilité de bonne réponse
  dépend de l'écart entre son niveau et la difficulté, avec un plancher de 25 % (4 choix,
  on peut deviner). En moyenne : 85 % de bonnes réponses aux questions faciles, 62 % aux
  moyennes, 43 % aux difficiles, 33 % aux expert.
- Les bons joueurs répondent un peu plus vite. Temps de réponse médian : 6 s sur 20. Le
  bonus de rapidité va aux premières bonnes réponses, comme dans le jeu.
- 3 % des réponses manquent (distraction, téléphone verrouillé).
- « Public homogène » et « très hétérogène » font varier l'écart de niveau entre joueurs
  (la moitié et 1,6 fois celui des autres lignes).

Relancer : `npm run simulate` (50 joueurs, 4 000 parties par ligne, environ 20 s) ou
`npm run simulate -- 80 20000` (80 joueurs, 20 000 parties).
