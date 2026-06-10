# The Price of Everything

An interactive explorer for UK consumer price inflation, built on the ONS
[consumer price inflation tables (MM23)](https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindices).
It uses **CPIH** — the Consumer Prices Index including owner occupiers' housing
costs, the ONS's lead measure of inflation.

**Live site:** https://matthewgthomas.github.io/price-changes/

## What it does

- **Drill into the full CPIH hierarchy** — 371 series: overall CPIH, 12 divisions,
  41 groups (including owner occupiers' housing costs), 71 classes and 192
  subclasses (down to rice, butter and package holidays), plus goods/services
  breakdowns and core-inflation aggregates.
- **Explore from any start month** since January 1988.
- **Three views of every series**: year-on-year change, cumulative change since
  your chosen start date, and the raw index level (2015 = 100).
- **Compare anything with overall CPIH**, with notable events (Black Wednesday,
  Covid lockdown, the 2022 energy shock…) marked on the chart.
- **Robo-journalism**: a deterministic narrative — peaks, troughs, deflation
  streaks, comparisons with headline CPIH — rewritten on the fly from whatever
  is currently selected. No AI involved, just arithmetic.
- Shareable URLs (the whole view lives in the hash), responsive layout and
  automatic dark mode.

## How it works

| Piece | What it does |
|---|---|
| [`scripts/prepare-cpi-data.R`](scripts/prepare-cpi-data.R) | Downloads MM23 from ONS, extracts every monthly `CPIH … 2015=100` index series, cleans names, derives the COICOP hierarchy and writes [`site/data/cpi.json`](site/data/cpi.json) |
| [`site/`](site/) | The website — plain HTML/CSS/JS (ES modules) with [D3](https://d3js.org/), no build step |
| [`.github/workflows/update-and-deploy.yml`](.github/workflows/update-and-deploy.yml) | Runs every Wednesday morning; when ONS has published new figures it commits the refreshed data and redeploys the site to GitHub Pages |

Annual rates are calculated from published index values, so they can differ
from ONS headline rates by ±0.1 percentage points. Some detailed series
(mostly subclasses) begin later than 1988.

## Develop locally

```sh
# Refresh the data (needs R)
Rscript scripts/prepare-cpi-data.R

# Serve the site
python3 -m http.server 8741 --directory site
# then open http://localhost:8741
```

## Data licence

Contains public sector information licensed under the
[Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Source: Office for National Statistics.

---

Earlier versions of this app (an R Shiny original and a SvelteKit rewrite)
live in [`archive/`](archive/).
