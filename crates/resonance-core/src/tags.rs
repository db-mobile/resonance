//! Request tags: the normalization rule and the include/exclude filter that
//! the CLI, saved runners and the desktop runner all share. Matching is
//! case-insensitive; a filter with no include list passes every request, and
//! an exclude hit always wins.

use crate::model::RunInput;
use serde::{Deserialize, Serialize};

/// Trims, drops empties and dedupes case-insensitively, keeping the first
/// spelling and the original order.
pub fn normalize<I, S>(tags: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut out: Vec<String> = Vec::new();
    for tag in tags {
        let trimmed = tag.as_ref().trim();
        if trimmed.is_empty() || out.iter().any(|seen| same_tag(seen, trimmed)) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

/// Splits a comma-separated list the way the CLI and the dialog read it.
pub fn parse_list(text: &str) -> Vec<String> {
    normalize(text.split(','))
}

fn same_tag(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

fn any_match(wanted: &[String], tags: &[String]) -> bool {
    wanted.iter().any(|w| tags.iter().any(|t| same_tag(w, t)))
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TagFilter {
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub include: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
}

impl TagFilter {
    pub fn new<I, J, S, T>(include: I, exclude: J) -> Self
    where
        I: IntoIterator<Item = S>,
        J: IntoIterator<Item = T>,
        S: AsRef<str>,
        T: AsRef<str>,
    {
        Self {
            include: normalize(include),
            exclude: normalize(exclude),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.include.is_empty() && self.exclude.is_empty()
    }

    /// Whether a request carrying `tags` passes the filter.
    pub fn matches(&self, tags: &[String]) -> bool {
        if any_match(&self.exclude, tags) {
            return false;
        }
        self.include.is_empty() || any_match(&self.include, tags)
    }

    /// Drops the queued requests that do not pass, keeping order and duplicates.
    pub fn apply(&self, input: &mut RunInput) {
        if self.is_empty() {
            return;
        }
        input
            .requests
            .retain(|template| self.matches(&template.tags));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::RequestTemplate;

    fn tags(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| t.to_string()).collect()
    }

    #[test]
    fn normalize_trims_drops_empties_and_dedupes_case_insensitively() {
        assert_eq!(
            normalize([" smoke ", "", "Smoke", "pets", "  ", "PETS", "auth"]),
            tags(&["smoke", "pets", "auth"])
        );
    }

    #[test]
    fn parse_list_splits_on_commas() {
        assert_eq!(
            parse_list("smoke, Pets ,,auth,pets"),
            tags(&["smoke", "Pets", "auth"])
        );
        assert!(parse_list("  ,  ").is_empty());
    }

    #[test]
    fn an_empty_filter_passes_everything() {
        let filter = TagFilter::default();
        assert!(filter.is_empty());
        assert!(filter.matches(&[]));
        assert!(filter.matches(&tags(&["slow"])));
    }

    #[test]
    fn include_matches_any_tag_case_insensitively() {
        let filter = TagFilter::new(["SMOKE", "auth"], Vec::<String>::new());
        assert!(filter.matches(&tags(&["pets", "smoke"])));
        assert!(filter.matches(&tags(&["Auth"])));
        assert!(!filter.matches(&tags(&["pets"])));
        assert!(!filter.matches(&[]));
    }

    #[test]
    fn exclude_wins_over_include() {
        let filter = TagFilter::new(["smoke"], ["slow"]);
        assert!(filter.matches(&tags(&["smoke"])));
        assert!(!filter.matches(&tags(&["smoke", "Slow"])));
        let exclude_only = TagFilter::new(Vec::<String>::new(), ["slow"]);
        assert!(exclude_only.matches(&[]));
        assert!(!exclude_only.matches(&tags(&["slow"])));
    }

    #[test]
    fn apply_retains_matching_templates_in_order() {
        let template = |name: &str, list: &[&str]| RequestTemplate {
            name: name.into(),
            tags: tags(list),
            ..RequestTemplate::default()
        };
        let mut input = RunInput {
            execution_id: "x".into(),
            runner_id: None,
            runner_name: String::new(),
            requests: vec![
                template("a", &["smoke"]),
                template("b", &[]),
                template("c", &["smoke", "slow"]),
                template("a", &["smoke"]),
            ],
            context: Default::default(),
            options: Default::default(),
            data_file: None,
        };
        TagFilter::new(["smoke"], ["slow"]).apply(&mut input);
        let names: Vec<&str> = input.requests.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["a", "a"]);
    }

    #[test]
    fn serialization_omits_empty_lists() {
        let json = serde_json::to_string(&TagFilter::new(["smoke"], Vec::<String>::new())).unwrap();
        assert_eq!(json, r#"{"include":["smoke"]}"#);
        let parsed: TagFilter = serde_json::from_str(r#"{"exclude":["slow"]}"#).unwrap();
        assert_eq!(parsed, TagFilter::new(Vec::<String>::new(), ["slow"]));
    }
}
