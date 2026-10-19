//! Desktop lifecycle adapter. The core never reads desktop state or emits globally.
use resonance_core::{
    execution::{self, Cancellation},
    model::{ExecutionError, ExecutionEvent, RequestInput, RequestResult, RunInput, RunResult},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, State, WebviewWindow};

#[derive(Default)]
pub struct ExecutionState {
    active: Mutex<HashMap<(String, String), Cancellation>>,
}
struct Registration<'a> {
    state: &'a ExecutionState,
    key: (String, String),
}
impl ExecutionState {
    fn register(
        &self,
        window: &str,
        id: &str,
    ) -> Result<(Cancellation, Registration<'_>), ExecutionError> {
        if id.is_empty() {
            return Err(ExecutionError::new("invalidExecutionId", Value::Null));
        }
        let key = (window.to_string(), id.to_string());
        let mut active = self.active.lock().unwrap();
        if active.contains_key(&key) {
            return Err(ExecutionError::new("duplicateExecutionId", Value::Null));
        }
        let token = Cancellation::default();
        active.insert(key.clone(), token.clone());
        Ok((token, Registration { state: self, key }))
    }
    pub fn cancel_window(&self, window: &str) {
        for ((label, _), token) in self.active.lock().unwrap().iter() {
            if label == window {
                token.cancel();
            }
        }
    }
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.state.active.lock().unwrap().remove(&self.key);
    }
}
/// The reliable invoke reply also acknowledges all persistence effects. Events
/// remain useful for progress, but a dropped event must not strand an execution.
#[derive(Serialize)]
pub struct ExecutionReceipt<T> {
    result: T,
    sequence: u64,
    effects: Vec<ExecutionEvent>,
}

#[derive(Default)]
struct Delivery {
    sequence: u64,
    effects: Vec<ExecutionEvent>,
}
impl Delivery {
    fn event(&mut self, event: ExecutionEvent) -> ExecutionEvent {
        self.sequence = event.sequence;
        if event.kind == "effect" {
            self.effects.push(event.clone());
        }
        event
    }
    fn receipt<T>(self, result: T) -> ExecutionReceipt<T> {
        ExecutionReceipt {
            result,
            sequence: self.sequence,
            effects: self.effects,
        }
    }
}
#[tauri::command]
pub async fn execute_request(
    window: WebviewWindow,
    state: State<'_, ExecutionState>,
    input: RequestInput,
) -> Result<ExecutionReceipt<RequestResult>, ExecutionError> {
    let (token, _registration) = state.register(window.label(), &input.execution_id)?;
    window
        .emit(
            "execution-event",
            json!({"executionId":input.execution_id,"sequence":0,"kind":"registered"}),
        )
        .map_err(|e| ExecutionError::new("eventDeliveryFailed", e.to_string()))?;
    let cancel = token.clone();
    let mut delivery_error = None;
    let mut delivery = Delivery::default();
    let result = execution::execute_request(input, token, |event| {
        if let Err(error) = window.emit("execution-event", delivery.event(event)) {
            delivery_error = Some(ExecutionError::new(
                "eventDeliveryFailed",
                error.to_string(),
            ));
            cancel.cancel();
        }
    })
    .await;
    if let Some(error) = delivery_error {
        Err(error)
    } else {
        Ok(delivery.receipt(result))
    }
}
#[tauri::command]
pub async fn execute_run(
    window: WebviewWindow,
    state: State<'_, ExecutionState>,
    input: RunInput,
) -> Result<ExecutionReceipt<RunResult>, ExecutionError> {
    let (token, _registration) = state.register(window.label(), &input.execution_id)?;
    window
        .emit(
            "execution-event",
            json!({"executionId":input.execution_id,"sequence":0,"kind":"registered"}),
        )
        .map_err(|e| ExecutionError::new("eventDeliveryFailed", e.to_string()))?;
    let cancel = token.clone();
    let mut delivery_error = None;
    let mut delivery = Delivery::default();
    let result = execution::execute_run(input, token, |event| {
        if let Err(error) = window.emit("execution-event", delivery.event(event)) {
            delivery_error = Some(ExecutionError::new(
                "eventDeliveryFailed",
                error.to_string(),
            ));
            cancel.cancel();
        }
    })
    .await;
    if let Some(error) = delivery_error {
        Err(error)
    } else {
        Ok(delivery.receipt(result))
    }
}
#[tauri::command]
pub fn cancel_execution(
    window: WebviewWindow,
    state: State<'_, ExecutionState>,
    execution_id: String,
) -> Value {
    let active = state.active.lock().unwrap();
    let token = active.get(&(window.label().into(), execution_id));
    if let Some(token) = token {
        token.cancel();
    }
    json!({"success":token.is_some()})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registrations_are_window_scoped_and_cleaned_on_every_exit() {
        let state = ExecutionState::default();
        let (one, guard) = state.register("one", "same-id").unwrap();
        let (two, other_guard) = state.register("two", "same-id").unwrap();
        assert!(state.register("one", "same-id").is_err());
        state.cancel_window("one");
        assert!(one.is_cancelled());
        assert!(!two.is_cancelled());
        drop(guard);
        assert!(state.register("one", "same-id").is_ok());
        assert_eq!(state.active.lock().unwrap().len(), 1);
        drop(other_guard);
        assert!(state.active.lock().unwrap().is_empty());
        assert!(state.register("one", "").is_err());
    }
}
