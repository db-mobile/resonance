# Resonance 🎵

A clean and minimal API client with excellent user experience built with Electron.

![Resonance API Client](https://img.shields.io/badge/License-MIT-blue.svg)
![Electron](https://img.shields.io/badge/Electron-v35.0.0-brightgreen.svg)
![Node.js](https://img.shields.io/badge/Node.js-Latest-green.svg)

## Features ✨

- **OpenAPI/Swagger Import**: Import OpenAPI 3.0 specifications (YAML/JSON) and automatically generate organized request collections
- **Variable Templating**: Use `{{ variableName }}` syntax for dynamic values in URLs, headers, and request bodies
- **Schema-Based Body Generation**: Automatically generate example request bodies from OpenAPI schemas
- **Multi-Theme Support**: Light, dark, system-adaptive, and blueprint themes
- **Internationalization**: Support for English, German, Spanish, French, and Italian
- **Secure Architecture**: Built with security best practices including context isolation and secure IPC
- **Persistent Storage**: Collections, variables, and settings are automatically saved and restored
- **Modern UI**: Clean, minimal interface with tabbed request/response views

## Screenshots 📸

*Add screenshots here to showcase your application*

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

Package the application for your current platform:
```bash
npm run package
```

Create distributables (zip, deb, rpm, etc.):
```bash
npm run make
```

Create Debian package specifically:
```bash
npm run make:debian
```

**Note:** The application uses ASAR packaging for improved performance and security.

## Usage 📖

### Getting Started

1. **Import Collections**: Use File > Import Collection to load OpenAPI/Swagger specifications
2. **Set Variables**: Define reusable variables like API keys and base URLs in the Variables panel
3. **Make Requests**: Select endpoints from the collections sidebar and configure headers, query parameters, and request bodies
4. **View Responses**: Examine response data in the tabbed response viewer

### Variable System

Variables use the `{{ variableName }}` syntax and can be used in:
- Request URLs
- Headers
- Query parameters 
- Request bodies

Example:
```
URL: {{ baseUrl }}/users/{{ userId }}
Header: Authorization: Bearer {{ apiKey }}
```

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
│   ├── controllers/    # MVC controllers
│   ├── services/       # Business logic
│   ├── storage/        # Data persistence with validation
│   ├── ui/            # UI components
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
- `npm run package` - Package for current platform
- `npm run make` - Create all distributables
- `npm run make:debian` - Create Debian (.deb) package
- `npm test` - Run tests (not configured yet)

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
- [x] Authentication support (Bearer, Basic, API Key, OAuth2)
- [ ] Test suite implementation
- [ ] Plugin system for extensions
- [ ] More export formats (Postman, Insomnia)
- [ ] GraphQL support
- [ ] Request history and bookmarks
- [ ] Team collaboration features
- [ ] Environment management (Dev, Staging, Production)
- [ ] Response caching and mock servers

## Acknowledgments 🙏

- Built with [Electron](https://electronjs.org/)
- Icons from [Lucide](https://lucide.dev/)
- Inspired by modern API development tools

---

Made with ❤️ for the API development community