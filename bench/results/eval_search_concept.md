# Retrieval evaluation (2026-10-18)

3401 events, 65 concept queries (39 hard) over 14 concepts, plus 10 keyword lookups reported separately; skipped (fewer than 5 relevant events): none. Embedding model openai/text-embedding-3-small. Mean over queries with 95% bootstrap CI.

## all queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.72 [0.62, 0.82] | 0.70 [0.60, 0.79] | 0.71 [0.61, 0.80] | 0.77 [0.67, 0.86] | 0.17 [0.09, 0.26] | 0.86 [0.82, 0.90] |
| rrf | 0.62 [0.52, 0.72] | 0.58 [0.49, 0.68] | 0.60 [0.50, 0.69] | 0.73 [0.64, 0.82] | 0.17 [0.08, 0.26] | 0.84 [0.80, 0.87] |
| vector | 0.73 [0.63, 0.82] | 0.70 [0.60, 0.80] | 0.71 [0.61, 0.81] | 0.77 [0.66, 0.86] | 0.18 [0.09, 0.28] | 0.86 [0.82, 0.90] |
| fts | 0.47 [0.36, 0.57] | 0.48 [0.38, 0.59] | 0.48 [0.38, 0.58] | 0.53 [0.43, 0.64] | 0.29 [0.18, 0.42] | 0.71 [0.65, 0.77] |

## easy queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.91 [0.82, 0.98] | 0.87 [0.75, 0.96] | 0.89 [0.79, 0.97] | 0.97 [0.91, 1.00] | 0.00 [0.00, 0.00] | 0.86 [0.79, 0.92] |
| rrf | 0.87 [0.76, 0.96] | 0.84 [0.73, 0.93] | 0.86 [0.75, 0.94] | 0.95 [0.86, 1.00] | 0.00 [0.00, 0.00] | 0.82 [0.76, 0.87] |
| vector | 0.92 [0.82, 1.00] | 0.87 [0.75, 0.95] | 0.89 [0.79, 0.97] | 0.97 [0.90, 1.00] | 0.00 [0.00, 0.00] | 0.85 [0.78, 0.92] |
| fts | 0.74 [0.59, 0.87] | 0.73 [0.60, 0.87] | 0.73 [0.58, 0.85] | 0.77 [0.64, 0.89] | 0.04 [0.00, 0.12] | 0.71 [0.62, 0.79] |

## hard queries

| mode | P@5 | P@10 | nDCG@10 | MRR | miss rate | distinct flights/10 |
|---|---|---|---|---|---|---|
| hybrid | 0.59 [0.45, 0.73] | 0.59 [0.45, 0.72] | 0.59 [0.45, 0.72] | 0.64 [0.49, 0.78] | 0.28 [0.15, 0.44] | 0.87 [0.82, 0.91] |
| rrf | 0.46 [0.33, 0.58] | 0.41 [0.29, 0.54] | 0.43 [0.32, 0.55] | 0.58 [0.45, 0.72] | 0.28 [0.15, 0.44] | 0.85 [0.80, 0.89] |
| vector | 0.60 [0.46, 0.74] | 0.59 [0.45, 0.72] | 0.59 [0.45, 0.73] | 0.64 [0.50, 0.78] | 0.31 [0.18, 0.46] | 0.86 [0.81, 0.91] |
| fts | 0.29 [0.17, 0.42] | 0.32 [0.20, 0.44] | 0.31 [0.20, 0.43] | 0.37 [0.25, 0.50] | 0.46 [0.31, 0.62] | 0.71 [0.62, 0.79] |

Paired nDCG@10 difference, rrf minus vector: -0.109 [-0.172, -0.051] over 65 concept queries
Paired nDCG@10 difference, hybrid minus vector: -0.001 [-0.006, +0.003] over 65 concept queries
Paired nDCG@10 difference, hybrid minus rrf: +0.108 [+0.051, +0.173] over 65 concept queries
Paired nDCG@10 difference, hybrid minus fts: +0.232 [+0.153, +0.319] over 65 concept queries

## Per concept (mean nDCG@10)

| concept | relevant events | rrf | hybrid | vector | fts |
|---|---|---|---|---|---|
| motor | 11 | 0.41 | 0.52 | 0.52 | 0.37 |
| attitude | 101 | 0.49 | 0.60 | 0.60 | 0.40 |
| gps | 30 | 0.57 | 0.59 | 0.59 | 0.49 |
| battery | 172 | 0.52 | 0.77 | 0.77 | 0.52 |
| vibration | 101 | 0.66 | 0.67 | 0.67 | 0.64 |
| estimator | 212 | 0.60 | 0.85 | 0.87 | 0.57 |
| failsafe | 276 | 0.37 | 0.67 | 0.67 | 0.20 |
| takeoff | 292 | 0.89 | 1.00 | 1.00 | 0.75 |
| landing | 277 | 0.64 | 0.75 | 0.75 | 0.50 |
| arming | 326 | 0.73 | 0.75 | 0.75 | 0.53 |
| mode | 960 | 0.99 | 1.00 | 1.00 | 0.78 |
| compass | 37 | 0.62 | 0.77 | 0.78 | 0.34 |
| sensor | 57 | 0.59 | 0.67 | 0.67 | 0.29 |
| rc | 13 | 0.41 | 0.40 | 0.38 | 0.27 |
| kw_ekf2 | 49 | 1.00 | 1.00 | 1.00 | 1.00 |
| kw_imu | 19 | 1.00 | 1.00 | 1.00 | 0.93 |
| kw_health | 331 | 1.00 | 1.00 | 1.00 | 1.00 |
| kw_commander | 146 | 1.00 | 1.00 | 1.00 | 0.81 |
| kw_mavlink | 52 | 1.00 | 1.00 | 1.00 | 1.00 |

## Fusion weight sensitivity (nDCG@10, mean [95% CI])

| full-text weight | all | easy | hard |
|---|---|---|---|
| 0 | 0.710 [0.610, 0.802] | 0.889 [0.784, 0.970] | 0.590 [0.450, 0.733] |
| 0.1 | 0.709 [0.613, 0.801] | 0.888 [0.793, 0.966] | 0.589 [0.445, 0.723] |
| 0.25 | 0.699 [0.604, 0.794] | 0.878 [0.778, 0.959] | 0.581 [0.441, 0.715] |
| 0.5 | 0.685 [0.585, 0.781] | 0.875 [0.774, 0.958] | 0.558 [0.418, 0.699] |
| 1 | 0.600 [0.496, 0.691] | 0.855 [0.751, 0.944] | 0.431 [0.314, 0.552] |

Leave-one-concept-out selected weight: mean nDCG@10 0.708 [0.609, 0.803] (vector-only 0.710, plain RRF 0.600); weights chosen per held-out concept: [0.0, 0.1]

## Keyword lookups (exact module tags; nDCG@10, mean [95% CI] by full-text weight)

| full-text weight | nDCG@10 | P@10 | MRR |
|---|---|---|---|
| 0 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| 0.1 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| 0.25 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| 0.5 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
| 1 | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] | 1.000 [1.000, 1.000] |
Paired nDCG@10 difference on keyword lookups, weight 0.25 minus vector-only: +0.000 [+0.000, +0.000] over 10 queries
Paired nDCG@10 difference on keyword lookups, weight 1 minus vector-only: +0.000 [+0.000, +0.000] over 10 queries

## Human-label case study (flight level, default hybrid)

Flights a person labelled, ranked by their best-matching event; random chance for top-10 is 10 of N flights. Small n: a case study, not a statistic.

| label | labelled flights | in top 10 | in top 20 | median rank | never retrieved |
|---|---|---|---|---|---|
| error label Vibration ("excessive vibration") | 5 | 0 | 1 | 82.0 | 0 |
| error label Component-failure ("motor or component failure") | 1 | 0 | 0 | 115.0 | 0 |
| error label Sensor-error ("sensor fault, unhealthy sensor") | 1 | 0 | 0 | 51.0 | 0 |
| feedback mentions crash ("vehicle crashed and lost control") | 7 | 0 | 1 | 121.0 | 1 |

300 flights in total.
