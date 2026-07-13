# Scripting Reference

Resonance runs pre-request and test scripts in a sandboxed JavaScript engine
([Boa](https://boajs.dev/)) embedded in the Rust backend. Scripts have no access
to the filesystem, the DOM, or browser APIs — the globals documented here are
the entire API surface.

- **Pre-request scripts** run before the request is sent and can mutate the
  outgoing request and environment variables.
- **Test scripts** run after the response arrives and can assert on it, extract
  data, and update environment variables.
- The **collection runner** executes each request's test script after the
  response, using the same engine.

Script output (console logs, test results, errors) appears in the **Scripts**
response tab.

## Execution model

Scripts execute synchronously, top to bottom. There is no event loop:
`setTimeout`, Promises that need scheduling, `fetch`, and `require` are not
available. `sendRequest` (below) is the only way to perform network calls, and
it blocks until the response arrives.

There is no overall wall-clock limit on script execution; each `sendRequest`
call has its own timeout (default 10 seconds).

After a script finishes:

- **Pre-request:** mutations to `request` are applied to the outgoing request.
- **Both:** changes made via `environment.set` / `environment.unset` are
  persisted to the active environment.

## `request`

The outgoing request, mutable in pre-request scripts:

| Field         | Type   | Description                                     |
| ------------- | ------ | ----------------------------------------------- |
| `url`         | string | Fully resolved URL (variables already applied)  |
| `method`      | string | HTTP method                                     |
| `headers`     | object | Header name → value map                         |
| `body`        | any    | Request body (parsed object for JSON bodies)    |
| `queryParams` | object | Query parameter name → value map                |
| `pathParams`  | object | Path parameter name → value map                 |

```javascript
request.headers["Authorization"] = `Bearer ${environment.get("token")}`;
request.queryParams["page"] = "2";
delete request.queryParams["debug"];
```

Notes:

- Variable templates (`{{ name }}`) are resolved *before* the script runs; the
  script sees final values.
- Setting a query/path parameter to `null` removes it. If a script sets
  `request.url` directly, the explicit URL wins for scheme/host/path while a
  mutated `request.queryParams` map supplies the final query string.
- Reassigning `request` itself to a non-object is ignored with a warning; the
  original request is kept.
- In the **collection runner**, `request` contains only `url`, `method`,
  `headers`, and `body`.

## `response` (test scripts only)

| Field        | Type   | Description                                                   |
| ------------ | ------ | ------------------------------------------------------------- |
| `status`     | number | HTTP status code                                              |
| `statusText` | string | Status reason phrase                                          |
| `headers`    | object | Response header map                                           |
| `body`       | any    | Parsed object when the response was JSON, otherwise a string  |
| `timings`    | object | Timing breakdown in ms (e.g. `timings.total`)                 |
| `cookies`    | array  | Parsed `Set-Cookie` entries                                   |

```javascript
expect(response.status).toBe(200);
expect(response.body.user.email).toMatch(/@example\.com$/);
environment.set("userId", String(response.body.user.id));
```

In the **collection runner**, `response` contains only `status`, `statusText`,
`headers`, and `body` (no `timings`/`cookies`).

## `environment`

Read and write variables of the **active environment**. Values are strings.

```javascript
const host = environment.get("host");
environment.set("requestId", "abc-123");
environment.unset("tempToken");
```

Changes are persisted after the script finishes — a token stored with
`environment.set` is available to every subsequent request (and survives app
restarts). In the collection runner, changes carry over to the following
requests of the run.

## `console`

`console.log`, `console.info`, `console.warn`, `console.error` — one argument
per call is captured and shown in the Scripts response tab.

## Testing

### `test(name, fn)` / `it(name, fn)` / `describe(name, fn)`

```javascript
describe("user endpoint", () => {
    test("returns 200", () => {
        expect(response.status).toBe(200);
    });
    it("returns a user id", () => {
        expect(response.body.user).toHaveProperty("id");
    });
});
```

A failing expectation inside `test`/`it` marks that test failed and continues
with the next one. `expect` calls at the top level (outside `test`) register
each assertion as its own result and abort the script on failure.

### `expect(actual)` matchers

| Matcher                          | Passes when                                  |
| -------------------------------- | -------------------------------------------- |
| `toBe(expected)`                 | `actual === expected`                        |
| `toEqual(expected)`              | Deep (JSON) equality                         |
| `toBeTruthy()` / `toBeFalsy()`   | Truthiness check                             |
| `toBeNull()`                     | `actual === null`                            |
| `toBeDefined()` / `toBeUndefined()` | Defined-ness check                        |
| `toContain(item)`                | String or array containment                  |
| `toBeGreaterThan(n)` / `toBeGreaterThanOrEqual(n)` | Numeric comparison         |
| `toBeLessThan(n)` / `toBeLessThanOrEqual(n)`       | Numeric comparison         |
| `toHaveLength(n)`                | `actual.length === n`                        |
| `toMatch(regexOrString)`         | Regex test                                   |
| `toHaveProperty(key[, value])`   | Property existence (and optional value)      |

Every matcher can be negated with `.not`:

```javascript
expect(response.status).not.toBe(500);
```

## `sendRequest(urlOrOptions[, callback])`

Make an HTTP request from a script. The call is **synchronous** — it returns
the response directly (unlike Postman's callback-only API, though the callback
form is also supported).

```javascript
const res = sendRequest({
    url: environment.get("authUrl"),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&client_id=" + environment.get("clientId")
});

if (res.status === 200) {
    environment.set("token", res.json().access_token);
}
```

### Options

| Option    | Type             | Default | Description                                              |
| --------- | ---------------- | ------- | -------------------------------------------------------- |
| `url`     | string           | —       | Required. Passing a plain string is shorthand for `{ url }` |
| `method`  | string           | `GET`   | HTTP method (case-insensitive)                            |
| `headers` | object           | `{}`    | Header map; values are coerced to strings                 |
| `body`    | string \| object | —       | Objects are `JSON.stringify`-ed and `Content-Type: application/json` is set unless you provide one |
| `timeout` | number (ms)      | `10000` | Per-call timeout, capped at 60000                         |

### Response

| Field        | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `status`     | number   | HTTP status code                                  |
| `statusText` | string   | Canonical reason phrase                           |
| `headers`    | object   | Lowercased header names; repeated headers joined with `", "` |
| `body`       | string   | Raw response body                                 |
| `json()`     | function | Parses `body` as JSON (throws on invalid JSON)    |
| `text()`     | function | Returns `body` unchanged                          |

### Errors

Network failures, timeouts, and invalid options throw — catch them with
`try`/`catch`:

```javascript
try {
    const res = sendRequest("https://api.example.com/health");
    environment.set("apiUp", String(res.status === 200));
} catch (e) {
    console.warn("Health check failed: " + e.message);
}
```

Or use the Postman-style callback form, where errors are passed to the callback
instead of thrown:

```javascript
sendRequest("https://api.example.com/health", (err, res) => {
    if (err) { console.warn(err.message); return; }
    console.log("status: " + res.status);
});
```

The callback runs synchronously, before `sendRequest` returns.

### Behavior notes

- Redirects are followed automatically (up to 10); you receive the final
  response.
- Response bodies are fully buffered in memory — avoid huge downloads.
- Proxy settings and client certificates configured in the app do **not**
  apply to `sendRequest` calls.
- `sendRequest` is also available in runner test scripts.

## Postman compatibility (`pm`)

For scripts ported from Postman, a `pm` object provides:

- `pm.environment.get(key)` / `pm.environment.set(key, value)` /
  `pm.environment.unset(key)`
- `pm.request` / `pm.response`
- `pm.test(name, fn)`
- `pm.sendRequest(urlOrOptions[, callback])` — synchronous, unlike Postman

The bare globals (`environment`, `request`, `response`, `test`, `expect`,
`sendRequest`) are the recommended API; `pm.*` exists for easier migration.

## Sandbox limitations

- No `fetch`, `XMLHttpRequest`, `require`/`import`, `setTimeout`/`setInterval`,
  or DOM/browser APIs (`btoa`, `localStorage`, …). `sendRequest` is the only
  network primitive.
- Standard JavaScript built-ins (`JSON`, `Math`, `Date`, `RegExp`, string and
  array methods, template literals, arrow functions) are available.
- Scripts run to completion — there is no wall-clock timeout, so avoid
  unbounded loops. `sendRequest` calls time out individually (10 s default,
  60 s max).
- Environment values are stored as strings; convert with `String(...)` /
  `Number(...)` as needed.
