# Theme System

`themeManager.js` injects one theme
file at a time as a `<link>` and sets `data-theme` on the root element; the
`system` mode resolves to `light.css` or `dark.css` via `prefers-color-scheme`
and re-resolves on OS changes.

## Available themes

- **light.css** — Light palette
- **dark.css** — Dark palette
- `system` — virtual mode, loads one of the two files above

## Token contract

`src/styles/tokens.css` declares the full light palette as defaults, so
`light.css` only sets `color-scheme: light` and the per-accent
`--accent-color` values. A theme file overrides whatever differs from
those defaults; `dark.css` overrides all of them. The named colors,
grouped:

- **Surfaces**: `--window-bg-color`, `--window-fg-color`, `--view-bg-color`,
  `--view-fg-color`, `--headerbar-bg-color`, `--headerbar-fg-color`,
  `--headerbar-shade-color`, `--sidebar-bg-color`, `--sidebar-fg-color`,
  `--sidebar-shade-color`, `--card-bg-color`,
  `--card-fg-color`, `--card-shade-color`, `--dialog-bg-color`,
  `--dialog-fg-color`, `--popover-bg-color`, `--popover-fg-color`,
  `--popover-shade-color`
- **Generic**: `--shade-color`, `--scrim-color`, `--border-color`,
  plus `color-scheme: light | dark`
- **Feedback**: `--destructive-bg/fg-color`, `--destructive-color`,
  `--success-bg-color`, `--success-color`, `--warning-color`,
  `--error-color` (the `-color` variant is the standalone color used for
  text/icons on regular surfaces; `-bg/-fg` pairs are for filled widgets)
- **Domain**: `--method-{get,post,put,delete,patch}-color` (badge backgrounds
  are derived in tokens.css via `color-mix`)
- **Accent standalone colors**: `:root[data-accent="<name>"] { --accent-color: … }`
  for all nine accent names (`green, teal, blue, indigo, purple, yellow,
  orange, red, pink`). The filled-accent pair `--accent-bg-color` /
  `--accent-fg-color` is theme-independent and lives in tokens.css.

Accents are applied via the `data-accent` attribute on the root element,
managed by `themeManager.js`.

## Adding a theme

Create `<name>.css` overriding the tokens above (all of them for a dark
palette, only the deltas for a light one), then register the name
with `themeManager.registerTheme('<name>')` (or add it to `availableThemes`).
