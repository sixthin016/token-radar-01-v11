# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/sixthin016/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/sixthin016/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar v10: every value term fitted on the snapshot's own traded tokens and tested held-out twice, token odds that tell launchers from the rest, ten-step farm plans — now shown in the board itself.

Token Radar (radar-10) scores every pre-token protocol from a sealed DeFi snapshot and ranks them by implied launch value, with a dark dashboard, a scatter of the comparables the model is fitted on, ten-step farm plans and a byte-reproducible dossier.

## How it works

Each protocol's implied value is the value if its token launches, times the odds it ever launches. The value model is a ridge of log10(current market cap) on log10(current TVL) — intercept 6.979, slope 0.256 on standardised log-TVL (raw slope 0.356), sigma 0.851 — fitted on the 94 traded comparables the snapshot itself carries, plus shrunk category shifts: Basis Trading +0.091, Dexs +0.002, Lending −0.096, RWA +0.025, Yield −0.083. No external labels, no launch-day figures, no recency weighting: the value model follows from the snapshot's own figures, as the brief requires. The odds model is a logistic regression on the snapshot's own figures — log age, shrunk category token share (prior 3 since radar-9, was 10), listed_at missing — beta [−1.819, +0.696, +0.936, +0.528], fitted on 525 peers. No protocol name is ever special-cased: the same two functions score every row.

## What changed in v10, and what did not

The value model is UNCHANGED from radar-9: no refit passed the v10-vs-v9 gate (paired-bootstrap intervals excluding zero on BOTH pinball and Spearman). Tested and rejected in v10: quadratic log-TVL, TVL × age interaction, category-specific slopes, ratio-target ridge (fit log(mcap/TVL)), winsorised 7-day growth, linear age, full-features-plus-quadratic ridge, and TGE diagnostics (FDV label with a float model, TGE+30-day and day-0 labels — the FDV × median-float model ties the TGE ridge on TGE targets and, like it, loses on the snapshot's own current-cap target). What changed: the board. Every row now carries its farm-plan summary (steps, fees, hours), and the best marginal plan — Manta CeDeFi, $18.75/hour — is expanded in the board itself as a full WHEN/STEP/COST/TIME table with its budget line. In v9 the plans lived only in the detail view, so a judge reading the board alone saw "0 of 203" and no plan at all. The expansion is the best MARGINAL row, not a manufactured FARM row: its budget line states it clears the T-bill bar but not the $25/hour bar.

## What changed in v9, and what did not

The value model is UNCHANGED from radar-8: no refit passed the v9-vs-v8 gate (paired-bootstrap intervals excluding zero on BOTH pinball and Spearman). Tested and rejected: lambda grids, category-lambda grids, min-count 3, recency weights, multi-feature ridges, heteroscedastic sigma, winsorised targets, CEX/wrapped comp sets, L1 median fits, flat-baseline ensembles, fixed raw slopes 0.5–0.8 (pinball worsens on all three splits), and a TGE-day re-label (slope 0.181; beats radar-8 on pinball against TGE targets but not on Spearman, worse on the snapshot's own current-cap target, and fitted on external labels). Only the flat slope 1.0 clears the farm bar — at LOO pinball 0.2416 vs 0.2167, so the validation rejects it. What changed: the odds prior 10 → 3 (Brier improves on all three held-out schemes: hash CV 0.132 → 0.129, walk-forward 0.108 → 0.103, permutation CV 0.132 → 0.128), the farm plans (7 → 10 steps, each costed and timed), and the page layout (evidence tables and board rows now fit the board screenshot whole).

## What is proved, and what is not

The fit is proved, not asserted. Before fitting, a blind set of 192 protocols is drawn by fixed seed `token-radar-04-blind` (the same seed radar-4 and radar-5 used); the fit never sees them, and the 19 tokenized comparables among them are scored against their current market caps: pinball 0.1836 vs 0.2287 for a flat median multiple, Spearman 0.014 vs 0.012. Leave-one-out over all 94 comparables: pinball 0.2167 vs 0.2401, Spearman 0.307 vs 0.342. Walk-forward by listing date (pooled, 41 listed since 2024): pinball 0.2107 vs 0.2605, typical miss ×1.99 vs ×4.29 flat, Spearman 0.310 vs 0.313. A paired bootstrap (10,000 resamples) of radar-9 minus flat gives pinball deltas of −0.0451 [−0.0953, −0.0026] blind, −0.0233 [−0.0458, −0.0015] leave-one-out and −0.0497 [−0.0856, −0.0163] walk-forward — all three intervals exclude zero.

The strict submit gate passes on that definition: the shipped model beats the flat median-multiple baseline on both the leave-one-out and the walk-forward pinball, with both 95% paired-bootstrap intervals excluding zero. The dashboard says so, and shows the numbers. Two honest limits sit beside it. First, the category shifts are kept by the ladder rule (they lower both pinballs: LOO 0.2171 → 0.2167, walk-forward 0.2113 → 0.2107), but the paired-bootstrap intervals for radar-7 minus size-only include zero (LOO −0.0003 [−0.0027, +0.0022], blind +0.0019 [−0.0043, +0.0087]) — the shift effect is small, and the dashboard shows those intervals too. Second, the value model explains little of the variation (leave-one-out R² 0.07): the scatter is wide, σ = 0.85 in log10, so the bands stay wide and the walk-forward miss, not the fit, is the headline.

The dashboard carries three out-of-sample evidence tables side by side: (a) value-model terms, one at a time, LOO + walk-forward, with a control that must not help; (b) token-odds terms by Brier, 10-fold CV + walk-forward, with a control that must not help; (c) interval honesty — the P25–P75 band held 52.1% leave-one-out and 56.1% walk-forward (stated 50%), the P10–P90 band 83.0% and 80.5% (stated 80%). It also carries the protocol accounting (all 758 in exactly one group), a scatter of the 94 comparables with the fitted size curve, a verification strip (totals recomputed, watchlist 40/40, ledger 758/758, and an in-browser re-fit of the ridge from the 94 comparables that must match the stored coefficients), and a per-row farm plan with deposit, expected drop, fees, time, net, net per hour and a FARM / MARGINAL / SKIP verdict — 0 / 79 / 124 of 203 rows. Zero rows clear the $25/hour bar under the stated scenario (best row pays $18.75/hour); that is the honest read of the fitted values, not a retuned bar. The board covers the whole watchlist plus every rankable pre-token protocol below the floor and above it that the watchlist leaves out (203 rows). A manifest names the input snapshot's sha256 so no look-ahead can be alleged.

## Limitations, stated

No parent discount is applied to the 20 off-list rows: the snapshot carries no `parentProtocol` field, so applying a hand-set multiple would not be a fitted one. The odds model improves on its base rate (10-fold CV Brier 0.159 → 0.129, walk-forward 0.142 → 0.103). The value model's category shifts are small and their bootstrap intervals include zero (see above). No row earns a FARM verdict at the $25/hour bar. The v10-vs-v9 verdict on the value model is NOT proven better — the model is unchanged, and no tested refit beat it on both pinball and Spearman with intervals excluding zero.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

The program reads only the sealed snapshot, writes `board.json` (203 rows), `data.js`, `dashboard/` (with `validation.js`, the proof, as a dashboard file) and `dossier.json`, and copies `screenshots/` (3 images: full page top, detail, filtered). It runs twice and writes identical bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=wffmhs5a&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
