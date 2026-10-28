use std::path::{Path, PathBuf};

const BUILT_IN_THEMES: [&str; 3] = ["Adwaita", "HighContrast", "HighContrastInverse"];
const FALLBACK_THEME: &str = "Adwaita";

pub fn ensure_loadable() {
    use gtk::prelude::*;
    let Some(settings) = gtk::Settings::default() else {
        return;
    };
    let Some(name) = settings.gtk_theme_name() else {
        return;
    };
    if theme_available(name.as_str(), &theme_dirs()) {
        return;
    }
    settings.set_gtk_theme_name(Some(FALLBACK_THEME));
}

fn theme_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".themes"));
    }
    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME") {
        dirs.push(PathBuf::from(data_home).join("themes"));
    }
    let data_dirs =
        std::env::var("XDG_DATA_DIRS").unwrap_or_else(|_| "/usr/local/share:/usr/share".into());
    dirs.extend(
        data_dirs
            .split(':')
            .filter(|dir| !dir.is_empty())
            .map(|dir| PathBuf::from(dir).join("themes")),
    );
    dirs
}

fn theme_available(name: &str, dirs: &[PathBuf]) -> bool {
    BUILT_IN_THEMES.contains(&name) || dirs.iter().any(|dir| has_gtk3_css(&dir.join(name)))
}

fn has_gtk3_css(theme_dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(theme_dir) else {
        return false;
    };
    entries.flatten().any(|entry| {
        entry
            .file_name()
            .to_str()
            .is_some_and(|dir| dir.starts_with("gtk-3."))
            && entry.path().join("gtk.css").is_file()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("resonance-gtk-theme-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn built_in_themes_are_always_available() {
        assert!(theme_available("Adwaita", &[]));
        assert!(theme_available("HighContrast", &[]));
    }

    #[test]
    fn missing_theme_is_not_available() {
        let dir = scratch("missing");
        assert!(!theme_available("Yaru-blue-dark", &[dir.clone()]));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn theme_with_gtk3_css_is_available() {
        let dir = scratch("present");
        let css_dir = dir.join("Yaru-dark").join("gtk-3.0");
        std::fs::create_dir_all(&css_dir).unwrap();
        std::fs::write(css_dir.join("gtk.css"), "").unwrap();
        assert!(theme_available("Yaru-dark", &[dir.clone()]));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn theme_dir_without_gtk3_css_is_not_available() {
        let dir = scratch("gtk2only");
        std::fs::create_dir_all(dir.join("Legacy").join("gtk-2.0")).unwrap();
        assert!(!theme_available("Legacy", &[dir.clone()]));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
