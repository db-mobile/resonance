use crate::model::Variables;
use regex::Regex;
use serde_json::Value;
use std::{collections::HashMap, sync::LazyLock};

static STATIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*\}\}").unwrap());
static DYNAMIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\{\{\s*\$([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]*))?\s*\}\}").unwrap());

/// Names left in a resolved request, in presentation order, without duplicates.
pub fn unresolved_names(value: &Value) -> Vec<String> {
    fn visit(value: &Value, names: &mut Vec<String>) {
        match value {
            Value::String(text) => {
                for name in STATIC
                    .captures_iter(text)
                    .map(|c| c[1].to_string())
                    .chain(DYNAMIC.captures_iter(text).map(|c| format!("${}", &c[1])))
                {
                    if !names.contains(&name) {
                        names.push(name);
                    }
                }
            }
            Value::Array(items) => items.iter().for_each(|v| visit(v, names)),
            Value::Object(fields) => fields.iter().for_each(|(k, v)| {
                visit(&Value::String(k.clone()), names);
                visit(v, names);
            }),
            _ => {}
        }
    }
    let mut names = vec![];
    visit(value, &mut names);
    names
}

/// JavaScript String(value), retained for template compatibility (locals stay typed).
pub fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|v| {
                if v.is_null() {
                    String::new()
                } else {
                    js_string(v)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
        _ => value.to_string(),
    }
}

#[derive(Default)]
pub struct VariableProcessor {
    cache: HashMap<String, String>,
}
impl VariableProcessor {
    pub fn text(&mut self, input: &str, variables: &Variables) -> String {
        let mut result = input.to_string();
        for _ in 0..10 {
            let dynamic = DYNAMIC.replace_all(&result, |caps: &regex::Captures<'_>| {
                let params = caps.get(2).map(|v| v.as_str()).unwrap_or("");
                let key = format!("{}:{params}", &caps[1]);
                if let Some(value) = self.cache.get(&key) {
                    return value.clone();
                }
                if let Some(value) = generate(&caps[1], params) {
                    self.cache.insert(key, value.clone());
                    value
                } else {
                    caps[0].to_string()
                }
            });
            let next = STATIC
                .replace_all(&dynamic, |caps: &regex::Captures<'_>| {
                    variables
                        .get(&caps[1])
                        .filter(|v| !v.is_null())
                        .map(js_string)
                        .unwrap_or_else(|| caps[0].to_string())
                })
                .into_owned();
            if next == result {
                break;
            }
            result = next;
        }
        result
    }
    pub fn value(&mut self, value: &Value, variables: &Variables) -> Value {
        match value {
            Value::String(s) => self.text(s, variables).into(),
            Value::Array(a) => a.iter().map(|v| self.value(v, variables)).collect(),
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, v)| (self.text(k, variables), self.value(v, variables)))
                    .collect(),
            ),
            v => v.clone(),
        }
    }
}
fn random() -> f64 {
    (uuid::Uuid::new_v4().as_u128() as u64 >> 11) as f64 / ((1u64 << 53) as f64)
}
fn int(min: i64, max: i64) -> i64 {
    min + (random() * (max as f64 - min as f64 + 1.0)).floor() as i64
}
fn positive(params: &str, default: usize, max: usize) -> usize {
    params
        .trim()
        .parse::<usize>()
        .ok()
        .filter(|n| *n > 0)
        .unwrap_or(default)
        .min(max)
}
fn range(params: &str, default_min: f64) -> (f64, f64) {
    let parts: Vec<_> = params.split(':').collect();
    let (a, b) = if parts.len() >= 2 {
        (
            parts[0].parse().unwrap_or(default_min),
            parts[1].trim().parse().unwrap_or(1000.0),
        )
    } else {
        (default_min, params.trim().parse().unwrap_or(1000.0))
    };
    (a.min(b), a.max(b))
}
fn random_string(count: usize) -> String {
    let chars = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    (0..count)
        .map(|_| chars[int(0, 61) as usize] as char)
        .collect()
}
fn choose(items: &[&str]) -> String {
    items[int(0, items.len() as i64 - 1) as usize].into()
}
fn generate(name: &str, params: &str) -> Option<String> {
    let now = chrono::Utc::now();
    Some(match name {
        "timestamp" => now.timestamp().to_string(),
        "timestampMs" => now.timestamp_millis().to_string(),
        "isoTimestamp" => now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        "uuid" => uuid::Uuid::new_v4().to_string(),
        "randomInt" => {
            let (a, b) = range(params, 0.0);
            int(a.trunc() as i64, b.trunc() as i64).to_string()
        }
        "randomString" => random_string(positive(params, 8, 1000)),
        "randomBoolean" => (random() < 0.5).to_string(),
        "randomEmail" => format!(
            "{}@{}",
            random_string(8).to_lowercase(),
            choose(EMAIL_DOMAINS)
        ),
        "randomName" => format!("{} {}", choose(FIRST_NAMES), choose(LAST_NAMES)),
        "randomIPv4" => format!(
            "{}.{}.{}.{}",
            int(1, 254),
            int(0, 255),
            int(0, 255),
            int(0, 255)
        ),
        "randomUrl" => format!(
            "https://{}.{}/{}",
            random_string(8).to_lowercase(),
            choose(URL_TLDS),
            random_string(6).to_lowercase()
        ),
        "randomLoremWords" => (0..positive(params, 5, 100))
            .map(|_| choose(LOREM_WORDS))
            .collect::<Vec<_>>()
            .join(" "),
        "randomPrice" => {
            let (a, b) = range(params, 1.0);
            format!("{:.2}", random() * (b - a) + a)
        }
        "randomPhoneNumber" => {
            format!("+1-{}-{}-{:04}", int(200, 999), int(200, 999), int(0, 9999))
        }
        "randomDate" | "randomDatePast" | "randomDateFuture" => {
            let span = positive(params, 365, 365000) as i64;
            let days = match name {
                "randomDatePast" => -int(1, span),
                "randomDateFuture" => int(1, span),
                _ => int(-span, span),
            };
            (now + chrono::Duration::days(days))
                .format("%Y-%m-%d")
                .to_string()
        }
        _ => return None,
    })
}

const FIRST_NAMES: &[&str] = &[
    "James",
    "Mary",
    "John",
    "Patricia",
    "Robert",
    "Jennifer",
    "Michael",
    "Linda",
    "William",
    "Elizabeth",
    "David",
    "Barbara",
    "Richard",
    "Susan",
    "Joseph",
    "Jessica",
    "Thomas",
    "Sarah",
    "Charles",
    "Karen",
    "Christopher",
    "Lisa",
    "Daniel",
    "Nancy",
    "Matthew",
    "Betty",
    "Anthony",
    "Margaret",
    "Mark",
    "Sandra",
    "Donald",
    "Ashley",
    "Steven",
    "Kimberly",
    "Paul",
    "Emily",
    "Andrew",
    "Donna",
    "Joshua",
    "Michelle",
];

const LAST_NAMES: &[&str] = &[
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
    "Taylor",
    "Moore",
    "Jackson",
    "Martin",
    "Lee",
    "Perez",
    "Thompson",
    "White",
    "Harris",
    "Sanchez",
    "Clark",
    "Ramirez",
    "Lewis",
    "Robinson",
    "Walker",
    "Young",
    "Allen",
    "King",
    "Wright",
    "Scott",
    "Torres",
    "Nguyen",
    "Hill",
    "Flores",
];

const EMAIL_DOMAINS: &[&str] = &[
    "example.com",
    "test.com",
    "mail.test",
    "demo.org",
    "sample.net",
];

const URL_TLDS: &[&str] = &["com", "org", "net", "io", "dev"];

const LOREM_WORDS: &[&str] = &[
    "lorem",
    "ipsum",
    "dolor",
    "sit",
    "amet",
    "consectetur",
    "adipiscing",
    "elit",
    "sed",
    "do",
    "eiusmod",
    "tempor",
    "incididunt",
    "ut",
    "labore",
    "et",
    "dolore",
    "magna",
    "aliqua",
    "enim",
    "ad",
    "minim",
    "veniam",
    "quis",
    "nostrud",
    "exercitation",
    "ullamco",
    "laboris",
    "nisi",
    "aliquip",
];
