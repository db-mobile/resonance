# Theme System

This directory contains individual CSS files for each theme. The theme system supports dynamic loading and easy extensibility.

## Available Themes

- **light.css** - Clean and bright interface (default light theme)
- **dark.css** - Easy on the eyes with dark backgrounds
- **system.css** - Automatically follows OS preference using CSS media queries
- **blueprint.css** - Example custom theme with blue-tinted colors

## Adding a New Theme

To create a new theme:

1. **Create a new CSS file** in this directory (e.g., `mytheme.css`)

2. **Define the required CSS variables**:
```css
/**
 * My Custom Theme
 * Description of your theme
 */
:root {
  /* Text Colors */
  --text-primary: #your-color;
  --text-secondary: #your-color;
  --text-tertiary: #your-color;
  --text-disabled: #your-color;
  --text-inverse: #your-color;
  
  /* Background Colors */
  --bg-primary: #your-color;
  --bg-secondary: #your-color;
  --bg-tertiary: #your-color;
  --bg-overlay: rgba(your, colors, with, alpha);
  --bg-glass: rgba(your, colors, with, alpha);
  --bg-glass-strong: rgba(your, colors, with, alpha);
  
  /* Border Colors */
  --border-light: #your-color;
  --border-medium: #your-color;
  --border-strong: #your-color;
  --border-focus: var(--color-primary);
  --border-glass: rgba(your, colors, with, alpha);
  
  /* Shadows */
  --shadow-xs: 0 1px 2px 0 rgba(your, shadow, colors);
  --shadow-sm: 0 1px 3px 0 rgba(...), 0 1px 2px 0 rgba(...);
  --shadow-base: 0 4px 6px -1px rgba(...), 0 2px 4px -1px rgba(...);
  --shadow-md: 0 10px 15px -3px rgba(...), 0 4px 6px -2px rgba(...);
  --shadow-lg: 0 20px 25px -5px rgba(...), 0 10px 10px -5px rgba(...);
  --shadow-xl: 0 25px 50px -12px rgba(...);
  
  /* Accent Colors */
  --color-success-light: #your-color;
  --color-warning-light: #your-color;
  --color-error-light: #your-color;
  --color-primary-light: #your-color;
}
```

3. **Register the theme** in your application:
```javascript
// Add to available themes
themeManager.addTheme('mytheme');

// Apply the theme
await themeManager.setTheme('mytheme');
```

## Theme Structure

### Required Variables

All themes must define these CSS custom properties:

#### Text Colors
- `--text-primary` - Main text color
- `--text-secondary` - Secondary text color  
- `--text-tertiary` - Tertiary/muted text color
- `--text-disabled` - Disabled text color
- `--text-inverse` - Inverse text color (for dark backgrounds)

#### Background Colors
- `--bg-primary` - Main background color
- `--bg-secondary` - Secondary background color
- `--bg-tertiary` - Tertiary background color
- `--bg-overlay` - Overlay background with transparency
- `--bg-glass` - Glass effect background
- `--bg-glass-strong` - Stronger glass effect

#### Border Colors
- `--border-light` - Light border color
- `--border-medium` - Medium border color
- `--border-strong` - Strong border color
- `--border-focus` - Focus state border color
- `--border-glass` - Glass effect border

#### Shadows
- `--shadow-xs` through `--shadow-xl` - Various shadow depths
- Should match the theme's color scheme

#### Accent Colors
- `--color-success-light` - Success state background
- `--color-warning-light` - Warning state background
- `--color-error-light` - Error state background
- `--color-primary-light` - Primary accent background

## Dynamic Loading

Themes are loaded dynamically by the ThemeManager:

1. When a theme is selected, the previous theme CSS is removed
2. A new `<link>` element is created pointing to the theme file
3. The CSS is loaded and applied to the document
4. The theme preference is saved for persistence

## Best Practices

1. **Use semantic color names** - Name colors based on their purpose, not their appearance
2. **Maintain contrast ratios** - Ensure text is readable on backgrounds
3. **Test with all UI states** - Check hover, focus, disabled, and active states
4. **Consider accessibility** - Follow WCAG guidelines for color contrast
5. **Use the base color palette** - Reference the predefined color variables when possible

## Base Color Palette

The main style.css file defines a base color palette that themes can reference:

- `--color-white` through `--color-gray-900` - Neutral grays
- `--color-dark-50` through `--color-dark-900` - Dark theme colors
- `--color-primary`, `--color-success`, `--color-warning`, `--color-error` - Accent colors

## System Theme

The system theme (`system.css`) uses CSS media queries to automatically switch between light and dark modes based on the user's OS preference:

```css
/* Default light theme */
:root { /* light colors */ }

/* Dark theme when system prefers dark */
@media (prefers-color-scheme: dark) {
  :root { /* dark colors */ }
}
```