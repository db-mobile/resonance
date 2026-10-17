//! Bridge the XPath DOM to a namespace-preserving XML writer. sxd's writer
//! neither escapes namespace URIs nor preserves bindings used in QName values.
use super::*;
use quick_xml::{
    Reader, Writer,
    events::{BytesEnd, BytesPI, BytesStart, BytesText, Event},
};
use std::io::{self, Write};
use sxd_document::{Package, QName, dom, parser};
use sxd_xpath::nodeset::Node;

pub(super) fn parse(body: &str) -> Result<Package, InspectionError> {
    let package = parser::parse(body).map_err(|e| InspectionError::new("parse", e))?;
    let doc = package.as_document();
    let mut elements = doc
        .root()
        .children()
        .into_iter()
        .filter_map(|c| c.element())
        .collect::<Vec<_>>();
    let mut defaults: Vec<Option<String>> = vec![None];
    let mut reader = Reader::from_str(body);
    loop {
        let event = reader
            .read_event()
            .map_err(|e| InspectionError::new("parse", e))?;
        let empty = matches!(event, Event::Empty(_));
        match event {
            Event::Start(start) | Event::Empty(start) => {
                let element = elements
                    .pop()
                    .ok_or_else(|| InspectionError::new("parse", "XML structure mismatch"))?;
                let mut default = defaults.last().cloned().flatten();
                for attribute in start.attributes() {
                    let attribute = attribute.map_err(|e| InspectionError::new("parse", e))?;
                    if attribute.key.as_ref() == "xmlns" {
                        let value = attribute
                            .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                            .map_err(|e| InspectionError::new("parse", e))?;
                        default = if value.is_empty() {
                            None
                        } else {
                            Some(value.into_owned())
                        };
                    }
                }
                // sxd loses explicit empty defaults and ignores defaults on prefixed
                // elements. Repair both before XPath evaluation, including descendants.
                if element.preferred_prefix().is_none() {
                    element.set_name(QName::with_namespace_uri(
                        default.as_deref(),
                        element.name().local_part(),
                    ));
                }
                element.set_default_namespace_uri(Some(default.as_deref().unwrap_or("")));
                if !empty {
                    defaults.push(default);
                    elements.extend(
                        element
                            .children()
                            .into_iter()
                            .rev()
                            .filter_map(|c| c.element()),
                    );
                }
            }
            Event::End(_) => {
                defaults.pop();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(package)
}

struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.len() + bytes.len() > MAX_OUTPUT_BYTES {
            return Err(io::Error::other("Inspection output limit exceeded"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn qualified_name(name: sxd_document::QName<'_>, prefix: Option<&str>) -> String {
    prefix
        .filter(|p| !p.is_empty())
        .map(|p| format!("{p}:{}", name.local_part()))
        .unwrap_or_else(|| name.local_part().into())
}

fn element(writer: &mut Writer<LimitedBytes>, element: dom::Element<'_>) -> io::Result<()> {
    let name = qualified_name(element.name(), element.preferred_prefix());
    let mut start = BytesStart::new(&name);
    // Explicit declarations also preserve prefixes used only in attribute values.
    let mut bindings = BTreeMap::new();
    for ns in element.namespaces_in_scope() {
        if ns.prefix() != "xml" {
            bindings.insert(format!("xmlns:{}", ns.prefix()), ns.uri());
        }
    }
    bindings.insert(
        "xmlns".into(),
        element.recursive_default_namespace_uri().unwrap_or(""),
    );
    for (prefix, uri) in &bindings {
        start.push_attribute((prefix.as_str(), *uri));
    }
    for attribute in element.attributes() {
        let attr_name = qualified_name(attribute.name(), attribute.preferred_prefix());
        start.push_attribute((attr_name.as_str(), attribute.value()));
    }
    let children = element.children();
    if children.is_empty() {
        return writer.write_event(Event::Empty(start));
    }
    writer.write_event(Event::Start(start))?;
    for child in children {
        child_node(writer, child)?;
    }
    writer.write_event(Event::End(BytesEnd::new(&name)))
}

fn child_node(writer: &mut Writer<LimitedBytes>, child: dom::ChildOfElement<'_>) -> io::Result<()> {
    match child {
        dom::ChildOfElement::Element(node) => element(writer, node),
        dom::ChildOfElement::Text(node) => {
            writer.write_event(Event::Text(BytesText::new(node.text())))
        }
        dom::ChildOfElement::Comment(node) => {
            writer.write_event(Event::Comment(BytesText::from_escaped(node.text())))
        }
        dom::ChildOfElement::ProcessingInstruction(node) => {
            let pi = format!(
                "{}{}{}",
                node.target(),
                if node.value().is_some() { " " } else { "" },
                node.value().unwrap_or("")
            );
            writer.write_event(Event::PI(BytesPI::new(&pi)))
        }
    }
}

pub(super) fn render_node(node: Node<'_>) -> Result<String, InspectionError> {
    let mut writer = Writer::new(LimitedBytes(Vec::new()));
    let result = match node {
        Node::Element(node) => element(&mut writer, node),
        Node::Root(root) => root
            .children()
            .into_iter()
            .try_for_each(|child| child_node(&mut writer, child.into())),
        _ => return Ok(node.string_value()),
    };
    result.map_err(|_| InspectionError::limit())?;
    String::from_utf8(writer.into_inner().0).map_err(|e| InspectionError::new("query", e))
}
