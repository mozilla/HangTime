# bhr-dashboard

A web dashboard for exploring Firefox **BHR (Background Hang Reporter)** data: the
daily-aggregated hang samples collected from Firefox users, used by the Performance
team to find and triage main-thread hangs.

This is a from-scratch successor to [fqueze/hang-stats](https://github.com/fqueze/hang-stats),
rebuilt so the dashboard can grow into a multi-view analytics product (timeseries,
per-site attribution, regression alerts) without carrying the old tool's constraints.

> **Status: v1 explorer working.** Reaches feature parity with hang-stats — an
> interactive call-tree-style hang explorer over the daily artifact — on a refined UI.
> Timeseries support (per-hang prevalence over time) is the next milestone.

## What it does

BHR ships symbolicated, sampled stacks from Firefox to Mozilla's telemetry pipeline.
A daily aggregation job (now running out of `mozilla-central`, via `./mach bhr-aggregate`)
reduces those samples into a compact, per-day profile artifact. This dashboard loads
that artifact and lets you:

- Browse the day's hang signatures, ranked by total hang time.
- Inspect any hang's full symbolicated stack and its annotation breakdown.
- Filter signatures by function or library name.
- See hangs merged by known Bugzilla bug (`[bhr:…]` whiteboard tags).
- Share a view via URL-encoded state.

## Data

The dashboard consumes the aggregation job's output: a columnar, Firefox-Profiler-style
profile. Per thread: `stringArray`, `stackTable` (parent-`prefix` linked list rooted at
`(root)`), `funcTable`, `sampleTable`, `annotationsTable`, `dates[]`, and `libs[]`; plus
top-level `usageHoursByDate`. See `src/data/schema.ts` for the typed shape.

The aggregation job already applies the stack-trimming **signature heuristics** upstream
(`toolkit/components/backgroundhangmonitor/aggregation/heuristics.py`), so the frontend
treats the stored stack as authoritative and does **not** re-trim. It still performs the
two merge passes hang-stats always did: dedup identical stacks (across runnable /
annotation / platform variants) and merge hangs that match the same Bugzilla bug.

## Architecture

Layered, with each layer swappable:

- **`src/data/`** — `dataSource.ts` is the single point of artifact access (local files
  in dev, the TaskCluster index URL in prod via `VITE_DATA_BASE`); `schema.ts` types the
  profile; `bugs.ts` fetches the Bugzilla bug list (best-effort).
- **`src/processing/`** — heavy compute (stack reconstruction, signature merge) runs in a
  **Web Worker** (`worker.ts` + Comlink) so the main thread stays responsive on
  production-scale artifacts. `process.ts` holds the pure logic; `select.ts` does
  main-thread filtering/frame resolution.
- **`src/queries/`** — [TanStack Query](https://tanstack.com/query) hooks own all async
  fetching + caching, keyed by `(thread, date)`.
- **`src/state/useViewState.ts`** — view + filter state lives in the URL (via the router),
  so every view is a shareable permalink.
- **`src/views/`, `src/components/`** — React + TypeScript UI.

Charts (for the upcoming timeseries work) use **Chart.js** behind a swappable component.

## Tech stack

Vite · React · TypeScript · TanStack Query · React Router · Web Worker (Comlink) · Chart.js.

## Development

```bash
npm install
# Stage a daily artifact for the dev server (any new-job bhr-aggregate output):
mkdir -p public/data
cp /path/to/hangs_main_<date>.json public/data/hangs_main_current.json
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # typecheck + production build to dist/
npm run typecheck    # tsc only
npm run verify       # real-browser smoke test (needs `npm run preview` running)
npm run verify:history # offline history/trend regressions using production stacks
```

`npm run verify` via `puppeteer-core` to load the built
app, wait for the hang table to render, and report any console errors — a quick
end-to-end check that fetch → worker → React all work.

## License

[MPL-2.0](LICENSE)
