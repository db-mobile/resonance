//! Conservative preflight for eager query engines. Bound potential intermediate
//! lists/traversals, not just the output we eventually display.
use super::InspectionError;

const MAX_WORK: usize = 10_000_000;

pub(super) fn unquoted(
    expression: &str,
    backslash_escapes: bool,
) -> Result<String, InspectionError> {
    let mut quote = None;
    let mut escaped = false;
    let mut nesting: usize = 0;
    let mut text = String::new();
    for ch in expression.chars() {
        if let Some(delimiter) = quote {
            if escaped {
                escaped = false;
            } else if backslash_escapes && ch == '\\' {
                escaped = true;
            } else if ch == delimiter {
                quote = None;
            }
            text.push(' ');
        } else if matches!(ch, '\'' | '"') {
            quote = Some(ch);
            text.push(' ');
        } else {
            if matches!(ch, '(' | '[') {
                nesting += 1;
            }
            if matches!(ch, ')' | ']') {
                nesting = nesting.saturating_sub(1);
            }
            if nesting > 128 {
                return Err(InspectionError::limit());
            }
            text.push(ch);
        }
    }
    Ok(text)
}

pub(super) fn check(
    expression: &str,
    nodes: usize,
    depth: usize,
    json: bool,
) -> Result<(), InspectionError> {
    let text = unquoted(expression, json)?;
    let mut work = nodes.saturating_mul(expression.chars().count().max(1));
    let mut multiply = |factor: usize| -> Result<(), InspectionError> {
        work = work.saturating_mul(factor);
        if work > MAX_WORK {
            Err(InspectionError::limit())
        } else {
            Ok(())
        }
    };
    multiply(1)?;
    for _ in text.matches(if json { ".." } else { "//" }) {
        multiply(depth + 1)?;
    }
    if json {
        // Counting function commas too is deliberately conservative.
        for _ in text.matches(',') {
            multiply(2)?;
        }
        for _ in text.matches('?') {
            multiply(depth + 1)?;
        }
        for _ in text.matches('$').skip(1) {
            multiply(nodes)?;
        }
    } else {
        for _ in text.matches('[') {
            multiply(depth + 1)?;
        }
        for axis in ["following", "preceding", "ancestor", "descendant", "parent"] {
            for _ in text.matches(axis) {
                multiply(nodes)?;
            }
        }
        // Parent-relative predicates can rescan every sibling for every match.
        for _ in text.matches("..") {
            multiply(nodes)?;
        }
        // Absolute subqueries within predicates/functions can rescan the root.
        let mut previous = ' ';
        for ch in text.chars().filter(|c| !c.is_whitespace()) {
            if ch == '/' && matches!(previous, '[' | '(' | '=' | '|' | '<' | '>') {
                multiply(nodes)?;
            }
            previous = ch;
        }
    }
    Ok(())
}
