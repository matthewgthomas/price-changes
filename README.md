# Price changes

Interactive Svelte 5 site that explores how UK consumer prices have shifted over time using the consumer price index (CPI).

## Getting started

```bash
npm install
npm run dev -- --open
```

The project uses [SvelteKit](https://kit.svelte.dev/) with the static adapter, so the site can be fully prerendered and hosted on GitHub Pages or any static host.

## Building and deploying

```
npm run build
```

The static site is emitted to the `build/` directory. You can publish that directory to a `gh-pages` branch or enable GitHub Pages to serve it. Because the kit layout is marked `prerender`, no server is required once the bundle is built.

If you are publishing to a sub-path (for example, GitHub Pages at `/price-changes`), set a `BASE_PATH` environment variable during `npm run build` so assets resolve correctly:

```
BASE_PATH=/price-changes npm run build
```

## Data

CPI data lives in `static/data/cpi_components.csv` and is loaded on the client at runtime. To refresh the dataset, run the R helper script:

```r
source("scripts/update-cpi.R")
```

It downloads the latest CPI release from the Office for National Statistics and rewrites the CSV in `static/data/`.
