//! Execution controls and JSON-valued request/run-local variables.
use super::*;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionContext {
    #[serde(default)]
    pub runner: bool,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NextRequest {
    #[default]
    Unchanged,
    Request {
        target: String,
    },
    StopIteration,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionControl {
    pub next: NextRequest,
    pub skipped: bool,
}

pub(super) fn setup(
    context: &mut Context,
    state: Rc<RefCell<ScriptContext>>,
    pre: bool,
) -> Result<(), String> {
    let read = state.clone();
    let snapshot = unsafe {
        NativeFunction::from_closure(move |_, _, _| {
            let state = read.borrow();
            let mut values = state.local_variables.clone();
            values.extend(state.local_changes.clone());
            for key in &state.removed_locals {
                values.remove(key);
            }
            Ok(JsValue::from(js_string!(
                serde_json::to_string(&values).unwrap()
            )))
        })
    };
    let write = state.clone();
    let setter = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let key = string_arg(args, 0);
            let json = string_arg(args, 1);
            let value: Value = serde_json::from_str(&json).map_err(|_| {
                JsNativeError::typ().with_message("Local variables must be JSON-serializable")
            })?;
            let mut state = write.borrow_mut();
            state.removed_locals.retain(|name| name != &key);
            state.local_changes.insert(key, value);
            Ok(JsValue::undefined())
        })
    };
    let remove = state.clone();
    let unsetter = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let key = string_arg(args, 0);
            let mut state = remove.borrow_mut();
            state.local_changes.remove(&key);
            if !state.removed_locals.contains(&key) {
                state.removed_locals.push(key);
            }
            Ok(JsValue::undefined())
        })
    };
    let next = state.clone();
    let navigator = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let target = match args.first() {
                Some(value) if value.is_null() => NextRequest::StopIteration,
                Some(value) if value.is_string() => NextRequest::Request {
                    target: js_text(value),
                },
                _ => {
                    return Err(JsNativeError::typ()
                        .with_message("setNextRequest expects a request name, ID, or null")
                        .into());
                }
            };
            if next.borrow().execution_context.runner {
                next.borrow_mut().execution.next = target;
            }
            Ok(JsValue::undefined())
        })
    };
    let skip = unsafe {
        NativeFunction::from_closure(move |_, _, _| {
            if !pre {
                return Err(JsNativeError::typ()
                    .with_message("skipRequest is only available in pre-request scripts")
                    .into());
            }
            let mut state = state.borrow_mut();
            state.execution.skipped = true;
            state.execution.next = NextRequest::Unchanged;
            // RuntimeLimit is Boa's uncatchable completion. The outer evaluator
            // recognizes this explicit skip state and reports success, not an error.
            Err(JsNativeError::runtime_limit()
                .with_message("Request skipped")
                .into())
        })
    };
    for (name, arity, function) in [
        ("__localVariables__", 0, snapshot),
        ("__setLocalVariable__", 2, setter),
        ("__unsetLocalVariable__", 1, unsetter),
        ("__setNextRequest__", 1, navigator),
        ("__skipRequest__", 0, skip),
    ] {
        context
            .register_global_callable(js_string!(name), arity, function)
            .map_err(|e| e.to_string())?;
    }
    context.eval(Source::from_bytes(b"pm.execution = {setNextRequest: __setNextRequest__, skipRequest: __skipRequest__}; globalThis.postman = {setNextRequest: __setNextRequest__};"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
