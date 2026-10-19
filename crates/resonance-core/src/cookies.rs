use crate::context::{Cookie, CookieExpiry};
use serde_json::{Value, json};
use url::Url;

fn text<'a>(cookie: &'a Value, key: &str, default: &'a str) -> &'a str {
    cookie[key].as_str().unwrap_or(default)
}
fn domain_matches(domain: &str, host: &str, only: bool) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    domain == host || (!only && !domain.is_empty() && host.ends_with(&format!(".{domain}")))
}
pub fn header(cookies: &[Cookie], url: &str) -> Option<String> {
    let url = Url::parse(url).ok()?;
    let host = url.host_str()?.to_lowercase();
    let now = chrono::Utc::now().timestamp_millis();
    let values: Vec<_> = cookies
        .iter()
        .filter(|c| !matches!(c.expires, Some(CookieExpiry::Timestamp(n)) if n <= now))
        .filter(|c| !c.secure || url.scheme() == "https")
        .filter(|c| domain_matches(&c.domain, &host, c.host_only))
        .filter(|c| {
            let path = c.path.as_deref().unwrap_or("/");
            path == "/" || url.path() == path || url.path().starts_with(&format!("{path}/"))
        })
        .map(|c| format!("{}={}", c.name, c.value))
        .collect();
    (!values.is_empty()).then(|| values.join("; "))
}
pub fn apply(cookies: &mut Vec<Cookie>, changes: &[Value]) {
    for change in changes {
        match change["op"].as_str().unwrap_or("") {
            "clear" => cookies.clear(),
            "delete" => cookies.retain(|c| {
                !(Some(c.name.as_str()) == change["name"].as_str()
                    && (change["domain"].is_null()
                        || c.domain.eq_ignore_ascii_case(text(change, "domain", "")))
                    && (change["path"].is_null() || c.path.as_deref() == change["path"].as_str()))
            }),
            "set" => {
                let mut cookie = change["cookie"].clone();
                cookie["domain"] = text(&cookie, "domain", "")
                    .trim_start_matches('.')
                    .to_ascii_lowercase()
                    .into();
                cookie["name"] = text(&cookie, "name", "").trim().into();
                if let Some(expires) = cookie["expires"].as_str() {
                    cookie["expires"] = parse_date(expires).map(Value::from).unwrap_or(Value::Null);
                }
                cookies.retain(|c| {
                    !(Some(c.name.as_str()) == cookie["name"].as_str()
                        && Some(c.domain.as_str()) == cookie["domain"].as_str()
                        && c.path.as_deref().unwrap_or("/") == text(&cookie, "path", "/"))
                });
                if cookie["expires"]
                    .as_i64()
                    .is_none_or(|n| n > chrono::Utc::now().timestamp_millis())
                    && let Ok(cookie) = serde_json::from_value(cookie)
                {
                    cookies.push(cookie);
                }
            }
            _ => {}
        }
    }
}
fn parse_date(value: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc2822(value)
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(value))
        .map(|date| date.timestamp_millis())
        .ok()
        .or_else(|| {
            [
                "%A, %d-%b-%y %H:%M:%S GMT",
                "%a, %d-%b-%Y %H:%M:%S GMT",
                "%a %b %e %H:%M:%S %Y",
            ]
            .iter()
            .find_map(|format| {
                chrono::NaiveDateTime::parse_from_str(value, format)
                    .ok()
                    .map(|date| date.and_utc().timestamp_millis())
            })
        })
}
pub fn response_changes(headers: &[String], url: &str) -> Vec<Value> {
    let Ok(url) = Url::parse(url) else {
        return vec![];
    };
    let Some(host) = url.host_str() else {
        return vec![];
    };
    headers.iter().filter_map(|header| {
        let mut parts=header.split(';').map(str::trim); let (name,value)=parts.next()?.split_once('=')?;
        if name.trim().is_empty() {return None;}
        let mut cookie=json!({"name":name.trim(),"value":value.trim(),"domain":host.to_lowercase(),"path":"/","expires":null,"hostOnly":true,"secure":false,"httpOnly":false,"sameSite":null});
        let mut max_age=None;
        for part in parts {
            let (key,value)=part.split_once('=').unwrap_or((part,""));
            let value=value.trim();
            match key.trim().to_lowercase().as_str() {
                "domain"=>{cookie["domain"]=value.trim_start_matches('.').to_lowercase().into();cookie["hostOnly"]=false.into();},
                "path"=>cookie["path"]=if value.is_empty(){"/"}else{value}.into(),
                "secure"=>cookie["secure"]=true.into(),
                "httponly"=>cookie["httpOnly"]=true.into(),
                "samesite"=>cookie["sameSite"]=if value.is_empty(){"None"}else{value}.into(),
                "max-age"=>max_age=value.parse::<i64>().ok(),
                "expires"=>if let Some(date)=parse_date(value) {cookie["expires"]=date.into();},
                _=>{}
            }
        }
        if !domain_matches(text(&cookie,"domain",""),host,false) {return None;}
        if let Some(age)=max_age {cookie["expires"]=if age<=0 {0} else {chrono::Utc::now().timestamp_millis().saturating_add(age.saturating_mul(1000))}.into();}
        Some(json!({"op":"set","cookie":cookie}))
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn script_cookie_domains_dates_and_deletions_match_the_persistent_jar() {
        let mut jar = vec![];
        apply(
            &mut jar,
            &[
                json!({"op":"set","cookie":{"name":"sid","value":"1","domain":".EXAMPLE.test","expires":"2099-01-01T00:00:00Z"}}),
            ],
        );
        assert_eq!(
            header(&jar, "https://sub.example.test/"),
            Some("sid=1".into())
        );
        apply(
            &mut jar,
            &[json!({"op":"delete","name":"sid","domain":"EXAMPLE.TEST"})],
        );
        assert!(jar.is_empty());
        for date in [
            "Sun, 06 Nov 1994 08:49:37 GMT",
            "Sunday, 06-Nov-94 08:49:37 GMT",
            "Sun Nov  6 08:49:37 1994",
        ] {
            assert_eq!(parse_date(date), Some(784111777000), "{date}");
        }
    }
    #[test]
    fn matching_and_response_deltas() {
        let changes = response_changes(
            &[
                "sid=1; Secure; Path=/api; Domain=example.test".into(),
                "evil=1; Domain=other.test".into(),
            ],
            "https://example.test/api",
        );
        assert_eq!(changes.len(), 1);
        let mut jar = vec![];
        apply(&mut jar, &changes);
        assert_eq!(
            header(&jar, "https://sub.example.test/api/users"),
            Some("sid=1".into())
        );
        assert_eq!(header(&jar, "http://example.test/api"), None);
        assert_eq!(header(&jar, "https://example.test/apix"), None);
        apply(
            &mut jar,
            &response_changes(
                &["sid=; Max-Age=0; Path=/api; Domain=example.test".into()],
                "https://example.test/api",
            ),
        );
        assert!(jar.is_empty());
    }
}
