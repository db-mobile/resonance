<div align="center">

<img src="assets/icons/icon_128x128.png" alt="Resonance logo" width="96" height="96">

# Resonance

**A lightweight, local-first, open-source alternative to Postman and Insomnia.**
No account. No cloud sync. No telemetry. Your collections are plain JSON files on your disk.

[![Latest release](https://img.shields.io/github/v/release/db-mobile/resonance?color=1257ab)](https://github.com/db-mobile/resonance/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/db-mobile/resonance/total?color=1257ab)](https://github.com/db-mobile/resonance/releases)
[![Flathub](https://img.shields.io/flathub/downloads/io.github.db_mobile.resonance?label=flathub&color=1257ab)](https://flathub.org/apps/io.github.db_mobile.resonance)
[![CI](https://img.shields.io/github/actions/workflow/status/db-mobile/resonance/ci.yml?branch=main&label=CI)](https://github.com/db-mobile/resonance/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/github/license/db-mobile/resonance)](LICENSE)

[Installation](#installation) · [Features](#features) · [Screenshots](#screenshots) · [Documentation](https://db-mobile.github.io/resonance/) · [Scripting](SCRIPTS.md) · [Contributing](#contributing)

<a href="https://flathub.org/apps/io.github.db_mobile.resonance"><img height="52" alt="Get it on Flathub" src="https://flathub.org/api/badge?svg&locale=en"></a>
&nbsp;
<a href="https://snapcraft.io/db-mobile-resonance"><img height="52" alt="Get it from the Snap Store" src="https://snapcraft.io/static/images/badges/en/snap-store-black.svg"></a>

![Main interface showing API request configuration](/assets/screenshots/main_window_hdpi.png?raw=true "Main interface showing API request configuration")

</div>

## Why Resonance?

- **Local-first, zero-account** — everything works offline, forever. Collections, environments, history, and settings live as human-readable JSON files that you can version, diff, and share with git.
- **Genuinely lightweight** — built with Tauri and a Rust backend: ~15 MB bundle size, ~50 MB memory footprint.
- **Every protocol you need** — REST, GraphQL (incl. subscriptions), gRPC (with server reflection), WebSocket, Server-Sent Events, and MQTT in one client.
- **Secrets stay secret** — credentials and secret variables are stored in your OS keychain (GNOME Keyring / KWallet, macOS Keychain, Windows Credential Manager), never in the collection files you commit.
- **Batteries included** — OpenAPI & Postman import, mock server, pre-request/test scripting, collection runner, code generation in 9 languages, mTLS.

## Features

### Protocols

- **REST/HTTP** — HTTP/1.1 and HTTP/2, all body modes (JSON, form data, URL-encoded, plain text, binary files, multipart file uploads), detailed timing breakdown (DNS, TCP, TLS, TTFB, download), cookie display, configurable timeouts
- **GraphQL** — dedicated query and variables editors with syntax highlighting, auto-format, and live subscriptions over WebSocket (`graphql-transport-ws`)
- **gRPC** — server reflection (v1/v1alpha) with automatic service discovery, all four RPC kinds (unary, server-, client-, and bidirectional streaming), TLS/mTLS options, metadata and trailers display
- **WebSocket** — persistent connections per tab, handshake headers, transcript-style message display
- **Server-Sent Events** — automatic reconnection honoring `retry`, `Last-Event-ID` resumption, live connection lifecycle status
- **MQTT** — plaintext and TLS brokers, topic subscribe/publish with wildcards, QoS 0/1/2, retain flag, live connection status

### Import, Export & Mocking

- **OpenAPI 3.0 import** (YAML/JSON) with schema-based example generation, **Postman import** (v2.0/v2.1 collections and environments), **OpenAPI export**
- **Code generation in 9 languages** — cURL, Python, JavaScript (Fetch/Axios), Node.js, Go, PHP, Ruby, Java
- **Built-in mock server** — generates responses from OpenAPI schemas, custom bodies and delays per endpoint, request logging

### Automation & Testing

- **Pre-request and test scripts** — sandboxed JavaScript (Boa Engine) with `request` mutation, `expect()` assertions, `environment` access, and `sendRequest()` for request chaining ([full scripting docs](SCRIPTS.md))
- **Collection runner** — batch execution with ordering, variable chaining, stop-on-error, delays, and saved configurations
- **Environments & variables** — `{{ variable }}` templating, dynamic variables (`{{$uuid}}`, `{{$timestamp}}`, random data), quick environment switching, import/export

### Security

- **Auth methods** — Bearer, Basic, API Key, OAuth 2.0, Digest, AWS Signature v4 — configurable at request, folder, or collection level
- **Client certificates (mTLS)** — per-host PEM certificates with custom CA trust
- **Keychain-backed secrets** — literal credentials and secret variables are encrypted at rest in the OS credential store and never written to the git-friendly collection files
- **Proxy support** — HTTP/HTTPS/SOCKS with authentication and bypass lists

### Workflow & UX

- **Workspace tabs** with independent, persistent state; **request history** with search and replay
- **Keyboard shortcuts** for everything, platform-aware (`Ctrl`/`⌘`)
- **4 themes** (light, dark, system, OLED black) with 9 accent colors; **6 languages** (English, German, Spanish, French, Italian, Brazilian Portuguese)
- **Auto-update** for AppImage and direct downloads; package-manager installs defer to their own update mechanism

See the **[documentation site](https://db-mobile.github.io/resonance/)** for detailed guides on every feature.

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

Download the `.msi` or `.exe` installer from the [latest release](https://github.com/db-mobile/resonance/releases/latest).

### From Source

Requires **Node.js** v22+, **Rust** (stable), and [Tauri's platform dependencies](https://tauri.app/start/prerequisites/) (Linux: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`; macOS: `xcode-select --install`; Windows: MSVC Build Tools).

```bash
git clone https://github.com/db-mobile/resonance.git
cd resonance
npm install
npm run dev          # development mode with hot reload
npm run build:tauri  # production build → src-tauri/target/release/bundle/
```

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
- **[Architecture](docs/ARCHITECTURE.md)** — project structure and technology stack for contributors

## Roadmap

- [ ] Response comparison and diff view
- [ ] Git integration for collections (versioning & sync)
- [ ] Team collaboration features

<details>
<summary>Completed milestones</summary>

- [x] OpenAPI 3.0 import with schema-based generation
- [x] Postman collection import (v2.0 & v2.1)
- [x] Postman environment import
- [x] Multi-language code generation (9 languages)
- [x] Workspace tabs for concurrent requests
- [x] Performance metrics and timing breakdown
- [x] Cookie management and display
- [x] Proxy support with authentication (HTTP/HTTPS/SOCKS)
- [x] Variable templating system with environment support
- [x] Dynamic variables (UUID, timestamps, random values)
- [x] Multi-theme support (4 themes with 9 accent colors)
- [x] Internationalization (6 languages)
- [x] Authentication support (Bearer, Basic, API Key, OAuth2, Digest)
- [x] Client certificates / mTLS with per-host configuration and custom CA trust
- [x] Request history with search and replay
- [x] Environment management (Dev, Staging, Production, custom)
- [x] Keyboard shortcuts for all major actions
- [x] Mock server with custom responses and delays
- [x] Collection export (OpenAPI format)
- [x] Pre-request and test scripts with JavaScript execution (Boa Engine)
- [x] Automated testing framework with rich assertion API
- [x] Request chaining with environment variable integration
- [x] GraphQL support with dedicated query and variables editors
- [x] GraphQL subscriptions over WebSocket (graphql-transport-ws)
- [x] Tauri v2 migration for smaller bundle and better performance
- [x] gRPC support with server reflection and all four RPC kinds (unary, server/client/bidirectional streaming)
- [x] WebSocket support with native backend transport and handshake headers
- [x] Server-Sent Events (SSE) support with automatic reconnection and Last-Event-ID resumption
- [x] MQTT support with topic subscribe/publish, QoS levels, retain, and TLS brokers
- [x] Collection runner for batch request execution with variable chaining
- [x] File uploads: multipart form-data file parts and binary request bodies

</details>

## Contributing

Contributions are welcome!

1. Fork the repository and create a feature branch: `git checkout -b feature/amazing-feature`
2. Follow the existing patterns and conventions (see [Architecture](docs/ARCHITECTURE.md))
3. Run `npm run lint` and `npm test` before committing
4. Open a Pull Request

Found a bug or have a feature request? [Open an issue](https://github.com/db-mobile/resonance/issues) — please check existing issues first and include as much detail as possible.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
