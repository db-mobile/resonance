<div align="center">

<img src="assets/icons/icon_128x128.png" alt="Resonance logo" width="96" height="96">

# Resonance

**A lightweight, local-first, open-source alternative to Postman and Insomnia.**
No account. No cloud sync. No telemetry. Your collections are plain YAML files on your disk.

[![Latest release](https://img.shields.io/github/v/release/db-mobile/resonance?color=1257ab)](https://github.com/db-mobile/resonance/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/db-mobile/resonance/total?color=1257ab)](https://github.com/db-mobile/resonance/releases)
[![Flathub](https://img.shields.io/flathub/downloads/io.github.db_mobile.resonance?label=flathub&color=1257ab)](https://flathub.org/apps/io.github.db_mobile.resonance)
[![CI](https://img.shields.io/github/actions/workflow/status/db-mobile/resonance/ci.yml?branch=main&label=CI)](https://github.com/db-mobile/resonance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/db-mobile/resonance)](LICENSE)

[Installation](#installation) · [Features](#features) · [Command line](#command-line) · [Screenshots](#screenshots) · [Documentation](https://db-mobile.github.io/resonance/) · [Scripting](SCRIPTS.md) · [Contributing](#contributing)

<a href="https://flathub.org/apps/io.github.db_mobile.resonance"><img height="52" alt="Get it on Flathub" src="https://flathub.org/api/badge?svg&locale=en"></a>
&nbsp;
<a href="https://snapcraft.io/db-mobile-resonance"><img height="52" alt="Get it from the Snap Store" src="https://snapcraft.io/static/images/badges/en/snap-store-black.svg"></a>

![Main interface showing API request configuration](/assets/screenshots/main_window_hdpi.png?raw=true "Main interface showing API request configuration")

</div>

## Why Resonance?

- **Local-first, zero-account** — everything works offline, forever. Collections, environments, history, and settings live as human-readable files that you can version, diff, and share with git.
- **Genuinely lightweight** — built with Tauri and a Rust backend: ~15 MB bundle size, ~50 MB memory footprint.
- **Every protocol you need** — REST, GraphQL (incl. subscriptions), gRPC (with server reflection), WebSocket, Server-Sent Events, and MQTT in one client.
- **Secrets stay secret** — credentials and secret variables are stored in your OS keychain (GNOME Keyring / KWallet, macOS Keychain, Windows Credential Manager), never in the collection files you commit.
- **Batteries included** — OpenAPI/Swagger, Postman, Insomnia, HAR & cURL import, mock server, pre-request/test scripting, data-driven collection runner, a headless CLI for CI, response schema validation, code generation in 9 languages, API docs generation, mTLS.

## Features

### Protocols

- **REST/HTTP** — HTTP/1.1 and HTTP/2, all body modes (JSON, form data, URL-encoded, plain text, binary files, multipart file uploads), detailed timing breakdown (DNS, TCP, TLS, TTFB, download), cookie display, configurable timeouts
- **GraphQL** — dedicated query and variables editors with syntax highlighting, auto-format, schema introspection and an interactive query explorer, and live subscriptions over WebSocket (`graphql-transport-ws`)
- **gRPC** — server reflection (v1/v1alpha) with automatic service discovery, local `.proto` file loading, all four RPC kinds (unary, server-, client-, and bidirectional streaming), TLS/mTLS options, metadata and trailers display
- **WebSocket** — explicit Connect/Send/Disconnect controls, JSON and Text message modes with formatting available for JSON, persistent connections per tab, handshake headers, sub-protocol negotiation (`Sec-WebSocket-Protocol`, with the server's choice shown in the transcript; a server that ignores an offered list fails the handshake), named message presets saved with the request (load one into the composer or send it directly with variables resolved), and newest-first message transcripts. Clear the response log while keeping the connection open. The Request Timeout setting limits connection setup only (0 disables it); open sockets stay connected until disconnected or closed by the server. Try `wss://echo.websocket.org`.
- **Server-Sent Events** — newest-first message transcripts with a Clear control that keeps the stream connected, automatic reconnection honoring `retry`, `Last-Event-ID` resumption, live connection lifecycle status
- **MQTT** — plaintext and TLS brokers, topic subscribe/publish with wildcards, QoS 0/1/2, retain flag, live connection status

### Import, Export & Mocking

- **Collection import** — OpenAPI 3.0/3.1 and Swagger 2.0 (YAML/JSON) with schema-based example generation, Postman v2.0/v2.1, Insomnia v4 JSON/v5 YAML, HAR captures, and pasted cURL commands; Postman and Insomnia environment import
- **Collection export** — OpenAPI (YAML/JSON) and Postman collections; environment import/export through the environment manager
- **Code generation in 9 languages** — cURL, Python, JavaScript (Fetch/Axios), Node.js, Go, PHP, Ruby, Java
- **Documentation generation** — Markdown or HTML docs from any collection, with parameter tables, saved examples, and code samples
- **Built-in mock server** — generates responses from OpenAPI schemas and examples, custom bodies, status codes and delays per endpoint, response templating (`{{request.params.id}}`, `{{request.body.field}}`, `{{$uuid}}` …), `Prefer: code=… / example=…` to pick a documented response, request logging

### Automation & Testing

- **Pre-request and test scripts** — sandboxed JavaScript (Boa Engine) with `request` mutation, `expect()` assertions, `environment` access, and `sendRequest()` for request chaining. A Postman-compatible `pm` API supports common scripts, with synchronous network calls and a limited module API ([supported APIs and limitations](SCRIPTS.md#postman-compatibility-pm))
- **Collection runner** — HTTP and GraphQL execution with script-controlled branching, bounded loops, conditional skips, run-local variable chaining, an execution timeline, iterations, CSV/JSON data files, stop-on-error, delays, request tags with include/exclude filters, runner definitions saved as `runners/<name>.yaml` inside the collection (committable, one collection per runner), run history, and JSON/JUnit XML report export
- **Command line** — the `resonance` binary runs committed requests, folders and runners headlessly in CI with variables from flags, environment or an exported environment file, JUnit/JSON reports and meaningful exit codes ([details](crates/resonance-cli/README.md))
- **Response schema validation** — local validation using JSON Schema drafts 4, 6, 7, 2019-09, and 2020-12, with schema inference, editor checks, and response validation badges. Schemas without `$schema` use draft 2020-12; OpenAPI `nullable` and legacy boolean exclusive bounds are supported. References must resolve within the supplied schema; external schemas are not fetched. Standard formats are checked, including the `url` compatibility alias. Validation applies to successful HTTP JSON responses; runner schema assertions and Postman's `pm.response.to.have.jsonSchema()` are not included
- **Response inspection** — native JSONPath (RFC 9535) and XPath 1.0 queries in a separate Results view, automatic reapplication, namespace overrides, and result copy/export. Works with completed HTTP/GraphQL responses (including HTTP errors) and unary gRPC JSON
- **Environments & variables** — `{{ variable }}` templating, dynamic variables (`{{$uuid}}`, `{{$timestamp}}`, random data), quick environment switching, import/export

### Security

- **Auth methods** — Bearer, Basic, API Key, OAuth 2.0 (expired tokens are renewed automatically before sending), Digest, NTLM, AWS Signature v4 — configurable at request, folder, or collection level
- **Client certificates (mTLS)** — per-host PEM certificates with custom CA trust
- **Keychain-backed secrets** — literal credentials and secret variables are encrypted at rest in the OS credential store and never written to the git-friendly collection files
- **Proxy support** — HTTP/HTTPS/SOCKS with authentication and bypass lists

### Workflow & UX

- **Workspace tabs** with independent, persistent state; **request history** with search and replay
- **Git-friendly collections** — open collections directly from a checkout, see the current branch in the sidebar, and reload when the branch changes; commit, push, pull, and merge using your Git tools
- **Keyboard shortcuts** for everything, platform-aware (`Ctrl`/`⌘`)
- **3 themes** (light, dark, system) with 9 accent colors; **6 languages** (English, German, Spanish, French, Italian, Brazilian Portuguese)
- **Auto-update** for AppImage and direct downloads; package-manager installs defer to their own update mechanism

See the **[documentation site](https://db-mobile.github.io/resonance/)** for detailed guides on every feature.

## Response inspection

Select **Results** in the response toolbar, enter a query, and press **Apply** or Enter.
JSONPath is selected for JSON bodies and XPath for XML bodies, independently of syntax
highlighting. Editing a query creates a draft; Apply runs it. Applied queries run again
when a new response completes. Each tab keeps separate JSONPath/XPath drafts and applied
queries. **Clear** removes the current format’s query and returns to the previous Code
or Preview view. The original response remains available through Code/Preview and the
original toolbar’s Copy/Save actions.

| Body | Query | Result |
| --- | --- | --- |
| JSON | `$.items[*].name` | Names as a JSON array |
| JSON | `$.items[?@.price < 10]` | Matching items |
| JSON | `$..id` or `$.items[0:5]` | Recursive IDs or an array slice |
| XML | `//item/@id` | Attribute values in document order |
| XML | `count(//item)` | A numeric scalar |
| XML with `xmlns="urn:shop"` | `//ns:item` | Elements in the default namespace |

JSONPath always returns a pretty-printed array, including a single match or `[]`.
XPath returns XML fragments for element/document nodes, text for other node kinds,
and typed scalar results. Root namespace prefixes are detected automatically. The
default namespace gets the first unused alias `ns`, `ns1`, etc. Expand **Namespace
overrides** to supply one `prefix=URI` per line; overrides take precedence. Effective
bindings appear after a successful query. XPath 1.0 has no implicit default namespace.

**Copy Results** and **Save Results** export exactly the displayed text. JSONPath
exports use `.json`; XPath exports use `.txt` because several fragments may not form
one XML document. Derived results are recomputed after reopening a tab.

Inspection accepts complete bodies up to **5 MiB** (UTF-8) and expressions up to
**4,096 characters**. Output contains at most **1,000 complete matches** or **1 MiB**;
partial results are explicitly labeled. A single oversized match requires a narrower
query. Expensive expressions and XML nesting beyond 256 levels are rejected by a
work budget. Binary responses, streaming transcripts, and truncated stored bodies
require a new complete response. Older saved string bodies without reliable format
metadata also require resending. Queries run locally in the native background pool;
DTD/entity declarations and external document access are unsupported.

## Installation

### Linux

**Flathub**

```bash
flatpak install flathub io.github.db_mobile.resonance
```

**Snap**

```bash
snap install db-mobile-resonance
```

To store secrets in the OS keychain (encryption at rest), connect the password-manager interface:

```bash
snap connect db-mobile-resonance:password-manager-service
```

Without this connection the strict snap cannot reach the Secret Service (GNOME Keyring / KWallet), and secrets fall back to unencrypted local storage.

**AUR (Arch Linux)**

```bash
yay -S resonance-bin
```

**AppImage / .deb** — download from the [latest release](https://github.com/db-mobile/resonance/releases/latest).

### macOS

```bash
brew tap db-mobile/resonance
brew install --cask resonance
```

Or download the `.dmg` from the [latest release](https://github.com/db-mobile/resonance/releases/latest).

### Windows

```powershell
winget install DBMobile.Resonance
```

Or download the `.exe` installer from the [latest release](https://github.com/db-mobile/resonance/releases/latest).

### From Source

Requires **Node.js** v22+, **Rust** (stable), and [Tauri's platform dependencies](https://tauri.app/start/prerequisites/) (Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`; macOS: `xcode-select --install`; Windows: MSVC Build Tools).

```bash
git clone https://github.com/db-mobile/resonance.git
cd resonance
npm install
npm run dev          # development mode with hot reload
npm run build:tauri  # production build → target/release/bundle/
```

## Command line

Collections saved by Resonance are plain YAML files, and the `resonance`
command runs them without the desktop app, for example in CI:

```bash
resonance run collections/petstore                      # every request, tree order
resonance run collections/petstore pets "Create pet"    # a folder and a request
resonance run collections/petstore --tags smoke --exclude-tags slow
resonance run collections/petstore --runner smoke \
  --var baseUrl=https://staging.example.com --junit reports/junit.xml
resonance list collections/petstore
```

Install it on Linux or macOS with one line (the script verifies the download
against the release checksums):

```bash
curl -fsSL https://raw.githubusercontent.com/db-mobile/resonance/main/install.sh | sh
```

In GitHub Actions, the repository doubles as a setup action that installs the
CLI on Linux, macOS and Windows runners:

```yaml
- uses: db-mobile/resonance@v3.5.1   # installs that version; add `with: version:` to pick another
- run: resonance run collections/petstore --runner smoke --junit reports/junit.xml
```

Variables come from `--var`, `RESONANCE_VAR_<KEY>` environment variables or an
environment export of the app (`--env-file`), so secrets never live in the
repository. Exit code 0 means every test passed, 1 means a failure, 2 a usage
problem. Static Linux, macOS and Windows binaries ship with every
[release](https://github.com/db-mobile/resonance/releases/latest); see the
[command-line guide](crates/resonance-cli/README.md) for all options.

## Screenshots

| Environment management | Mock server |
| :---: | :---: |
| ![Environment management](/assets/screenshots/environment.png?raw=true) | ![Mock server](/assets/screenshots/mock_server.png?raw=true) |

| Settings |
| :---: |
| ![Settings](/assets/screenshots/settings.png?raw=true) |

## Documentation

User documentation lives on the **[Resonance website](https://db-mobile.github.io/resonance/)** — guides for every protocol, the mock server, collection runner, scripting, and more.

- **[Documentation site](https://db-mobile.github.io/resonance/)** — environments, variables, auth, mTLS, mock server, GraphQL, per-protocol guides
- **[Scripting Reference](SCRIPTS.md)** — pre-request/test script API with examples ([also on the website](https://db-mobile.github.io/resonance/scripts.html))
- **[Command-line guide](crates/resonance-cli/README.md)** — installing and running `resonance` in CI, options, variables, exit codes
- **[Architecture](docs/ARCHITECTURE.md)** — project structure and technology stack for contributors

## Roadmap

- [ ] Response comparison and diff view
- [ ] In-app Git operations for collections (commit, push, pull & merge)

<details>
<summary>Completed milestones</summary>

- [x] OpenAPI 3.0/3.1 and Swagger 2.0 import with schema-based generation
- [x] Postman collection import (v2.0 & v2.1)
- [x] Postman environment import
- [x] Insomnia v4/v5 collection and environment import, plus HAR import
- [x] Multi-language code generation (9 languages)
- [x] Workspace tabs for concurrent requests
- [x] Performance metrics and timing breakdown
- [x] Cookie management and display
- [x] Proxy support with authentication (HTTP/HTTPS/SOCKS)
- [x] Variable templating system with environment support
- [x] Dynamic variables (UUID, timestamps, random values)
- [x] Multi-theme support (light/dark/system with 9 accent colors)
- [x] Internationalization (6 languages)
- [x] Authentication support (Bearer, Basic, API Key, OAuth2, Digest, NTLM)
- [x] Client certificates / mTLS with per-host configuration and custom CA trust
- [x] Request history with search and replay
- [x] Environment management (Dev, Staging, Production, custom)
- [x] Keyboard shortcuts for all major actions
- [x] Mock server with custom responses and delays
- [x] Collection export (OpenAPI and Postman formats)
- [x] cURL command import
- [x] Documentation generation (Markdown/HTML)
- [x] Pre-request and test scripts with JavaScript execution (Boa Engine)
- [x] Automated testing framework with rich assertion API
- [x] Request chaining with environment variable integration
- [x] GraphQL support with dedicated query and variables editors
- [x] GraphQL schema introspection and interactive query explorer
- [x] GraphQL subscriptions over WebSocket (graphql-transport-ws)
- [x] Tauri v2 migration for smaller bundle and better performance
- [x] gRPC support with server reflection and all four RPC kinds (unary, server/client/bidirectional streaming)
- [x] WebSocket support with native backend transport and handshake headers
- [x] Server-Sent Events (SSE) support with automatic reconnection and Last-Event-ID resumption
- [x] MQTT support with topic subscribe/publish, QoS levels, retain, and TLS brokers
- [x] Collection runner with variable chaining, data-driven iterations, run history, and JSON/JUnit reports
- [x] Response JSON Schema validation and inference
- [x] Git branch display and collection reload on branch changes
- [x] File uploads: multipart form-data file parts and binary request bodies
- [x] Command-line runner for CI with static binaries, an install script and a GitHub Action

</details>

## Contributing

Contributions are welcome!

1. Fork the repository and create a feature branch: `git checkout -b feature/amazing-feature`
2. Follow the existing patterns and conventions (see [Architecture](docs/ARCHITECTURE.md))
3. Run `npm run lint`, `npm test` and `cargo test --workspace --locked` before committing
4. Open a Pull Request

Found a bug or have a feature request? [Open an issue](https://github.com/db-mobile/resonance/issues) — please check existing issues first and include as much detail as possible.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
