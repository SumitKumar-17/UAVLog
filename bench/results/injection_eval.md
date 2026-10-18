# Fault injection: rule detectors on 30 real flights

A constant fault value is held for the stated duration at a random time in the middle of a real flight; the unchanged rule engine then looks for the right event kind overlapping that window (1 s tolerance). Cells show the share of injected faults detected, with the median onset error in seconds. Controls are the same flights without injection. This tests the detectors' thresholds, minimum durations and sampling effects; it says nothing about whether the thresholds suit real faults.

| fault | rule minimum | 1 s | 2 s | 3 s | 5 s | 10 s | 20 s | false alarms on controls |
|---|---|---|---|---|---|---|---|---|
| battery critically low | 3 s | 0.07 (-100.4 s) | 0.07 (-199.8 s) | 0.07 (-103.2 s) | 0.90 (+0.1 s) | 0.97 (+0.1 s) | 0.97 (+0.1 s) | 0.23 of 30 |
| GPS lost 3D fix | 2 s | 0.00 | 0.00 | 0.83 (+0.1 s) | 0.90 (+0.1 s) | 0.97 (+0.1 s) | 0.97 (+0.1 s) | 0.03 of 30 |
| GPS accuracy degraded | 3 s | 0.00 | 0.00 | 0.00 | 0.90 (+0.1 s) | 0.90 (+0.1 s) | 0.93 (+0.1 s) | 0.03 of 30 |
| high vibration | 3 s | 0.03 (-36.2 s) | 0.03 (-55.6 s) | 0.03 (-74.7 s) | 0.93 (+0.6 s) | 1.00 (+0.6 s) | 1.00 (+0.6 s) | 0.03 of 29 |
| estimator rejecting position | 2 s | 0.00 | 0.00 | 0.93 (+0.1 s) | 0.97 (+0.1 s) | 1.00 (+0.1 s) | 1.00 (+0.1 s) | 0.07 of 30 |
