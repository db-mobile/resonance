use resonance_core::scripts::execution::NextRequest;
use resonance_core::{
    model::*,
    runner::{Scheduler, parse_data},
};
use serde_json::json;
#[test]
fn duplicate_entries_self_target_attempts_and_iteration_limits() {
    let queue = vec![
        RequestTemplate {
            endpoint_id: Some("a".into()),
            name: "A".into(),
            ..Default::default()
        },
        RequestTemplate {
            endpoint_id: Some("a".into()),
            name: "A".into(),
            ..Default::default()
        },
    ];
    let mut scheduler = Scheduler::new(&queue, 2, 3);
    assert_eq!(scheduler.take().unwrap().unwrap().attempt, 1);
    scheduler
        .advance(&NextRequest::Request { target: "a".into() })
        .unwrap();
    assert_eq!(scheduler.take().unwrap().unwrap().attempt, 2);
    scheduler.advance(&NextRequest::Unchanged).unwrap();
    assert_eq!(scheduler.take().unwrap().unwrap().queue_position, 1);
    scheduler
        .advance(&NextRequest::Request { target: "a".into() })
        .unwrap();
    assert_eq!(scheduler.take().unwrap_err().code, "executionLimit");
}
#[test]
fn data_parses_quotes_newlines_missing_cells_and_typed_json() {
    assert_eq!(
        parse_data(&DataFile {
            name: "x.csv".into(),
            content: "\u{feff}id,name\r\n7,\"a,\"\"b\"\"\"\r\n8\n".into()
        })
        .unwrap(),
        vec![
            json!({"id":"7","name":"a,\"b\""}),
            json!({"id":"8","name":""})
        ]
    );
    assert_eq!(
        parse_data(&DataFile {
            name: "x.JSON".into(),
            content: "[{\"id\":7,\"nil\":null,\"nested\":{\"a\":1}}]".into()
        })
        .unwrap(),
        vec![json!({"id":"7","nil":"","nested":"{\"a\":1}"})]
    );
}

#[test]
fn branches_repeats_and_iteration_end_preserve_flat_indexes() {
    let queue:Vec<RequestTemplate>=serde_json::from_value(json!([
        {"endpointId":"a","name":"Login"},{"endpointId":"b","name":"Poll"},{"endpointId":"c","name":"Finish"}
    ])).unwrap();
    let mut scheduler = Scheduler::new(&queue, 2, 10);
    let first = scheduler.take().unwrap().unwrap();
    assert_eq!(
        (
            first.index,
            first.queue_position,
            first.iteration,
            first.attempt
        ),
        (0, 0, 1, 1)
    );
    scheduler
        .advance(&NextRequest::Request { target: "b".into() })
        .unwrap();
    let second = scheduler.take().unwrap().unwrap();
    assert_eq!(
        (
            second.index,
            second.queue_position,
            second.iteration,
            second.attempt
        ),
        (1, 1, 1, 1)
    );
    scheduler
        .advance(&NextRequest::Request { target: "b".into() })
        .unwrap();
    let third = scheduler.take().unwrap().unwrap();
    assert_eq!(
        (
            third.index,
            third.queue_position,
            third.iteration,
            third.attempt
        ),
        (2, 1, 1, 2)
    );
    scheduler.advance(&NextRequest::StopIteration).unwrap();
    let fourth = scheduler.take().unwrap().unwrap();
    assert_eq!(
        (
            fourth.index,
            fourth.queue_position,
            fourth.iteration,
            fourth.attempt
        ),
        (3, 0, 2, 1)
    );
}
#[test]
fn rejects_unselected_and_ambiguous_names_but_self_id_keeps_duplicate_position() {
    let queue:Vec<RequestTemplate>=serde_json::from_value(json!([
        {"endpointId":"a","name":"Same"},{"endpointId":"b","name":"Same"},{"endpointId":"b","name":"Variant"}
    ])).unwrap();
    let mut scheduler = Scheduler::new(&queue, 1, 10);
    scheduler.take().unwrap();
    assert_eq!(
        scheduler
            .advance(&NextRequest::Request {
                target: "Same".into()
            })
            .unwrap_err()
            .details["ambiguous"],
        true
    );
    assert_eq!(
        scheduler
            .advance(&NextRequest::Request {
                target: "missing".into()
            })
            .unwrap_err()
            .details["ambiguous"],
        false
    );
    scheduler
        .advance(&NextRequest::Request {
            target: "Variant".into(),
        })
        .unwrap();
    scheduler.take().unwrap();
    scheduler
        .advance(&NextRequest::Request { target: "b".into() })
        .unwrap();
    assert_eq!(scheduler.take().unwrap().unwrap().queue_position, 2);
    assert_eq!(
        resonance_core::runner::execution_limit(&None, 2000).unwrap(),
        2000
    );
}
