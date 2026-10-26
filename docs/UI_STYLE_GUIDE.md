# UI style guide

Resonance uses a compact desktop interface. Build on the shared widgets and
semantic tokens in `src/styles/`; feature styles should describe layout and
intentional exceptions rather than duplicate controls.

## Controls and hierarchy

- Standard buttons, entries and selects are at least 34px high; compact controls
  are 28px. Existing embedded file actions may use 24px. Textareas and multiline
  controls grow with their contents.
- Action icons are 16px; disclosure arrows are 12px. Navigation illustrations and
  empty-state artwork retain their larger sizes. Icon-only actions use square
  hit areas, including compact 28px actions and 24px embedded row actions.
- Use primary accent styling for the main action, neutral styling for secondary
  actions, flat styling for utilities and destructive styling for destructive
  actions. Preserve the existing control order and behavior.
- Use the existing body (14px), small (13px), caption (12px) and heading tokens.
  Technical values use `--font-mono`; durations and counts use tabular numerals.
- Use the spacing scale: 6px between adjacent controls, 12px within panels and
  18px between sections. Preserve deliberate tighter tree and table row spacing.
- Controls use the small radius, cards the medium radius, dialogs the large
  radius and badges the pill radius.

## Shared patterns

- `.button` and `.btn` are aliases. Keep existing IDs, state classes and data
  attributes when applying shared styling; they are JavaScript hooks.
- Settings tabs, response view switches and runner tabs use the view-switcher
  widget. Inset switcher buttons are 22px high inside 3px padding, matching 28px
  compact controls. Flat tab buttons are 28px. Both `.active` and `.is-active`
  indicate selection.
- Badges share 12px typography, padding and severity colors. Connection badges
  add a dot and retain existing state transitions and motion. State text keeps
  its supplied casing. HTTP status, validation and runner summaries use the
  same neutral/success/warning/error/accent palette.
- Use semantic surface and foreground colors in both themes. Preserve HTTP
  method colors and the distinct GraphQL identifier hue through theme tokens.
- Accent swatches retain the palette. Primary actions use the darker
  `--accent-action-bg-color` for readable labels; yellow retains its dark label.
  Status badges use an 8% semantic tint. Focus rings use the full semantic color.
- Focus must remain visible, including on actions normally revealed by hover.
  Disabled controls remain distinguishable. Respect reduced-motion settings.
- Let crowded toolbars and metadata wrap. Keep dialog headers/footers reachable
  and scroll their contents; preserve usable input and editor widths.

## Intentional exceptions

- Workspace navigation, tree rows and result tables retain their different
  densities; method identifiers remain compact and monospace.
- Editable cells in boxed environment-variable rows retain their flat treatment;
  focus still uses the shared entry outline.
- Dialog titles remain centered. Alert dialogs retain their divided 46px action
  rows and circular close controls retain their shape.
- Color swatches, switches, disclosure glyphs, connection dots, editor syntax
  colors, performance charts and rendered response documents are specialized
  visuals, not standard buttons or badges.
- Blank/empty states dim supporting text and artwork individually, not their
  entire container: actions and headings must retain readable contrast.

## Verification

Use identical demo data and window geometry for before/after native screenshots.
Review all protocols, navigation, runner, settings, manager dialogs and toasts in
light and dark at 1000×700 and 1440×900; check 125%/200% scaling, long names and
URLs, German labels, both workspace layouts, all accents and system theme.
Check loading, success, error, empty, disabled, hover and keyboard-focus states.
Target 4.5:1 contrast for normal text and 3:1 for focus/control indicators.

Run `npm run lint`, `npm test -- --runInBand` and `npm run build:prod`.
Visual assertions require runtime inspection; jsdom does not measure layout.
