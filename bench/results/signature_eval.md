# Flight signature sanity check

300 flights, 145 features reduced to 32 dimensions (86% of variance). Share of a flight's 5 nearest neighbours that run on the same board (leave-one-out):

| representation | same-board neighbours |
|---|---|
| chance (random neighbours) | 0.069 |
| scaled features, cosine | 0.253 |
| 32-dimension signature, cosine | 0.250 |

Fraction of a flight's 5 nearest neighbours that share its board, leave-one-out. A sanity check, not a ground truth: hardware influences sensor scale, so some agreement is expected.
