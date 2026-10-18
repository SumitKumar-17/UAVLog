# Retrieval evaluation (2026-10-18)

3846 events, 65 queries (39 hard) over 14 concepts; skipped (fewer than 5 relevant events): none. Embedding model openai/text-embedding-3-small. Mean over queries with 95% bootstrap CI.

## all queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.70 [0.61, 0.80] | 0.69 [0.59, 0.79] | 0.70 [0.60, 0.79] | 0.77 [0.67, 0.86] | 0.17 [0.09, 0.26] | 0.83 [0.79, 0.87] |
| rrf | 0.65 [0.55, 0.74] | 0.60 [0.51, 0.70] | 0.62 [0.53, 0.71] | 0.75 [0.66, 0.85] | 0.18 [0.09, 0.28] | 0.82 [0.78, 0.86] |
| vector | 0.72 [0.62, 0.81] | 0.69 [0.59, 0.79] | 0.70 [0.60, 0.80] | 0.75 [0.64, 0.84] | 0.20 [0.11, 0.29] | 0.84 [0.79, 0.88] |
| fts | 0.47 [0.37, 0.57] | 0.48 [0.38, 0.59] | 0.48 [0.38, 0.58] | 0.55 [0.44, 0.66] | 0.28 [0.17, 0.38] | 0.74 [0.70, 0.79] |

## easy queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.88 [0.78, 0.98] | 0.87 [0.75, 0.96] | 0.88 [0.78, 0.96] | 0.95 [0.86, 1.00] | 0.00 [0.00, 0.00] | 0.82 [0.75, 0.88] |
| rrf | 0.90 [0.80, 0.98] | 0.84 [0.72, 0.94] | 0.86 [0.76, 0.94] | 0.95 [0.86, 1.00] | 0.04 [0.00, 0.12] | 0.79 [0.73, 0.85] |
| vector | 0.90 [0.80, 0.98] | 0.87 [0.75, 0.96] | 0.88 [0.77, 0.97] | 0.94 [0.84, 1.00] | 0.04 [0.00, 0.12] | 0.83 [0.76, 0.89] |
| fts | 0.75 [0.61, 0.88] | 0.73 [0.60, 0.86] | 0.73 [0.59, 0.86] | 0.78 [0.64, 0.90] | 0.00 [0.00, 0.00] | 0.71 [0.64, 0.78] |

## hard queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.58 [0.44, 0.72] | 0.57 [0.44, 0.71] | 0.58 [0.44, 0.71] | 0.65 [0.51, 0.79] | 0.28 [0.15, 0.44] | 0.84 [0.79, 0.89] |
| rrf | 0.48 [0.36, 0.61] | 0.44 [0.32, 0.56] | 0.46 [0.34, 0.58] | 0.63 [0.48, 0.76] | 0.28 [0.15, 0.44] | 0.83 [0.78, 0.88] |
| vector | 0.59 [0.45, 0.73] | 0.58 [0.43, 0.72] | 0.58 [0.44, 0.72] | 0.62 [0.49, 0.76] | 0.31 [0.18, 0.46] | 0.85 [0.78, 0.90] |
| fts | 0.29 [0.17, 0.42] | 0.32 [0.21, 0.43] | 0.32 [0.21, 0.44] | 0.40 [0.27, 0.54] | 0.46 [0.31, 0.62] | 0.77 [0.71, 0.82] |

Paired nDCG@10 difference, rrf minus vector: -0.077 [-0.142, -0.022] over 65 queries
Paired nDCG@10 difference, hybrid minus vector: -0.000 [-0.013, +0.012] over 65 queries
Paired nDCG@10 difference, hybrid minus rrf: +0.077 [+0.027, +0.136] over 65 queries
Paired nDCG@10 difference, hybrid minus fts: +0.218 [+0.137, +0.305] over 65 queries

## Per concept (mean nDCG@10)

| concept | relevant events | rrf | hybrid | vector | fts |
|---|---|---|---|---|---|
| motor | 11 | 0.41 | 0.52 | 0.52 | 0.37 |
| attitude | 101 | 0.51 | 0.59 | 0.59 | 0.40 |
| gps | 30 | 0.57 | 0.59 | 0.59 | 0.46 |
| battery | 171 | 0.54 | 0.68 | 0.68 | 0.52 |
| vibration | 102 | 0.65 | 0.63 | 0.62 | 0.67 |
| estimator | 302 | 0.73 | 0.84 | 0.88 | 0.71 |
| failsafe | 277 | 0.38 | 0.67 | 0.67 | 0.21 |
| takeoff | 292 | 0.89 | 1.00 | 1.00 | 0.75 |
| landing | 277 | 0.64 | 0.75 | 0.75 | 0.48 |
| arming | 326 | 0.75 | 0.75 | 0.75 | 0.50 |
| mode | 960 | 0.99 | 1.00 | 1.00 | 0.76 |
| compass | 37 | 0.67 | 0.74 | 0.77 | 0.33 |
| sensor | 109 | 0.63 | 0.71 | 0.70 | 0.28 |
| rc | 14 | 0.44 | 0.43 | 0.38 | 0.27 |

## Fusion weight sensitivity (nDCG@10, mean [95% CI])

| full-text weight | all | easy | hard |
|---|---|---|---|
| 0 | 0.700 [0.597, 0.794] | 0.880 [0.771, 0.968] | 0.579 [0.440, 0.719] |
| 0.1 | 0.701 [0.603, 0.801] | 0.885 [0.788, 0.965] | 0.578 [0.432, 0.714] |
| 0.25 | 0.699 [0.604, 0.794] | 0.881 [0.780, 0.964] | 0.579 [0.438, 0.715] |
| 0.5 | 0.692 [0.595, 0.788] | 0.874 [0.769, 0.959] | 0.572 [0.430, 0.709] |
| 1 | 0.622 [0.518, 0.709] | 0.861 [0.757, 0.946] | 0.463 [0.342, 0.585] |

Leave-one-concept-out selected weight: mean nDCG@10 0.695 [0.593, 0.792] (vector-only 0.700, plain RRF 0.622); weights chosen per held-out concept: [0.0, 0.1, 0.25]

## Human-label case study (flight level, default hybrid)

Flights a person labelled, ranked by their best-matching event; random chance for top-10 is 10 of N flights. Small n: a case study, not a statistic.

| label | labelled flights | in top 10 | in top 20 | median rank | never retrieved |
|---|---|---|---|---|---|
| error label Vibration ("excessive vibration") | 5 | 0 | 1 | 52.0 | 1 |
| error label Component-failure ("motor or component failure") | 1 | 0 | 0 | 80.0 | 0 |
| error label Sensor-error ("sensor fault, unhealthy sensor") | 1 | 0 | 0 | 54.0 | 0 |
| feedback mentions crash ("vehicle crashed and lost control") | 7 | 2 | 2 | 141.0 | 1 |

300 flights in total.
