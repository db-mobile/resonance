# Runner capture measurements

Native batching replaces repeated collection IPC reads and full-tree clones with
one selected-target snapshot per run. The optimization is retained: the measured
capture improvement exceeds the observed variance and existing capture fixtures
and execution tests pass.

## Synthetic capture benchmark

Measured on 2026-10-28 with Node 22.21.1. Five fresh Node processes per version,
queue size and cache state; explicit GC before timing. Before and after used the
same HTTP request fixtures, JSON serialization transport, and capture result hash.
The baseline was bundled from the pre-change service and repositories. Counts
include collection, endpoint-data and variable reads; scripts/keychain are absent.
Warm runs preload collection metadata and variables before timing.

| Requests | Cache | Median before → after | Before range | After range | IPC calls before → after | Payload before → after | Median peak RSS before → after |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | Cold | 23.74 → 2.57 ms | 22.70–28.83 ms | 2.46–2.65 ms | 301 → 1 | 1,715,602 → 27,486 B | 58.9 → 47.1 MiB |
| 100 | Warm | 20.25 → 2.57 ms | 17.69–25.85 ms | 2.50–2.81 ms | 200 → 1 | 857,900 → 27,486 B | 57.3 → 47.2 MiB |
| 1,000 | Cold | 1,651.33 → 16.93 ms | 1,621.28–1,675.62 ms | 16.45–18.61 ms | 3,001 → 1 | 175,556,002 → 277,686 B | 475.5 → 53.3 MiB |
| 1,000 | Warm | 1,162.56 → 17.83 ms | 1,129.15–1,186.01 ms | 16.82–19.06 ms | 2,000 → 1 | 87,779,000 → 277,686 B | 343.8 → 53.5 MiB |

These timings measure JavaScript capture with a modeled IPC transport, **not** a
live WebView, filesystem latency, keychain latency or HTTP execution. RSS includes
the Node process and is not an application memory measurement. All captured output
hashes matched between versions for each queue size.

Run a current sample with:

```sh
node --expose-gc scripts/benchmark-runner-capture.mjs 1000 cold
```

Repeat for 100/1000 and cold/warm, using a fresh process each time. To compare a
baseline, bundle exports of `CoreExecutionService`, `CollectionRepository` and
`VariableRepository` from the baseline checkout into one Node ESM file with
esbuild, then pass its absolute path as the third argument. Alternate baseline
and current runs to reduce order effects. Compare hashes before comparing times.

## Regression guards

- JavaScript tests assert one snapshot IPC call and no individual collection,
  endpoint, script or variable reads for 100 targets, with auth/variable hydration.
- Native tests assert one loader invocation per distinct collection, deduplicated
  targets, nested auth ancestry, legacy fallback precedence and capture freshness.
- Capture/parity fixtures and runner tests guard the request inputs independently
  of performance. Pending editor-save work is excluded from operation budgets.
