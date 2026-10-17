use super::*;
use sxd_document::dom;
#[path = "response_inspection_xml_io.rs"]
mod xml_io;
use sxd_xpath::{Context, Factory, Value as XPathValue};

pub(super) fn inspect_xml(
    request: &InspectionRequest,
) -> Result<InspectionResult, InspectionError> {
    reject_declarations(&request.body)?;
    let package = xml_io::parse(&request.body)?;
    let document = package.as_document();
    let root = document
        .root()
        .children()
        .into_iter()
        .find_map(|child| child.element())
        .ok_or_else(|| InspectionError::new("parse", "Missing XML root element"))?;
    // Bound recursive XPath traversals and subtree cloning on untrusted documents.
    let mut pending = vec![(root, 1)];
    let mut nodes = 0;
    let mut max_depth = 0;
    while let Some((element, depth)) = pending.pop() {
        nodes += 1 + element.children().len() + element.attributes().len();
        max_depth = max_depth.max(depth);
        if depth > 256 {
            return Err(InspectionError::limit());
        }
        pending.extend(
            element
                .children()
                .into_iter()
                .filter_map(|c| c.element())
                .map(|e| (e, depth + 1)),
        );
    }
    budget::check(&request.expression, nodes, max_depth, false)?;
    let namespaces = bindings(root, &request.namespaces)?;
    let mut context = Context::new();
    for (prefix, uri) in &namespaces {
        context.set_namespace(prefix, uri);
    }
    let query = Factory::new()
        .build(&request.expression)
        .map_err(|e| InspectionError::new("query", e))?
        .ok_or_else(|| InspectionError::new("query", "Enter an XPath expression"))?;
    // sxd-xpath's name tests panic on unbound prefixes; check QName tokens first.
    // XPath 1.0 literals have no escapes, and colons in axis separators aren't QNames.
    let literals = regex::Regex::new(r#"'[^']*'|"[^"]*""#).unwrap();
    let names = regex::Regex::new(r"([\p{L}_][\p{L}\p{N}_.-]*):[\p{L}_*]").unwrap();
    let unquoted = literals.replace_all(&request.expression, "");
    for name in names.captures_iter(&unquoted) {
        if !namespaces.contains_key(&name[1]) {
            return Err(InspectionError::new(
                "namespace",
                format!("Unbound namespace prefix: {}", &name[1]),
            ));
        }
    }
    let value = query.evaluate(&context, document.root()).map_err(|e| {
        let code = if e.to_string().contains("unknown namespace prefix") {
            "namespace"
        } else {
            "query"
        };
        InspectionError::new(code, e)
    })?;
    let (kind, total_count, pieces) = match value {
        XPathValue::Nodeset(nodes) => {
            let count = nodes.size();
            let mut pieces = Vec::new();
            let mut bytes = 0;
            for node in nodes.document_order().into_iter().take(MAX_MATCHES) {
                let piece = xml_io::render_node(node)?;
                if piece.len() > MAX_OUTPUT_BYTES {
                    return Err(InspectionError::limit());
                }
                let additional = piece.len() + usize::from(!pieces.is_empty());
                if bytes + additional > MAX_OUTPUT_BYTES {
                    break;
                }
                bytes += additional;
                pieces.push(piece);
            }
            ("nodes", count, pieces)
        }
        XPathValue::Boolean(value) => ("boolean", 1, vec![value.to_string()]),
        XPathValue::Number(value) => ("number", 1, vec![XPathValue::Number(value).string()]),
        XPathValue::String(value) => ("string", 1, vec![value]),
    };
    let displayed_count = pieces.len();
    let text = pieces.join("\n");
    if text.len() > MAX_OUTPUT_BYTES {
        return Err(InspectionError::limit());
    }
    Ok(InspectionResult {
        text,
        language: "text",
        kind,
        total_count,
        displayed_count,
        truncated: displayed_count < total_count,
        namespaces,
    })
}

fn bindings(root: dom::Element<'_>, overrides: &Namespaces) -> Result<Namespaces, InspectionError> {
    let mut bindings = Namespaces::new();
    for ns in root.namespaces_in_scope() {
        if !ns.prefix().is_empty() {
            bindings.insert(ns.prefix().into(), ns.uri().into());
        }
    }
    if let Some(uri) = root
        .recursive_default_namespace_uri()
        .filter(|uri| !uri.is_empty())
    {
        let mut alias = "ns".to_owned();
        let mut index = 1;
        while bindings.contains_key(&alias) || overrides.contains_key(&alias) {
            alias = format!("ns{index}");
            index += 1;
        }
        bindings.insert(alias, uri.into());
    }
    for (prefix, uri) in overrides {
        let mut chars = prefix.chars();
        let valid_start = chars.next().is_some_and(|c| c.is_alphabetic() || c == '_');
        if !valid_start
            || !chars.all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
            || uri.is_empty()
            || prefix == "xmlns"
            || (prefix == "xml" && uri != "http://www.w3.org/XML/1998/namespace")
        {
            return Err(InspectionError::new(
                "namespace",
                "Namespace bindings need a valid prefix and nonempty URI",
            ));
        }
        bindings.insert(prefix.clone(), uri.clone());
    }
    Ok(bindings)
}

// Skip comments, CDATA and processing instructions so literal declaration text is harmless.
fn reject_declarations(body: &str) -> Result<(), InspectionError> {
    let mut rest = body;
    while let Some(index) = rest.find('<') {
        rest = &rest[index..];
        let terminator = if rest.starts_with("<!--") {
            Some("-->")
        } else if rest.starts_with("<![CDATA[") {
            Some("]]>")
        } else if rest.starts_with("<?") {
            Some("?>")
        } else {
            None
        };
        if let Some(end) = terminator {
            rest = rest
                .find(end)
                .map(|index| &rest[index + end.len()..])
                .unwrap_or("");
        } else if rest.starts_with("<!DOCTYPE") || rest.starts_with("<!ENTITY") {
            return Err(InspectionError::new(
                "parse",
                "DTD and entity declarations are unsupported",
            ));
        } else {
            rest = &rest[1..];
        }
    }
    Ok(())
}
