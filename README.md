# Resonance

A clean and minimal API client with excellent user experience built with Electron.

![Resonance API Client](https://img.shields.io/badge/License-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-v35.0.0-brightgreen.svg)
![Node.js](https://img.shields.io/badge/Node.js-Latest-green.svg)

## Features

### Collection Import & Management
- **OpenAPI/Swagger Import**: Import OpenAPI 3.0 specifications (YAML/JSON) with automatic schema-based example generation
- **Postman Import**: Import Postman Collection Format v2.0 and v2.1 files
- **Postman Environment Import**: Import Postman environment files with variables
- **Smart Folder Organization**: Both formats create consistent flat folder structures by path segment

### Code Generation
- **Multi-Language Export**: Generate request code in 9 languages:
  - cURL, Python (requests), JavaScript (Fetch), JavaScript (Axios)
  - Node.js (axios), Go (net/http), PHP (cURL), Ruby (net/http), Java (HttpClient)

### GraphQL Support
- **Full GraphQL Integration**: Dedicated editors for GraphQL queries and testing
  - Dropdown selector to switch between JSON and GraphQL body modes
  - GraphQL query editor with syntax highlighting
  - Variables editor with JSON syntax highlighting and validation
  - Query formatting with format button
  - Auto-save functionality for queries and variables

### Advanced Features
- **Scripts & Automation**: Pre-request and test scripts with JavaScript execution
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
- **Proxy Support**: HTTP/HTTPS proxy configuration with authentication and bypass lists
- **Mock Server**: Local HTTP mock server for testing API clients without a backend
  - Generate responses from OpenAPI schemas automatically
  - Configure custom response bodies and delays per endpoint
  - Enable/disable collections individually
  - Real-time request logging and monitoring

### Environment & Variables
- **Environment Management**: Organize variables into environments (Development, Staging, Production, etc.)
- **Variable Templating**: Use `{{ variableName }}` syntax for dynamic values in URLs, headers, and request bodies
- **Environment Switching**: Quick dropdown selector to switch between different API contexts
- **Import/Export**: Share environments with your team or backup as JSON files

### Authentication
- **Multiple Auth Methods**: Bearer Token, Basic Auth, API Key, OAuth 2.0, Digest Auth
- **Per-Request Configuration**: Set authentication at request, folder, or collection level
- **Secure Credential Storage**: All credentials encrypted and stored securely

### User Experience
- **Keyboard Shortcuts**: Comprehensive shortcuts for all actions with platform-aware bindings (⌘/Ctrl)
- **Multi-Theme Support**: Light, dark, system-adaptive, and blueprint themes
- **Internationalization**: Full support for English, German, Spanish, French, and Italian
- **Syntax Highlighting**: CodeMirror-based response viewer with automatic language detection
- **Resizable Panels**: Customizable workspace layout with draggable panel dividers

### Technical Features
- **HTTP Version Control**: Support for HTTP/1.1, HTTP/2, and HTTP/3
- **Request Timeouts**: Configurable timeout settings per request
- **Secure Architecture**: Context isolation, secure IPC, and ASAR packaging
- **Persistent Storage**: Auto-save for collections, variables, environments, settings, and history

## Screenshots

![Alt text](/assets/screenshots/main_window.png?raw=true "Main interface showing API request configuration")

## Installation

### Prerequisites

- **Node.js** v18.0.0 or higher (v20.x or later recommended)
- **Git** (for cloning the repository)

**Note:** npm comes bundled with Node.js and is the default package manager for this project.

### From Source

1. Clone the repository:
```bash
git clone https://github.com/db-mobile/resonance.git
cd resonance
```

2. Install dependencies:
```bash
npm install
```

3. Start the application:
```bash
npm start
```

### Build for Distribution

Build the application:
```bash
npm run build
```

Create distributables for all platforms:
```bash
npm run dist
```

Create Linux-specific distributables:
```bash
npm run dist:linux
```

Create directory distribution (unpacked):
```bash
npm run dist:dir
```

**Note:** The application uses ASAR packaging for improved performance and security. Builds are created using electron-builder.

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
7. **View Responses**: Examine response data in the tabbed viewer (Body, Headers, Cookies, Performance, Scripts)
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

### Authentication

Resonance supports multiple authentication methods:
- **Bearer Token**: OAuth 2.0 and custom bearer tokens
- **Basic Auth**: Username/password authentication with base64 encoding
- **API Key**: Custom header or query parameter authentication
- **OAuth 2.0**: Flexible OAuth 2.0 authentication with custom prefixes
- **Digest Auth**: RFC 2617 compliant Digest authentication with MD5 hashing

All authentication credentials are automatically applied to requests and work seamlessly with the variable templating system.

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
const apiKey = environment.get('API_KEY');
request.headers['Authorization'] = `Bearer ${apiKey}`;
console.log('Added auth header');
```

Generate timestamps and signatures:
```javascript
const timestamp = Date.now();
request.headers['X-Timestamp'] = timestamp.toString();
request.headers['X-Signature'] = btoa(`${request.method}:${timestamp}`);
```

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
environment.set('AUTH_TOKEN', token);
console.log('Token saved for subsequent requests');
```

Check performance:
```javascript
expect(response.status).toBe(200);
expect(response.timings.total).toBeLessThan(1000);
console.log('Response time:', response.timings.total, 'ms');
```

**Available APIs**

Scripts have access to powerful APIs:
- `request` - Modify URL, method, headers, body, query params, path params
- `response` (test only) - Access status, headers, body, cookies, timings
- `environment` - Get/set/delete environment variables
- `console` - Log messages (log, info, warn, error)
- `expect()` - Rich assertion library (toBe, toEqual, toContain, toHaveProperty, toMatch, etc.)

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
2. Use the dropdown selector at the top to switch from **JSON** to **GraphQL**
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
- **Blueprint**: Technical schematic-inspired design

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
├── main.js              # Main Electron process entry point
├── main/                # Main process modules
│   ├── windowManager.js        # Window lifecycle management
│   ├── apiRequestHandlers.js   # HTTP request handling
│   ├── storeHandlers.js        # Data persistence with fallbacks
│   ├── schemaProcessor.js      # OpenAPI schema processing
│   ├── openApiParser.js        # OpenAPI file import
│   ├── postmanParser.js        # Postman collection & environment import
│   ├── digestAuthHandler.js    # Digest authentication
│   ├── proxyHandlers.js        # Proxy configuration
│   ├── scriptExecutor.js       # Sandboxed script execution engine
│   ├── scriptHandlers.js       # Script execution IPC handlers
│   └── mockServerHandler.js    # Mock server HTTP handling
├── renderer.js          # Renderer process coordinator
├── preload.js           # Secure context bridge
├── style.css           # Global styles
├── modules/            # Modular renderer components
│   ├── controllers/    # MVC controllers (Collection, Environment, History, Script, Proxy, WorkspaceTab, MockServer)
│   ├── services/       # Business logic services (Script, Environment, Collection, etc.)
│   ├── storage/        # Data persistence repositories (Script, Environment, Collection, etc.)
│   ├── ui/            # UI components (dialogs, renderers, selectors, script editors)
│   ├── variables/     # Variable processing and templating
│   ├── schema/        # OpenAPI schema handling
│   ├── codeGenerator.js       # Multi-language code export
│   ├── cookieParser.js        # Cookie parsing and display
│   ├── performanceMetrics.js  # Performance timing visualization
│   ├── scriptSubTabs.js       # Script editor sub-tabs management
│   └── [26+ other modules]
├── themes/            # Theme CSS files
└── i18n/             # Internationalization (5 languages)
```

### Key Technologies

- **Electron** (v35.0.0): Cross-platform desktop app framework
- **Axios** (v1.10.0): HTTP client for API requests
- **CodeMirror** (v6.x): Advanced syntax highlighting and code editing
- **electron-store** (v10.1.0): Persistent configuration storage
- **js-yaml** (v4.1.0): YAML parsing for OpenAPI specs
- **electron-window-state** (v5.0.3): Window state management
- **esbuild** (v0.25.x): Fast JavaScript bundler
- **electron-builder** (v26.0.x): Application packaging
- **Jest** (v30.0.x): Testing framework

### Security Features

- Context isolation enabled
- Node.js integration disabled in renderer
- Secure IPC communication via contextBridge
- Preload script for safe API exposure using `__dirname` for reliable path resolution
- Electron Forge fuses for additional security:
  - RunAsNode disabled
  - Cookie encryption enabled
  - ASAR integrity validation enabled
  - Only load app from ASAR in production

## Development

### Scripts

- `npm start` - Start development server
- `npm run build` - Build the application
- `npm run dist` - Create distributables for all platforms
- `npm run dist:linux` - Create Linux-specific distributables
- `npm run dist:dir` - Create directory distribution (unpacked)
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

### Adding New Features

1. Create modules in appropriate `src/modules/` subdirectories
2. Export functionality from index files
3. Import and initialize in `renderer.js`
4. Add IPC handlers in `main.js` if needed

## Contributing

We welcome contributions! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Code Style

- Use ES6 modules in renderer process
- Use ES6 modules in main process (since v1.0.0)
- Use CommonJS in preload script only
- Follow existing patterns and conventions
- Maintain security best practices
- Add JSDoc comments for public APIs
- Use defensive programming in repository layer (validate data types, handle undefined)
- **Code Quality Tools**:
  - ESLint for code linting and quality checks
  - Prettier for consistent code formatting
  - Run `npm run lint` before committing
  - Use `npm run format` to auto-format code

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
- [x] Proxy support with authentication
- [x] Variable templating system with environment support
- [x] Multi-theme support (3 themes)
- [x] Internationalization (5 languages)
- [x] Authentication support (Bearer, Basic, API Key, OAuth2, Digest)
- [x] Request history with search and replay
- [x] Environment management (Dev, Staging, Production, custom)
- [x] Keyboard shortcuts for all major actions
- [x] Mock server with custom responses and delays
- [x] Collection export (OpenAPI format)
- [x] Pre-request and test scripts with JavaScript execution
- [x] Automated testing framework with rich assertion API
- [x] Request chaining with environment variable integration
- [x] GraphQL support with dedicated query and variables editors

### Planned
- [ ] WebSocket support
- [ ] Response comparison and diff view
- [ ] gRPC support
- [ ] Collection runner for batch execution
- [ ] Plugin system for extensions
- [ ] Team collaboration features

## Acknowledgments

- Built with [Electron](https://electronjs.org/)
- Inspired by modern API development tools

---

Made with love for the API development community