# Theme System

Themes are Adwaita-derived color palettes. `themeManager.js` injects one theme
file at a time as a `<link>` and sets `data-theme` on the root element; the
`system` mode resolves to `light.css` or `dark.css` via `prefers-color-scheme`
and re-resolves on OS changes.

## Available themes

- **light.css** — Adwaita light palette
- **dark.css** — Adwaita dark palette
- `system` — virtual mode, loads one of the two files above

## Token contract

Every theme file must define the libadwaita-style named colors that
`src/styles/tokens.css` declares light defaults for. Grouped:

- **Surfaces**: `--window-bg-color`, `--window-fg-color`, `--view-bg-color`,
  `--view-fg-color`, `--headerbar-bg-color`, `--headerbar-fg-color`,
  `--headerbar-shade-color`, `--sidebar-bg-color`, `--sidebar-fg-color`,
  `--sidebar-backdrop-color`, `--sidebar-shade-color`, `--card-bg-color`,
  `--card-fg-color`, `--card-shade-color`, `--dialog-bg-color`,
  `--dialog-fg-color`, `--popover-bg-color`, `--popover-fg-color`,
  `--popover-shade-color`
- **Generic**: `--shade-color`, `--scrim-color`, `--border-color`,
  plus `color-scheme: light | dark`
- **Feedback**: `--destructive-bg/fg-color`, `--destructive-color`,
  `--success-*`, `--warning-*`, `--error-*` (the `-color` variant is the
  standalone color used for text/icons on regular surfaces; `-bg/-fg` pairs
  are for filled widgets)
- **Domain**: `--method-{get,post,put,delete,patch}-color` (badge backgrounds
  are derived in tokens.css via `color-mix`)
- **Accent standalone colors**: `:root[data-accent="<name>"] { --accent-color: … }`
  for all nine accent names (`green, teal, blue, indigo, purple, yellow,
  orange, red, pink`). The filled-accent pair `--accent-bg-color` /
  `--accent-fg-color` is theme-independent and lives in tokens.css.

Accents are applied via the `data-accent` attribute on the root element,
managed by `themeManager.js`.

## Adding a theme

Create `<name>.css` defining the full contract above, then register the name
with `themeManager.registerTheme('<name>')` (or add it to `availableThemes`).
