# Resonance 🎵

A clean and minimal API client with excellent user experience built with Electron.

![Resonance API Client](https://img.shields.io/badge/License-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-v35.0.0-brightgreen.svg)
![Node.js](https://img.shields.io/badge/Node.js-Latest-green.svg)

## Features ✨

- **OpenAPI/Swagger Import**: Import OpenAPI 3.0 specifications (YAML/JSON) and automatically generate organized request collections
- **Environment Management**: Organize variables into environments (Development, Staging, Production, etc.) for easy context switching
- **Variable Templating**: Use `{{ variableName }}` syntax for dynamic values in URLs, headers, and request bodies
- **Schema-Based Body Generation**: Automatically generate example request bodies from OpenAPI schemas
- **Keyboard Shortcuts**: Comprehensive keyboard shortcuts for all common actions with platform-aware bindings (⌘ on macOS, Ctrl on Windows/Linux)
- **Multi-Theme Support**: Light, dark, system-adaptive, and blueprint themes
- **Internationalization**: Support for English, German, Spanish, French, and Italian
- **Import/Export**: Export and import environments as JSON for backup and team sharing
- **Secure Architecture**: Built with security best practices including context isolation and secure IPC
- **Persistent Storage**: Collections, variables, environments, and settings are automatically saved and restored
- **Modern UI**: Clean, minimal interface with tabbed request/response views and environment selector

## Screenshots 📸

![Alt text](/assets/screenshots/main_window.png?raw=true "Main interface showing API request configuration")

## Installation 🚀

### Prerequisites

- Node.js (Latest stable version)
- npm or yarn

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

## Usage 📖

### Getting Started

1. **Create Environments**: Set up environments (Development, Staging, Production) with environment-specific variables
2. **Import Collections**: Use File > Import Collection to load OpenAPI/Swagger specifications
3. **Set Variables**: Define reusable variables like API keys and base URLs within each environment
4. **Switch Environments**: Use the environment selector dropdown to quickly switch between different API contexts
5. **Make Requests**: Select endpoints from the collections sidebar and configure headers, query parameters, and request bodies
6. **View Responses**: Examine response data in the tabbed response viewer

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

### OpenAPI Integration

Resonance automatically:
- Parses OpenAPI 3.0 specifications
- Generates organized endpoint collections
- Creates example request bodies from schemas
- Resolves schema references and nested objects

### Themes

Switch between themes in Settings:
- **Light**: Clean, bright interface
- **Dark**: Easy on the eyes for low-light environments
- **System**: Automatically matches your OS theme
- **Blueprint**: Technical schematic-inspired design

## Keyboard Shortcuts ⌨️

Resonance includes comprehensive keyboard shortcuts to speed up your workflow. Press `Ctrl+/` (or `Cmd+/` on macOS) to view the shortcuts help dialog in the app.

### Request Actions
- `Ctrl/Cmd+Enter` - Send request
- `Esc` - Cancel current request

### Navigation
- `Ctrl/Cmd+L` - Focus URL bar
- `Ctrl/Cmd+B` - Toggle collections sidebar
- `Ctrl/Cmd+H` - Toggle history sidebar

### Actions
- `Ctrl/Cmd+K` - Generate cURL command
- `Ctrl/Cmd+O` - Import OpenAPI collection
- `Ctrl/Cmd+E` - Open environment manager

### Settings & Help
- `Ctrl/Cmd+,` - Open settings
- `Ctrl/Cmd+/` or `Shift+/` - Show keyboard shortcuts help

### Tab Switching
- `Ctrl/Cmd+1` - Switch to Path Params tab
- `Ctrl/Cmd+2` - Switch to Query Params tab
- `Ctrl/Cmd+3` - Switch to Headers tab
- `Ctrl/Cmd+4` - Switch to Body tab
- `Ctrl/Cmd+5` - Switch to Auth tab

**Note:** On macOS, use `Cmd` instead of `Ctrl`. Shortcuts are platform-aware and automatically adapt.

## Architecture 🏗️

### Project Structure

```
src/
├── main.js              # Main Electron process entry point
├── main/                # Main process modules
│   ├── windowManager.js      # Window lifecycle management
│   ├── apiRequestHandlers.js # HTTP request handling
│   ├── storeHandlers.js      # Data persistence with fallbacks
│   ├── schemaProcessor.js    # OpenAPI schema processing
│   └── openApiParser.js      # OpenAPI file import
├── renderer.js          # Renderer process coordinator
├── preload.js           # Secure context bridge
├── style.css           # Global styles
├── modules/            # Modular renderer components
│   ├── controllers/    # MVC controllers (Collection, Environment, History)
│   ├── services/       # Business logic (Collection, Environment, History, Variable)
│   ├── storage/        # Data persistence with validation
│   ├── ui/            # UI components (including EnvironmentManager, EnvironmentSelector)
│   ├── variables/     # Variable processing
│   └── schema/        # OpenAPI schema handling
├── themes/            # Theme CSS files
└── i18n/             # Internationalization
```

### Key Technologies

- **Electron**: Cross-platform desktop app framework
- **Axios**: HTTP client for API requests
- **electron-store**: Persistent configuration storage
- **js-yaml**: YAML parsing for OpenAPI specs
- **electron-window-state**: Window state management

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

## Development 🛠️

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

## Contributing 🤝

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

## License 📄

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support 💬

- Create an issue for bug reports or feature requests
- Check existing issues before creating new ones
- Provide detailed information for faster resolution

## Roadmap 🗺️

- [x] OpenAPI 3.0 import
- [x] Variable templating system
- [x] Multi-theme support
- [x] Internationalization
- [x] Authentication support (Bearer, Basic, API Key, OAuth2, Digest)
- [x] Request history and bookmarks
- [x] Environment management (Dev, Staging, Production)
- [x] Test suite implementation (Jest configured)
- [x] Keyboard shortcuts for all major actions
- [ ] Plugin system for extensions
- [ ] More export formats (Postman, Insomnia)
- [ ] GraphQL support
- [ ] Team collaboration features
- [ ] Response caching and mock servers

## Acknowledgments 🙏

- Built with [Electron](https://electronjs.org/)
- Inspired by modern API development tools

---

Made with ❤️ for the API development community