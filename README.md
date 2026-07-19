# Resonance

A local-first, zero-account API client with excellent user experience built with Tauri. Resonance is designed to be resource-friendly — with a ~15MB bundle size and ~50MB memory footprint, it runs lean compared to Electron-based alternatives.

![Resonance API Client](https://img.shields.io/badge/License-MIT-blue.svg)
![Tauri](https://img.shields.io/badge/Tauri-v2-brightgreen.svg)
![Rust](https://img.shields.io/badge/Rust-Latest-orange.svg)

![Main interface showing API request configuration](/assets/screenshots/main_window_hdpi.png?raw=true "Main interface showing API request configuration")

## Installation

### Package Managers

#### Flathub (Linux)

Install from Flathub:

```bash
flatpak install flathub io.github.db_mobile.resonance
```

Run the application:

```bash
flatpak run io.github.db_mobile.resonance
```

#### Snap (Linux)

Install from Snap Store:

```bash
snap install db-mobile-resonance
```

To store secret variables and credentials in the OS keychain (encryption at rest), connect the password-manager interface after installing:

```bash
snap connect db-mobile-resonance:password-manager-service
```

Without this connection the strict snap cannot reach the Secret Service (GNOME Keyring / KWallet), and secrets fall back to unencrypted local storage. Verify the connection with `snap connections db-mobile-resonance`.

#### AUR (Arch Linux)

Install via an AUR helper like `yay` or `paru`:

```bash
yay -S resonance-bin
```

Or manually with `makepkg`:

```bash
git clone https://aur.archlinux.org/resonance-bin.git
cd resonance-bin
makepkg -si
```

#### Homebrew (macOS)

Install via Homebrew:

```bash
brew tap db-mobile/resonance
brew install --cask resonance
```

### From Source

#### Prerequisites

- **Node.js** v20.0.0 or higher
- **Rust** (latest stable) - [Install Rust](https://www.rust-lang.org/tools/install)
- **Git** (for cloning the repository)
- **Platform-specific dependencies**:
  - **Linux**: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev`
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Windows**: Microsoft Visual Studio C++ Build Tools

#### Building from Source

1. Clone the repository:

```bash
git clone https://github.com/db-mobile/resonance.git
cd resonance
```

2. Install dependencies:

```bash
npm install
```

3. Start the application in development mode:

```bash
npm run dev
```

### Build for Distribution

Build the application for production:

```bash
npm run build:tauri
```

The built application will be in `src-tauri/target/release/bundle/`.

**Note:** Tauri creates native installers for each platform:

- **Linux**: AppImage, .deb
- **macOS**: .app, .dmg
- **Windows**: .msi, .exe

## Features

### Collection Import & Management

- **OpenAPI/Swagger Import**: Import OpenAPI 3.0 specifications (YAML/JSON) with automatic schema-based example generation
- **Postman Import**: Import Postman Collection Format v2.0 and v2.1 files
- **Postman Environment Import**: Import Postman environment files with variables
- **Smart Folder Organization**: Both formats create consistent flat folder structures by path segment

### Code Generation

- **Multi-Language Export**: Generate request code in 9 languages:
  - cURL, Python (requests), JavaScript (Fetch), JavaScript (Axios)
  - Node.js (https module), Go (net/http), PHP (cURL), Ruby (net/http), Java (HttpClient)
- **All Body Modes Covered**: Generated snippets include multipart form-data file parts, binary file bodies, and URL-encoded forms

### Request Bodies & File Uploads

- **Body Modes**: JSON, Form Data, URL-encoded, plain text, binary file, and GraphQL — switchable per request via the body mode selector
- **Multipart File Uploads**: Attach files as form-data parts alongside text fields, with an optional explicit `Content-Type` per part
- **Binary Bodies**: Send a file as the raw request body with a configurable content type
- **Path-Only Storage**: Collections store only file paths — file contents are read from disk at request time, so collections stay small and git-friendly
- **Runner Support**: File parts and binary bodies also work in the Collection Runner

### GraphQL Support

- **GraphQL Integration**: Dedicated editors for GraphQL queries and testing
  - Body mode selector to switch the body editor into GraphQL mode
  - GraphQL query editor with syntax highlighting
  - Variables editor with JSON syntax highlighting and validation
  - Query formatting with format button
  - Auto-save functionality for queries and variables
  - **GraphQL Subscriptions**: Live subscriptions over WebSocket using the `graphql-transport-ws` protocol, with transcript-style display of streamed events

### gRPC Support

- **gRPC Integration**: Native gRPC client with server reflection
  - Automatic service and method discovery via gRPC reflection (v1 and v1alpha)
  - TLS options: system roots, custom CA bundle, client certificates (mTLS), and skip-verify for development
  - Request metadata (headers) configuration
  - Response metadata and trailers display
  - JSON-based message editing with schema-generated skeletons
  - All four RPC kinds: unary, server-streaming, client-streaming, and bidirectional streaming

### WebSocket Support

- **Native WebSocket Integration**: Native WebSocket client with persistent connections
  - `ws://` and `wss://` support
  - Reusable connections per request tab
  - Handshake header configuration
  - Message sending with transcript-style response display
  - Request creation and persistence alongside HTTP and gRPC requests

### MQTT Support

- **Native MQTT Integration**: Connect to MQTT brokers and exchange messages over a persistent backend connection
  - Plaintext (`mqtt://`, default port 1883) and TLS (`mqtts://`, default port 8883) brokers, plus bare `host:port`
  - Subscribe to topics (with wildcards like `sensors/#`) and publish messages
  - QoS level selection (0, 1, 2) for subscriptions and published messages
  - Retain flag for published messages
  - Optional client ID (auto-generated when omitted), username, and password authentication
  - Configurable keep-alive interval
  - Live connection status indicator with received-message count and incoming-message flash
  - Transcript-style display of published and received messages with topics and timestamps
  - Per-tab connection state with request creation and persistence alongside other protocols

### Server-Sent Events (SSE) Support

- **Native SSE Integration**: Stream `text/event-stream` responses over a persistent backend connection
  - Custom request header configuration for the initial handshake
  - Transcript-style display of each event with `event`, `id`, `retry`, and `data` fields
  - Automatic reconnection honoring the server's `retry` interval
  - `Last-Event-ID` resumption to continue the stream after a reconnect
  - Live connection lifecycle status (connecting, connected, reconnecting, closed, error)
  - Per-tab connection state with transcript persistence

### Collection Runner

- **Batch Request Execution**: Run multiple requests sequentially with configurable options
  - Select requests from any collection and arrange execution order
  - Post-response scripts for variable chaining between requests
  - Stop on error or continue execution options
  - Configurable delay between requests
  - Real-time progress tracking and detailed results
  - Save and reload runner configurations

### Advanced Features

- **Scripts & Automation**: Pre-request and test scripts with JavaScript execution (powered by Boa Engine)
  - **Pre-request Scripts**: Modify requests dynamically (headers, body, auth signatures)
  - **Test Scripts**: Validate responses with assertions and extract data
  - Rich assertion API (`expect()`) for automated testing
  - Environment variable integration for request chaining
  - Console logging for debugging with timestamps
  - Sandboxed execution with 10-second timeout for security
- **Workspace Tabs**: Multiple concurrent request tabs with independent state and persistent storage
- **Performance Metrics**: Detailed request timing breakdown (DNS, TCP, TLS, TTFB, download)
- **Cookie Management**: Parse and display response cookies with full attribute support
- **Request History**: Complete request/response history with search and replay capability
- **Proxy Support**: HTTP/HTTPS/SOCKS proxy configuration with authentication and bypass lists
- **Mock Server**: Local HTTP mock server for testing API clients without a backend
  - Generate responses from OpenAPI schemas automatically
  - Configure custom response bodies and delays per endpoint
  - Enable/disable collections individually
  - Real-time request logging and monitoring

### Environment & Variables

- **Environment Management**: Organize variables into environments (Development, Staging, Production, etc.)
- **Variable Templating**: Use `{{ variableName }}` syntax for dynamic values in URLs, headers, and request bodies
- **Dynamic Variables**: Auto-generated values with `{{$variableName}}` syntax (UUID, timestamps, random strings, etc.)
- **Environment Switching**: Quick dropdown selector to switch between different API contexts
- **Secret Variables**: Flag any environment **or** collection variable as secret — its value is masked in the editor (with a reveal toggle), kept out of exported environment/variable files, and never written into the git-friendly collection files (only an empty placeholder and the secret flag are stored). Secret values are stored in the **OS keychain** (encryption at rest), falling back to local storage only when no keychain is available
- **Import/Export**: Share environments with your team or backup as JSON files (secret values are omitted; the secret flag is preserved so recipients re-enter their own values)

### Authentication

- **Multiple Auth Methods**: Bearer Token, Basic Auth, API Key, OAuth 2.0, Digest Auth, AWS Signature v4
- **Per-Request Configuration**: Set authentication at request, folder, or collection level
- **Credentials Kept Out of Git**: Literal auth credentials (tokens, passwords, client/secret keys) are stored in the OS keychain — never written into the human-readable collection files — so committing a collection won't leak secrets. Reference environment variables (e.g. `{{bearerToken}}`) to keep credentials fully out of collections
- **OS Keychain Storage**: Secrets are encrypted at rest in the platform credential store — Secret Service (GNOME Keyring / KWallet) on Linux, Keychain on macOS, Credential Manager on Windows — with a local-storage fallback when no keychain is available

### Client Certificates (mTLS)

- **Mutual TLS Authentication**: Present a PEM client certificate and private key to servers that require mTLS
- **Custom CA Trust**: Trust a custom CA bundle for servers using private or self-signed certificate authorities
- **Per-Host Configuration**: Map certificates to a specific `host` or `host:port`, with exact `host:port` matches taking precedence over a bare host
- **Path-Only Storage**: Only file paths are stored — certificate, key, and CA files are read from disk at request time, never copied into config
- **Enable/Disable Per Entry**: Toggle individual certificate entries without deleting them

### User Experience

- **Keyboard Shortcuts**: Comprehensive shortcuts for all actions with platform-aware bindings (⌘/Ctrl)
- **Multi-Theme Support**: Light, dark, system-adaptive, and black (OLED) themes with 9 accent colors
- **Internationalization**: Translations for English, Brazilian Portuguese, German, Spanish, French and Italian
- **Syntax Highlighting**: CodeMirror-based response viewer with automatic language detection
- **Resizable Panels**: Customizable workspace layout with draggable panel dividers

### Technical Features

- **HTTP Version Control**: Support for HTTP/1.1 and HTTP/2
- **Request Timeouts**: Configurable timeout settings per request
- **Secure Architecture**: Tauri's secure IPC, CSP policies, and native system integration
- **Persistent Storage**: Auto-save for collections, variables, environments, settings, and history
- **Git-Friendly Storage**: Collections are stored as human-readable JSON files in a directory structure, making them easy to version control, diff, and collaborate on with Git
- **Auto-Update**: In-app update check with one-click install for AppImage and direct downloads; package-manager installs (Flatpak, Snap, Homebrew, Scoop, distro packages) are detected and defer to their own update mechanism
- **Lightweight**: ~15MB bundle size, ~50MB memory usage (vs ~150MB/~200MB for Electron)

## Usage

### Getting Started

1. **Import Collections**: Click the Import button and choose:
   - **OpenAPI Collection**: For OpenAPI 3.0 specs (YAML/JSON)
   - **Postman Collection**: For Postman v2.0/v2.1 files
   - **Postman Environment**: To import Postman environment variables
2. **Create Environments**: Set up environments (Development, Staging, Production) with environment-specific variables
3. **Set Variables**: Define reusable variables like API keys and base URLs within each environment
4. **Switch Environments**: Use the environment selector dropdown to quickly switch between different API contexts
5. **Make Requests**: Select endpoints from the collections sidebar and configure path params, query params, headers, body, auth, and scripts
6. **Add Scripts (Optional)**: Write pre-request scripts to modify requests dynamically or test scripts to validate responses
7. **View Responses**: Examine response data in the tabbed viewer (Body, Headers, Cookies, Performance, Scripts for HTTP; Body transcript for WebSocket, SSE, and MQTT; Body, Metadata, Trailers for gRPC)
8. **Export Code**: Generate request code in your preferred language for documentation or automation

### Environment Management

Organize your API variables into separate environments:

- **Create Multiple Environments**: Development, Staging, Production, or any custom environment
- **Environment-Specific Variables**: Each environment has its own set of variables
- **Quick Switching**: Use the dropdown selector to instantly switch between environments
- **Import/Export**: Share environments with your team or backup as JSON files
- **Manage Variables**: Full CRUD operations for environment variables through the Environment Manager

### Variable System

Variables use the `{{ variableName }}` syntax and can be used in:

- Request URLs
- Headers
- Query parameters
- Request bodies

Variables are scoped to the active environment, allowing different values for different contexts.

Example:

```
URL: {{ baseUrl }}/users/{{ userId }}
Header: Authorization: Bearer {{ apiKey }}
```

The values of `baseUrl` and `apiKey` will automatically change when you switch environments.

### Dynamic Variables

Dynamic variables use the `{{$variableName}}` syntax and generate values automatically at request time. They don't need to be defined in advance.

| Variable                 | Description                   | Example Output                              |
| ------------------------ | ----------------------------- | ------------------------------------------- |
| `{{$uuid}}`              | Random UUID v4                | `550e8400-e29b-41d4-a716-446655440000`      |
| `{{$timestamp}}`         | Unix timestamp (seconds)      | `1737129600`                                |
| `{{$timestampMs}}`       | Unix timestamp (milliseconds) | `1737129600000`                             |
| `{{$isoTimestamp}}`      | ISO 8601 formatted date       | `2026-01-17T12:00:00.000Z`                  |
| `{{$randomInt}}`         | Random integer 0-1000         | `742`                                       |
| `{{$randomInt:min:max}}` | Random integer in range       | `{{$randomInt:1:100}}` → `57`               |
| `{{$randomString}}`      | Random 8-character string     | `xK9mPq2R`                                  |
| `{{$randomString:N}}`    | Random N-character string     | `{{$randomString:16}}` → `xK9mPq2RaB3nLp8Y` |
| `{{$randomEmail}}`       | Random email address          | `abc12345@example.com`                      |
| `{{$randomName}}`        | Random full name              | `John Smith`                                |
| `{{$randomBoolean}}`     | Random boolean                | `true`                                      |
| `{{$randomIPv4}}`        | Random IPv4 address           | `192.83.4.211`                              |
| `{{$randomDate}}`        | Random date within ±N days (default 365) | `{{$randomDate:30}}` → `2026-07-28`  |
| `{{$randomDatePast}}`    | Random date 1..N days in the past (default 365) | `2026-03-14`                  |
| `{{$randomDateFuture}}`  | Random date 1..N days in the future (default 365) | `2026-11-02`                |
| `{{$randomUrl}}`         | Random https URL              | `https://xk9mpq2r.io/ab3nlp`                |
| `{{$randomLoremWords:N}}`| N lorem ipsum words (default 5) | `lorem dolor amet sed tempor`             |
| `{{$randomPrice:min:max}}`| Random price with 2 decimals (default 1:1000) | `{{$randomPrice:10:50}}` → `24.99` |
| `{{$randomPhoneNumber}}` | Random US-style phone number  | `+1-555-283-4091`                           |

**Per-Request Consistency**: The same dynamic variable used multiple times within a single request will resolve to the same value. For example, using `{{$uuid}}` in both the URL and a header will produce identical UUIDs.

### Authentication

Resonance supports multiple authentication methods:

- **Bearer Token**: OAuth 2.0 and custom bearer tokens
- **Basic Auth**: Username/password authentication with base64 encoding
- **API Key**: Custom header or query parameter authentication
- **OAuth 2.0**: Flexible OAuth 2.0 authentication with custom prefixes
- **Digest Auth**: RFC 2617 compliant Digest authentication with MD5 hashing
- **AWS Signature v4**: Signed requests for AWS services (access key, secret key, optional session token)

All authentication credentials are automatically applied to requests and work seamlessly with the variable templating system. Literal credentials are stored outside the git-friendly collection files; use `{{ variable }}` references for credentials you want to keep entirely out of collections.

### Client Certificates (mTLS)

For APIs protected by mutual TLS, configure client certificates in **Settings → Certificates**:

1. Open **Settings** (`Ctrl/Cmd+,`) and select the **Certificates** tab
2. Click **Add Certificate** and enter the **Host** the certificate applies to (e.g. `api.example.com` or `api.example.com:8443`)
3. Choose the PEM files:
   - **Certificate (PEM)**: your client certificate chain
   - **Private Key (PEM, unencrypted)**: the matching private key
   - **CA Bundle (PEM, optional)**: a custom CA to trust for this host
4. Leave the entry **Enabled** to activate it

When a request is sent, Resonance resolves the certificate whose host matches the request host — an exact `host:port` match is preferred over a bare hostname match. The client certificate and key are applied as a TLS identity (mTLS), and any CA bundle is added to the trusted roots.

**Notes:**

- A client certificate requires **both** the certificate and the key file; a CA bundle can be supplied on its own to only extend trust.
- Private keys must be **unencrypted** PEM files.
- Only file **paths** are persisted (stored as `clientCertificates`). The files are read from disk each time a matching request is sent, so keep them in place.
- Certificates also apply to requests run through the **Collection Runner**.

### Collection Import

**OpenAPI Integration**
Resonance automatically:

- Parses OpenAPI 3.0 specifications (YAML/JSON)
- Generates intelligent example request bodies from schemas
- Resolves schema references and nested objects
- Groups endpoints by first path segment

**Postman Integration**
Import your existing Postman collections:

- Supports Postman Collection Format v2.0 and v2.1
- Preserves exact request examples from your collections
- Automatically extracts collection variables
- Import Postman environments to recreate your workflow
- Full authentication mapping (Bearer, Basic, API Key, OAuth2, Digest)
- Supports body modes (raw, urlencoded, formdata)

### Mock Server

Test your API clients without a running backend using Resonance's built-in mock server:

**Getting Started with Mock Server**

1. Click the Mock Server icon in the toolbar to open the mock server dialog
2. Configure the port (default: 3000)
3. Select which collections to mock by enabling their checkboxes
4. Click "Start Server" to begin mocking

**Features**

- **Automatic Response Generation**: Generates realistic responses from OpenAPI schemas
- **Custom Responses**: Override default responses with custom JSON for any endpoint
- **Configurable Delays**: Add realistic latency by setting delays (0-30000ms) per endpoint
- **Request Logging**: Monitor all incoming requests with method, path, status, and timing
- **Request Routing**: Automatically intercepts and routes matching requests to the mock server

**Per-Endpoint Configuration**
Click the "Edit" button next to any endpoint to:

- Set custom response body (JSON)
- Configure request delay in milliseconds
- Reset to schema-generated defaults

The mock server is perfect for:

- Frontend development without backend dependencies
- Testing error scenarios and edge cases
- Simulating network latency and slow responses
- API prototyping and demonstrations

### Scripts & Testing

Automate your API testing and workflows with pre-request and test scripts written in JavaScript.

**Getting Started with Scripts**

1. Select an endpoint from your collections
2. Click the **Scripts** tab in the request configuration area
3. Write your scripts in the two available sub-tabs:
   - **Pre-request Script**: Runs before the request is sent
   - **Test Script**: Runs after receiving the response
4. Scripts auto-save after 1 second of inactivity
5. View script output in the **Scripts** response tab (console logs and test results)

**Pre-request Script Examples**

Add dynamic authentication headers:

```javascript
const apiKey = environment.get("API_KEY");
request.headers["Authorization"] = `Bearer ${apiKey}`;
console.log("Added auth header");
```

Fetch a token from an auth endpoint before the request:

```javascript
const res = sendRequest({
  url: environment.get("authUrl"),
  method: "POST",
  body: { clientId: environment.get("clientId") }
});
request.headers["Authorization"] = `Bearer ${res.json().access_token}`;
```

Read and modify query and path parameters:

```javascript
request.queryParams["token"] = environment.get("API_TOKEN");
delete request.queryParams["debug"];
request.pathParams["id"] = "42";
```

Parameter values are variable-resolved before the script runs. Setting a
parameter to `null` removes it. If a script sets `request.url` directly, the
explicit URL wins for scheme/host/path, while a mutated `request.queryParams`
map always supplies the final query string.

**Test Script Examples**

Validate response and extract data:

```javascript
// Verify status code
expect(response.status).toBe(200);

// Validate response structure
expect(response.body.user).toBeDefined();
expect(response.body.user.email).toMatch(/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/);

// Extract token for next request
const token = response.body.token;
environment.set("AUTH_TOKEN", token);
console.log("Token saved for subsequent requests");
```

Check performance:

```javascript
expect(response.status).toBe(200);
expect(response.timings.total).toBeLessThan(1000);
console.log("Response time:", response.timings.total, "ms");
```

**Available APIs**

Scripts have access to powerful APIs:

- `request` - Modify URL, method, headers, body, query params, path params
- `response` (test only) - Access status, headers, body, cookies, timings
- `environment` - Get/set/delete environment variables
- `console` - Log messages (log, info, warn, error)
- `expect()` - Rich assertion library (toBe, toEqual, toContain, toHaveProperty, toMatch, etc.)
- `sendRequest(options)` - Make an HTTP request from a script (token fetching, request chaining)

**Common Use Cases**

- Request chaining (login → extract token → use in next request)
- Dynamic authentication signature generation
- Automated response validation and testing
- Data extraction from responses
- Performance testing and validation
- Pagination handling with state management

For comprehensive documentation with more examples, troubleshooting, and API reference, see `SCRIPTS.md` in the repository.

### GraphQL Queries

Resonance supports GraphQL queries with dedicated editors for queries and variables.

**Using GraphQL Mode**

1. Navigate to the **Body** tab in the request configuration area
2. Use the body mode selector at the top to switch from **JSON** to **GraphQL**
3. Write your GraphQL query in the query editor
4. Add variables in the variables editor (optional)
5. Click the **Format** button to auto-format your query
6. Send the request to see results

**Query Editor Example**

```graphql
query GetUser($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    posts {
      id
      title
      content
    }
  }
}
```

**Variables Editor Example**

```json
{
  "userId": "123"
}
```

**Features**

- **Syntax Highlighting**: Full GraphQL syntax highlighting in the query editor
- **Variables Support**: Separate JSON editor for GraphQL variables with validation
- **Auto-Format**: Format button to automatically format your GraphQL queries
- **Auto-Save**: Queries and variables are automatically saved as you type
- **Variable Templating**: Use environment variables in GraphQL queries and variables with `{{ variableName }}` syntax

**Combined with Scripts**
GraphQL works seamlessly with pre-request and test scripts:

- Use pre-request scripts to modify GraphQL queries dynamically
- Use test scripts to validate GraphQL response structure
- Extract data from GraphQL responses and save to environment variables

### Themes

Switch between themes in Settings:

- **Light**: Clean, bright interface
- **Dark**: Easy on the eyes for low-light environments
- **System**: Automatically matches your OS theme
- **Black (OLED)**: True black theme optimized for OLED displays

### Accent Colors

Personalize your interface with 9 accent colors:

- Green (default), Teal, Blue, Indigo, Purple, Yellow, Orange, Red, Pink

Accent colors are applied to buttons, highlights, and interactive elements throughout the application.

## Keyboard Shortcuts

Resonance includes comprehensive keyboard shortcuts to speed up your workflow. Press `Ctrl+/` (or `Cmd+/` on macOS) to view the shortcuts help dialog in the app.

### Request Actions

- `Ctrl/Cmd+Enter` - Send request
- `Ctrl/Cmd+S` - Save request modifications
- `Esc` - Cancel current request

### Navigation

- `Ctrl/Cmd+L` - Focus URL bar
- `Ctrl/Cmd+B` - Toggle collections sidebar
- `Ctrl/Cmd+H` - Toggle history sidebar

### Actions

- `Ctrl/Cmd+K` - Generate code (multi-language export)
- `Ctrl/Cmd+O` - Import collection (shows import menu)
- `Ctrl/Cmd+E` - Open environment manager

### Settings & Help

- `Ctrl/Cmd+,` - Open settings
- `Ctrl/Cmd+/` or `Shift+/` - Show keyboard shortcuts help

### Workspace Tabs

- `Ctrl/Cmd+T` - Create new workspace tab
- `Ctrl/Cmd+W` - Close current workspace tab
- `Ctrl/Cmd+Tab` - Switch to next workspace tab
- `Ctrl/Cmd+Shift+Tab` - Switch to previous workspace tab
- `Ctrl/Cmd+1` through `Ctrl/Cmd+9` - Switch to workspace tab 1-9

### Request Tabs

- `Alt+1` - Switch to Path Params tab
- `Alt+2` - Switch to Query Params tab
- `Alt+3` - Switch to Headers tab
- `Alt+4` - Switch to Authorization tab
- `Alt+5` - Switch to Body tab
- `Alt+6` - Switch to Scripts tab

**Note:** On macOS, use `Cmd` instead of `Ctrl` for the main modifier. On macOS, `Alt` is displayed as `⌥` (Option). Shortcuts are platform-aware and automatically adapt.

## Architecture

### Project Structure

```
src/
├── renderer.js          # Renderer process coordinator (boots the FeatureRegistry)
├── styles/             # Modular CSS (tokens, layout, widgets, per-feature styles)
├── themes/             # Light/dark theme CSS
├── i18n/               # Internationalization (6 languages)
└── modules/            # Modular renderer components
    ├── controllers/    # MVC controllers (Collection, Environment, History, Script, Proxy, WorkspaceTab, MockServer)
    ├── services/       # Business logic services (Script, Environment, Collection, etc.)
    ├── storage/        # Data persistence repositories (Script, Environment, Collection, etc.)
    ├── ui/             # UI components (dialogs, renderers, selectors, script editors)
    ├── variables/      # Variable processing and templating
    ├── schema/         # OpenAPI schema handling
    ├── registry/       # FeatureRegistry booting co-located *.feature.js descriptors
    ├── state/          # Encapsulated app state modules
    ├── ipcBridge.js    # Tauri IPC compatibility layer
    ├── codeGenerator.js        # Multi-language code export
    ├── *.feature.js            # Per-feature wiring descriptors
    └── [60+ other modules]     # Protocol handlers (gRPC, WebSocket, MQTT, SSE), editors, managers

src-tauri/
├── Cargo.toml         # Rust dependencies
├── tauri.conf.json    # Tauri configuration
└── src/
    ├── main.rs        # Application entry point
    └── commands/      # IPC command handlers
        ├── api_request.rs        # HTTP requests with reqwest (mTLS, multipart/binary bodies)
        ├── grpc_reflection.rs    # gRPC server reflection (v1/v1alpha negotiation)
        ├── grpc_streaming.rs     # gRPC unary and streaming calls
        ├── grpc_proto.rs         # Proto descriptor handling
        ├── websocket.rs          # WebSocket connections
        ├── sse.rs                # Server-Sent Events streaming
        ├── mqtt.rs               # MQTT broker connections
        ├── graphql_subscription.rs  # GraphQL subscriptions (graphql-transport-ws)
        ├── mock_server.rs        # Mock server with Axum
        ├── scripts.rs            # JavaScript execution with Boa Engine
        ├── import_export/        # OpenAPI/Postman import and export
        ├── collections.rs        # Git-friendly collection file storage
        ├── store.rs              # Settings/data persistence
        ├── secrets.rs            # OS keychain secret storage
        ├── oauth.rs              # OAuth 2.0 token fetching
        ├── proxy.rs              # Proxy configuration
        ├── certificates.rs       # Native file picker for client certificate (mTLS) files
        ├── tls.rs                # Shared TLS helpers (PEM loading, skip-verify)
        └── updater.rs            # Auto-update and install-type detection
```

### Key Technologies

- **Tauri** (v2.0.0): Cross-platform desktop app framework with Rust backend
- **Rust**: Backend language for performance and security
- **reqwest** (v0.12): Async HTTP client with HTTP/2, SOCKS proxy support
- **Axum** (v0.7): Mock server HTTP framework
- **Boa Engine** (v0.19): JavaScript engine for script execution
- **CodeMirror** (v6.x): Advanced syntax highlighting and code editing
- **tauri-plugin-store**: Persistent configuration storage
- **serde_yaml**: YAML parsing for OpenAPI specs
- **esbuild** (v0.28.x): Fast JavaScript bundler
- **Jest** (v30.0.x): Testing framework

### Security Features

- Tauri's secure IPC communication
- Content Security Policy (CSP) enforcement
- Native system integration without Node.js in renderer
- Sandboxed JavaScript execution for scripts
- Minimal attack surface with Rust backend

## Development

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build frontend assets
- `npm run build:tauri` - Build production application
- `npm test` - Run tests with Jest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint to check code quality
- `npm run lint:fix` - Automatically fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

### Development Architecture

The application follows a modular MVC-like architecture:

- **Models**: Data structures and storage repositories
- **Views**: UI components and renderers
- **Controllers**: Coordination between models and views
- **Services**: Business logic and API interactions
- **Commands**: Rust backend IPC handlers

### Adding New Features

1. Create the feature's modules in the appropriate `src/modules/` subdirectories (controller, service, repository, UI) and export them from index files
2. Add a co-located `src/modules/<name>.feature.js` descriptor that wires the stack together
3. Register the descriptor on the `FeatureRegistry` in `renderer.js` with a single `.register(...)` call — avoid manual wiring in `renderer.js`
4. Add Tauri commands in `src-tauri/src/commands/` if backend functionality is needed
5. Register commands in `src-tauri/src/main.rs`

## Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use ES6 modules in frontend code
- Use Rust idioms in backend code
- Follow existing patterns and conventions
- Maintain security best practices
- Add JSDoc comments for public JavaScript APIs
- Add Rustdoc comments for public Rust APIs
- Use defensive programming in repository layer (validate data types, handle undefined)
- **Code Quality Tools**:
  - ESLint for JavaScript linting and quality checks
  - Run `npm run lint` before committing
  - Run `cargo clippy` for Rust linting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- Create an issue for bug reports or feature requests
- Check existing issues before creating new ones
- Provide detailed information for faster resolution

## Roadmap

### Completed

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

### Planned

- [ ] Response comparison and diff view
- [ ] Plugin system for extensions
- [ ] Team collaboration features

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- Inspired by modern API development tools

---

Made with love for the API development community
