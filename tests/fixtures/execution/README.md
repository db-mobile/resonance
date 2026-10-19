# Execution migration fixtures

These JSON fixtures are independent of frontend assets and executable by Rust.
They preserve behavior from the JavaScript runner/editor before its orchestration
was removed; they are not regenerated from the Rust implementation.

| Fixture | Source and verification |
| --- | --- |
| `request-preparation.json` | Captured request configurations from the original 90-test RunnerService suite. Compared by `baseline_preparation.rs`. The expired-OAuth preparation case supplies the captured refreshed auth; token renewal itself is exercised against HTTP in `lifecycle.rs`. |
| `editor-runner.json` | Five original editor/runner golden comparisons. Inputs are also checked by the frontend capture test; Rust checks preparation, Boa mutations, cookies, mock routing, and certificate selection. The mock cookie case includes a cookie for the mock host, matching the original mocked jar response. |
| `request-mutations.json` | Captured outputs of the original RequestBuilderService script-parameter and cross-origin credential tests, while all 33 original tests passed. Rust checks parameter normalization, URL rebuilding, mock paths, explicit overrides, origin comparison, and credential removal. The captured UUID is substituted in the fixture harness; dynamic caching is independently tested. |
| `runner.json` | Runner behavior scenarios translated from the original scheduler, runner, and script-scope tests. Executed with real Boa scripts and a local HTTP server, covering loops, duplicate entries, cross-collection state, iterations/data, skips, failures, and limits. |
| `variables.json` | Variable substitution expectations, including recursion, unresolved values, and typed values. |

Adapter tests remain in Jest for input capture, persistence ordering/failures,
secret handling, schema validation, rendering, history/report formats, saved and
unsaved runners, IPC cleanup, and stale-event suppression. Lifecycle tests await
actual Boa workers as well as execution futures, so cancellation tests cannot
pass merely by abandoning a still-running worker.

`template-capture.json` and `manual-capture.json` pin the desktop capture boundary
before a future Rust file-loader port. Expected templates were captured from
`captureRunnerEntry` and `captureManual`, using synthetic credentials and inputs.
They cover saved/example fallbacks, all body modes, duplicate and disabled rows,
empty/nonempty overrides, closest-first inherited auth, mock URLs, missing targets,
and unsaved editor state. Jest compares the adapters against these fixed outputs;
a future loader should consume these same fixtures rather than regenerate them.
Secret hydration remains a desktop repository responsibility and is tested in
`CollectionRepository.authSecrets.test.js`.
