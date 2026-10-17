# Fair Queue strategy comparison

Synthetic controlled simulation; no production event replay is claimed. See methodology in the integration ADR.

| Strategy / execution model | Continuous arrivals | Mean wait min | P95 wait min | Max min | Unserved (first) | Max censored age min | Avoidable repeats | Position shifts |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| baseline / full-sort-each-turn | false | 29.65 | 84.00 | 96.00 | 0 (0) | 0.00 | 0 | 158 |
| baseline / full-sort-each-turn | true | 83.20 | 96.00 | 96.00 | 32 (32) | 96.00 | 0 | 484 |
| baseline / stable-insert | false | 29.65 | 96.00 | 96.00 | 0 (0) | 0.00 | 0 | 139 |
| baseline / stable-insert | true | 83.20 | 111.00 | 204.00 | 32 (32) | 96.00 | 0 | 409 |
| fair-share / full-sort-each-turn | false | 29.65 | 96.00 | 96.00 | 0 (0) | 0.00 | 0 | 240 |
| fair-share / full-sort-each-turn | true | 0.00 | 0.00 | 0.00 | 32 (0) | 540.00 | 0 | 5488 |
| fair-share / stable-insert | false | 29.65 | 96.00 | 96.00 | 0 (0) | 0.00 | 0 | 240 |
| fair-share / stable-insert | true | 0.00 | 0.00 | 0.00 | 32 (0) | 540.00 | 0 | 5488 |
| hybrid / full-sort-each-turn | false | 29.65 | 102.00 | 114.00 | 0 (0) | 0.00 | 0 | 136 |
| hybrid / full-sort-each-turn | true | 83.20 | 96.00 | 135.00 | 32 (32) | 96.00 | 0 | 453 |
| hybrid / stable-insert | false | 29.65 | 96.00 | 96.00 | 0 (0) | 0.00 | 0 | 169 |
| hybrid / stable-insert | true | 83.20 | 123.00 | 162.00 | 32 (32) | 96.00 | 0 | 376 |

Raw distributions, first/later waits, foreign-song gaps, threshold sensitivity and engine timings: `.artifacts/fair-queue-comparison.json`. This fixed workload does not establish universal dominance. Median/P90/P95, censored/unserved requests and first/later groups must be read together. Position shifts measure absolute index changes at admission in the selected execution model; constrained insertion preserves existing relative pairs. Waiting is admission to service start, excluding service duration.

Full-sort-each-turn assumes explicit global re-sorting after every service/admission; stable-insert models normal automatic admissions without those global sorts or invented operator choices. The two models are separate. All strategies use the same exogenous arrivals within each model.

## First versus later performances (completed requests only)

| Strategy / execution model | Continuous | First median / P95 / max min | Later median / P95 / max min | Foreign-performance gap P95 / max |
|---|---|---:|---:|---:|
| baseline / full-sort-each-turn | false | n=16: 36.00 / 84.00 / 84.00 | n=86: 12.00 / 90.00 / 96.00 | 47 / 53 |
| baseline / full-sort-each-turn | true | n=148: 96.00 / 96.00 / 96.00 | n=32: 48.00 / 96.00 / 96.00 | 1 / 1 |
| baseline / stable-insert | false | n=16: 18.00 / 36.00 / 36.00 | n=86: 12.00 / 96.00 / 96.00 | 47 / 51 |
| baseline / stable-insert | true | n=148: 96.00 / 96.00 / 96.00 | n=32: 78.00 / 198.00 / 204.00 | 30 / 31 |
| fair-share / full-sort-each-turn | false | n=16: 0.00 / 0.00 / 0.00 | n=86: 24.00 / 96.00 / 96.00 | 47 / 47 |
| fair-share / full-sort-each-turn | true | n=180: 0.00 / 0.00 / 0.00 | n=0: 0.00 / 0.00 / 0.00 | 0 / 0 |
| fair-share / stable-insert | false | n=16: 0.00 / 0.00 / 0.00 | n=86: 24.00 / 96.00 / 96.00 | 47 / 47 |
| fair-share / stable-insert | true | n=180: 0.00 / 0.00 / 0.00 | n=0: 0.00 / 0.00 / 0.00 | 0 / 0 |
| hybrid / full-sort-each-turn | false | n=16: 30.00 / 54.00 / 54.00 | n=86: 12.00 / 105.00 / 114.00 | 47 / 51 |
| hybrid / full-sort-each-turn | true | n=148: 96.00 / 96.00 / 96.00 | n=32: 57.00 / 129.00 / 135.00 | 12 / 13 |
| hybrid / stable-insert | false | n=16: 15.00 / 27.00 / 27.00 | n=86: 12.00 / 96.00 / 96.00 | 47 / 51 |
| hybrid / stable-insert | true | n=148: 96.00 / 96.00 / 96.00 | n=32: 81.00 / 156.00 / 162.00 | 22 / 24 |

## Protection sensitivity (synthetic continuous arrivals)

| Frozen-roster multiplier | First P95 min | Later P95 min | Max wait min | Unserved | Max censored age min |
|---|---:|---:|---:|---:|---:|
| 0.5 | 96 | 108.00 | 120.00 | 32 | 96 |
| 1 | 96 | 129.00 | 135.00 | 32 | 96 |
| 2 | 96 | 171.00 | 186.00 | 32 | 96 |

## Pure engine load (sort plus constrained insert, ten samples; two active songs per identity)

| Approved rows | Nearest-rank P95 ms |
|---|---:|
| 20 | 0.096 |
| 50 | 0.576 |
| 100 | 1.145 |
| 1000 | 64.329 |

The hybrid is a conservative policy candidate, not an empirical winner on every metric. It retains true completed rounds and grants a separate, auditable protection lane after an observed roster cycle. The fair-share comparison can report excellent served-only latency while repeatedly bypassing old second songs; censored age exposes that failure. The hybrid can worsen newcomer and maximum wait. A finite simulation cannot prove eventual service under unlimited arrivals. No strategy can empty a queue whose arrival rate exceeds service. Synthetic service duration is fixed for comparability and is never an algorithm input.
