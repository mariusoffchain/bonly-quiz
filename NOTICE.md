# Crédits et licences

## Ce projet

`bonly-quiz` est distribué sous licence GNU AGPL-3.0-or-later (voir `LICENSE`).
Il ne mine aucun bitcoin : le hashrate des joueurs est fictif, et les « blocs » de fin de
partie sont des tirages au sort pondérés par ce hashrate. Les hashs affichés sont décoratifs.

## Plan B Network / Plan B Academy

Les questions des packs `content/questions/bonly-21-fr.json` et
`content/questions/planb-btc101-fr.json` proviennent du dépôt
[PlanB-Network/bitcoin-educational-content](https://github.com/PlanB-Network/bitcoin-educational-content)
(quiz de fin de leçon des cours de la Plan B Academy : btc101, btc102, btc202, his201,
min101, min304, cyp201), licence
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Chaque question garde son
auteur, son identifiant et son lien dans le champ `source`. Les questions et les réponses
sont reprises telles quelles ; seuls l'ordre des réponses et les liens markdown des
explications (réduits à leur texte) changent. Deux explications ont été réécrites, signalées
par « explication réécrite » dans `source.note` : El Salvador (le pays est revenu en 2025
sur une partie de sa loi bitcoin) et Hashcash (la preuve de travail est antérieure à
Hashcash). Toute redistribution de ces packs doit conserver l'attribution et la même
licence.

## B-Only

L'identité visuelle (couleurs, typographie, filets, trame de points) reprend celle du site
[b-only.org](https://b-only.org/). L'illustration `src/client/assets/mountains.webp`
provient de ce site et a été fournie par l'organisation de B-Only (association AlpineChain)
pour ce quiz ; elle n'est pas couverte par la licence AGPL du code.

## Polices

JetBrains Mono et Silkscreen sont chargées depuis Google Fonts (SIL Open Font License).
