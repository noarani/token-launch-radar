[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/noarani/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/noarani/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar — model radar-3

A token launch radar for make.fun's `token-radar-01` bounty. It reads the sealed
DefiLlama snapshot (758 protocols, as of 2026-11-14), ranks the protocols that record
no token yet by an implied token value, and ships a static, offline dashboard with a
detail view and a concrete farm plan for every protocol.

## The board

- **198 rows**: every protocol whose snapshot record has no token (`mcap_usd`,
  `gecko_id` and `symbol` all null), excluding wrapped / staked / staking products,
  Bridge / Canonical Bridge / Liquid Staking / Liquid Restaking / Restaked BTC and
  CEX categories, exchange-named products, and versioned re-deployments (names ending
  in `V2`, `2.0`, …).
- **Watchlist coverage: 40 / 40** — every protocol on the snapshot's $50M watchlist is
  on the board.
- Top of the board under radar-3: Steakhouse Financial ≈ $235.8M, Sentora Curator
  ≈ $225.4M, Gauntlet ≈ $138.8M.

## The model (radar-3)

```
implied value = TVL × category multiple × growth factor × maturity factor × size factor
```

- **Category multiple** — geometric mean of `mcap / TVL` over live (token-bearing)
  protocols in the same category, winsorised to [0.01, 10], shrunk toward the global
  geometric-mean centre (0.230× on this snapshot) in log space with **k = 5**.
  Shrinkage applies whenever a category has at least one live comp — a single comp is
  pulled strongly toward the centre, which is the honest treatment for thin
  categories; only a category with no live comps uses the global centre outright.
  Each row also carries a p25/p75 range from the comp multiples.
- **Growth factor** — 7-day TVL change clamped to [−50%, +100%], applied linearly
  with weight 0.35: `1 + 0.35 × change`.
- **Maturity factor** — 0.70 for a newly tracked protocol, rising linearly to 1.00
  after two years tracked without a token.
- **Size factor** — market caps grow far slower than TVL (a pure multiple overvalues
  large protocols), so each TVL band's geometric-mean multiple is divided by the
  global centre and applied at **power 0.75**. Measured raw band ratios on this
  snapshot: ×1.76 (under $50M) / ×0.69 ($50M–$500M) / ×0.17 (over $500M).

radar-3 was selected by a chess-engine-style improvement loop: hypotheses were
measured on a holdout split of the live protocols and adopted only when they beat
the previous model (radar-2) on confirmation data.

## Measured accuracy (computed by the program itself, every run)

The program backtests itself on each run: the 128 live protocols are split by slug
hash (FNV-1a), 59 calibrate the model and the other 69 are hidden, predicted, and
scored. On this snapshot:

| Metric | radar-3 (this entry) |
| --- | --- |
| Median error vs actual market cap | ×3.24 |
| Predictions within 2× of actual | 27.5% |
| Spearman rank correlation | 0.386 |
| Bias | ×0.64 |

These numbers are printed in the dashboard's Method page from the program's own
computation — nothing is hardcoded. No launch-probability score is shown anywhere:
the snapshot contains no launch outcomes to fit or validate one against, so such a
number would be fabricated. The per-category figure shown in detail views is a
measured base rate (share of ≥$5M protocols in the category that already record a
token), labelled as such.

## Dashboard

Static and offline (`dashboard/index.html`, `app.css`, `app.js`; data arrives as
`data.js`, written by the program — no fetch, no network):

- **Board** — search, category / chain / TVL-band filters, watchlist-only toggle,
  five sort orders.
- **Detail view** — the full equation breakdown for the selected protocol, the
  calibration set behind it (comp count, p25/p75, confidence Low/Med/High from comp
  count and spread), the category base rate, and the 7-step farm plan with costs
  and time estimates.
- **Live tokens view** — the 128 token-bearing protocols set aside for calibration.
- **Method page** — the formula, the measured-accuracy panel, and a sandbox with
  two sliders (growth weight, size power) that re-prices the board with the same
  formula; at the defaults it reproduces `board.json` exactly.

## Run it

Node 22, standard library only:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

This writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` (via `buildDossier` from `vendor/makefun-board.ts`) into the output
directory. Two runs produce byte-identical output.

## Layout

- `main.ts` — entry point: snapshot in, board + dashboard data + dossier out.
- `lib/model.ts` — the radar-3 model, calibration, backtest, board validation.
- `vendor/makefun-board.ts` — the kit's dossier library (vendored, unmodified).
- `dashboard/` — the static page. `screenshots/` — captures of the shipped build.
- `board.json` — the board generated from the sealed snapshot.

## License

MIT — see `LICENSE`.
