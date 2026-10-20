# Crédits et licences

## Ce projet

`bonly-quiz` est distribué sous licence GNU AGPL-3.0-or-later (voir `LICENSE`).
Il ne mine aucun bitcoin : le hashrate des équipes est fictif, seuls les blocs affichés
proviennent du réseau Bitcoin réel via l'API publique de mempool.space.

## The Mempool Open Source Project

La direction visuelle (variables de couleurs, forme des blocs en 3D, présentation des
pools) est adaptée du frontend de [mempool/mempool](https://github.com/mempool/mempool),
Copyright (c) 2019-2026 Mempool Holdings S.A. de C.V. and other shadowy super-coders,
licence GNU AGPL-3.0-or-later. Fichiers concernés :

- `src/client/styles/tokens.css` (variables adaptées de `frontend/src/styles.scss`)
- `src/client/styles/app.css`, section « 3D blocks » (adaptée de
  `frontend/src/app/components/blockchain-blocks/blockchain-blocks.component.scss`)

Aucun logo, marque ou nom de produit de Mempool Holdings n'est utilisé. « mempool.space »
n'apparaît que pour désigner la source des données de blocs, conformément à la
[politique de marques](https://mempool.space/trademark-policy).

## Plan B Network / Plan B Academy

Les questions provisoires du pack `content/questions/planb-btc101-fr.json` proviennent du
dépôt [PlanB-Network/bitcoin-educational-content](https://github.com/PlanB-Network/bitcoin-educational-content)
(quiz de fin de leçon du cours btc101, « Votre première aventure avec Bitcoin »), licence
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Chaque question garde son
auteur, son identifiant et son lien dans le champ `source`. Toute redistribution de ce pack
doit conserver l'attribution et la même licence.

## Polices

Inter et JetBrains Mono sont chargées depuis Google Fonts (SIL Open Font License).
