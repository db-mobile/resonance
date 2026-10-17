use super::*;
use serde_json::json;

#[tokio::test]
async fn command_returns_the_ipc_contract_and_structured_errors() {
    let request = serde_json::from_value(
        json!({ "format": "json", "body": "false", "expression": "$", "namespaces": {} }),
    )
    .unwrap();
    let result = serde_json::to_value(response_inspect(request).await.unwrap()).unwrap();
    assert_eq!(result["text"], "[\n  false\n]");
    assert_eq!(result["totalCount"], 1);
    assert_eq!(result["displayedCount"], 1);
    assert_eq!(result["language"], "json");
    let request = serde_json::from_value(
        json!({ "format": "xml", "body": "<r/>", "expression": "//unknown:r" }),
    )
    .unwrap();
    let error = serde_json::to_value(response_inspect(request).await.unwrap_err()).unwrap();
    assert_eq!(error["code"], "namespace");
    assert!(error["message"].as_str().unwrap().contains("unknown"));
}

fn run(format: &str, body: &str, expression: &str) -> Result<InspectionResult, InspectionError> {
    inspect(InspectionRequest {
        format: format.into(),
        body: body.into(),
        expression: expression.into(),
        namespaces: Default::default(),
    })
}

#[test]
fn jsonpath_selectors_filters_slices_and_scalars() {
    let body = r#"{"items":[{"price":2},{"price":8},{"price":4}]}"#;
    for (query, expected) in [
        ("$.items[?@.price < 5].price", json!([2, 4])),
        ("$.items[0:2].price", json!([2, 8])),
        ("$..price", json!([2, 8, 4])),
        ("$.missing", json!([])),
    ] {
        let result = run("json", body, query).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result.text).unwrap(),
            expected
        );
        assert_eq!(result.total_count, expected.as_array().unwrap().len());
    }
    for scalar in ["false", "0", "null", r#""hello""#] {
        let result = run("json", scalar, "$").unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result.text).unwrap(),
            json!([serde_json::from_str::<serde_json::Value>(scalar).unwrap()])
        );
    }
}

#[test]
fn xpath_nodes_scalars_and_document_order() {
    let body = "<root><item id='a'>one</item><item id='b'>two</item></root>";
    assert_eq!(run("xml", body, "//item/@id").unwrap().text, "a\nb");
    assert_eq!(run("xml", body, "//item/text()").unwrap().text, "one\ntwo");
    assert_eq!(run("xml", body, "count(//item)").unwrap().text, "2");
    assert_eq!(
        run("xml", body, "boolean(//missing)").unwrap().text,
        "false"
    );
    assert_eq!(run("xml", body, "string(//item)").unwrap().text, "one");
    let result = run("xml", body, "//item[2] | //item[1]").unwrap();
    assert!(result.text.find("one").unwrap() < result.text.find("two").unwrap());
    assert_eq!(run("xml", body, "//missing").unwrap().total_count, 0);
}

#[test]
fn namespaces_and_standalone_fragments() {
    let body = r#"<root xmlns="urn:default" xmlns:ns="urn:other" xmlns:p="urn:p"><p:item p:id="a">&amp;&lt;</p:item></root>"#;
    let result = run("xml", body, "/ns1:root/p:item").unwrap();
    assert_eq!(result.namespaces.get("ns1").unwrap(), "urn:default");
    assert_eq!(result.total_count, 1);
    let parsed = sxd_document::parser::parse(&result.text).unwrap();
    let element = parsed.as_document().root().children()[0].element().unwrap();
    assert_eq!(element.name().namespace_uri(), Some("urn:p"));
    assert_eq!(
        element.attributes()[0].name().namespace_uri(),
        Some("urn:p")
    );
    let result = inspect(InspectionRequest {
        format: "xml".into(),
        body: body.into(),
        expression: "//x:item".into(),
        namespaces: [("x".into(), "urn:p".into())].into(),
    })
    .unwrap();
    assert_eq!(result.total_count, 1);
}

#[test]
fn xml_fragments_preserve_resets_escaped_uris_and_qname_value_bindings() {
    let body = r#"<root xmlns="urn:outer" xmlns:p="urn:a&apos;b&amp;c"><item xmlns=""><child/></item><p:other xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="p:T"/></root>"#;
    assert_eq!(run("xml", body, "count(//item/child)").unwrap().text, "1");
    let result = run("xml", body, "/").unwrap();
    assert!(result.text.contains("xmlns=\"\""));
    assert_eq!(
        run("xml", &result.text, "count(//item/child)")
            .unwrap()
            .text,
        "1"
    );
    let fragment = run("xml", body, "//*[local-name()='other']").unwrap();
    assert!(fragment.text.contains("xmlns:p="));
    assert_eq!(
        run("xml", &fragment.text, "namespace-uri(/*)")
            .unwrap()
            .text,
        "urn:a'b&c"
    );
}

#[test]
fn rejects_exponential_query_work_before_evaluation() {
    let body = "[[[[[[[[[0]]]]]]]]]";
    let query = format!("${}", "[0,0,0,0,0,0,0,0,0,0]".repeat(9));
    assert_eq!(run("json", body, &query).unwrap_err().code, "limit");
    let siblings = format!("<r>{}</r>", "<i/>".repeat(20000));
    for query in ["//*[../*]", "//*[parent::*/*]"] {
        assert_eq!(run("xml", &siblings, query).unwrap_err().code, "limit");
    }
}

#[test]
fn output_byte_limit_keeps_complete_matches_and_handles_all_xpath_node_kinds() {
    let value = "é".repeat(150000);
    let body = serde_json::to_string(&vec![&value; 4]).unwrap();
    let result = run("json", &body, "$[*]").unwrap();
    assert!(result.truncated);
    assert!(result.text.len() <= MAX_OUTPUT_BYTES);
    assert_eq!(
        serde_json::from_str::<Vec<String>>(&result.text)
            .unwrap()
            .len(),
        result.displayed_count
    );
    assert_eq!(result.total_count, 4);
    let body = "<r xmlns:p='urn:p'><!--comment--><?work value?><i>text</i></r>";
    assert_eq!(run("xml", body, "//comment()").unwrap().text, "comment");
    assert_eq!(
        run("xml", body, "//processing-instruction()").unwrap().text,
        "value"
    );
    assert!(
        run("xml", body, "/r/namespace::p")
            .unwrap()
            .text
            .contains("urn:p")
    );
    assert_eq!(run("xml", body, "0 div 0").unwrap().text, "NaN");
}

#[test]
fn rejects_malformed_queries_documents_and_declarations() {
    for (format, body, expression, code) in [
        ("json", "{", "$", "parse"),
        ("json", "{}", "$[", "query"),
        ("xml", "<root>", "/", "parse"),
        ("xml", "<r/>", "//[", "query"),
        ("xml", "<r/>", "document('file:///etc/passwd')", "query"),
        (
            "xml",
            "<!DOCTYPE r [<!ENTITY x 'secret'>]><r>&x;</r>",
            "/",
            "parse",
        ),
        ("xml", "<r/>", "//unknown:r", "namespace"),
    ] {
        assert_eq!(run(format, body, expression).unwrap_err().code, code);
    }
    assert!(
        run(
            "xml",
            "<r><![CDATA[<!DOCTYPE harmless>]]><!-- <!ENTITY harmless> --></r>",
            "/"
        )
        .is_ok()
    );
}

#[test]
fn caps_complete_matches_and_rejects_oversized_matches() {
    let body = serde_json::to_string(&vec![0; MAX_MATCHES + 2]).unwrap();
    let result = run("json", &body, "$[*]").unwrap();
    assert!(result.truncated);
    assert_eq!(result.total_count, MAX_MATCHES + 2);
    assert_eq!(
        serde_json::from_str::<Vec<i32>>(&result.text)
            .unwrap()
            .len(),
        MAX_MATCHES
    );
    let huge = serde_json::to_string(&"x".repeat(MAX_OUTPUT_BYTES)).unwrap();
    assert_eq!(run("json", &huge, "$").unwrap_err().code, "limit");
    assert_eq!(
        run("json", &" ".repeat(MAX_SOURCE_BYTES + 1), "$")
            .unwrap_err()
            .code,
        "limit"
    );
    assert_eq!(
        run("json", "{}", &"$".repeat(MAX_EXPRESSION_CHARS + 1))
            .unwrap_err()
            .code,
        "limit"
    );
}
