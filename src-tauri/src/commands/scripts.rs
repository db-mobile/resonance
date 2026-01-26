use boa_engine::object::ObjectInitializer;
use boa_engine::property::Attribute;
use boa_engine::{js_string, Context, JsValue, NativeFunction, Source};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "resonance-store.json";
const SCRIPTS_KEY: &str = "persistedScripts";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptData {
    pub pre_request_script: String,
    pub test_script: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptExecutionData {
    pub script: String,
    pub request: Value,
    #[serde(default)]
    pub response: Option<Value>,
    pub environment: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub success: bool,
    pub logs: Vec<LogEntry>,
    pub errors: Vec<String>,
    pub test_results: Vec<TestResult>,
    pub modified_request: Option<Value>,
    pub modified_environment: HashMap<String, Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub level: String,
    pub message: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub passed: bool,
    pub message: String,
}

#[tauri::command]
pub async fn script_get(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
) -> Result<ScriptData, String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    let scripts: HashMap<String, ScriptData> = store
        .get(SCRIPTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let key = format!("{}_{}", collection_id, endpoint_id);

    Ok(scripts.get(&key).cloned().unwrap_or(ScriptData {
        pre_request_script: String::new(),
        test_script: String::new(),
    }))
}

#[tauri::command]
pub async fn script_save(
    app: AppHandle,
    collection_id: String,
    endpoint_id: String,
    scripts: ScriptData,
) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;

    let mut all_scripts: HashMap<String, ScriptData> = store
        .get(SCRIPTS_KEY)
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let key = format!("{}_{}", collection_id, endpoint_id);
    all_scripts.insert(key, scripts);

    store.set(
        SCRIPTS_KEY.to_string(),
        serde_json::to_value(all_scripts).unwrap(),
    );
    store.save().map_err(|e| e.to_string())?;

    Ok(())
}

/// Shared state for script execution context
#[derive(Default)]
struct ScriptContext {
    logs: Vec<LogEntry>,
    test_results: Vec<TestResult>,
    environment_changes: HashMap<String, Option<String>>,
    request: Value,
    response: Option<Value>,
    environment: HashMap<String, String>,
}

/// Execute a JavaScript script in a sandboxed environment
fn execute_script(script: &str, ctx: Rc<RefCell<ScriptContext>>) -> Result<(), String> {
    let mut context = Context::default();

    // Setup console object
    let console_ctx = ctx.clone();
    setup_console(&mut context, console_ctx)?;

    // Setup Jest-style test framework (test, it, describe, expect, request, response)
    let jest_ctx = ctx.clone();
    setup_jest(&mut context, jest_ctx)?;

    // Setup pm (Postman-like) object for backward compatibility
    let pm_ctx = ctx.clone();
    setup_pm(&mut context, pm_ctx)?;

    // Execute the script
    let source = Source::from_bytes(script.as_bytes());
    match context.eval(source) {
        Ok(_) => {
            // Collect Jest test results
            let collect_source = Source::from_bytes(b"__collectResults__()");
            if let Ok(results_val) = context.eval(collect_source) {
                let results_str = results_val.display().to_string();
                // Remove surrounding quotes if present
                let results_str = results_str.trim_matches('"');
                // Unescape the JSON string
                let results_str = results_str.replace("\\\"", "\"");
                if let Ok(results) = serde_json::from_str::<Vec<TestResult>>(&results_str) {
                    ctx.borrow_mut().test_results.extend(results);
                }
            }
            Ok(())
        }
        Err(e) => Err(format!("Script error: {}", e)),
    }
}

/// Setup console.log, console.warn, console.error, console.info
fn setup_console(context: &mut Context, ctx: Rc<RefCell<ScriptContext>>) -> Result<(), String> {
    let log_ctx = ctx.clone();
    let log_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let message = args
                .first()
                .map(|v| v.display().to_string())
                .unwrap_or_default();
            log_ctx.borrow_mut().logs.push(LogEntry {
                level: "log".to_string(),
                message,
                timestamp: chrono::Utc::now().timestamp_millis(),
            });
            Ok(JsValue::undefined())
        })
    };

    let warn_ctx = ctx.clone();
    let warn_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let message = args
                .first()
                .map(|v| v.display().to_string())
                .unwrap_or_default();
            warn_ctx.borrow_mut().logs.push(LogEntry {
                level: "warn".to_string(),
                message,
                timestamp: chrono::Utc::now().timestamp_millis(),
            });
            Ok(JsValue::undefined())
        })
    };

    let error_ctx = ctx.clone();
    let error_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let message = args
                .first()
                .map(|v| v.display().to_string())
                .unwrap_or_default();
            error_ctx.borrow_mut().logs.push(LogEntry {
                level: "error".to_string(),
                message,
                timestamp: chrono::Utc::now().timestamp_millis(),
            });
            Ok(JsValue::undefined())
        })
    };

    let info_ctx = ctx.clone();
    let info_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let message = args
                .first()
                .map(|v| v.display().to_string())
                .unwrap_or_default();
            info_ctx.borrow_mut().logs.push(LogEntry {
                level: "info".to_string(),
                message,
                timestamp: chrono::Utc::now().timestamp_millis(),
            });
            Ok(JsValue::undefined())
        })
    };

    let console = ObjectInitializer::new(context)
        .function(log_fn, js_string!("log"), 1)
        .function(warn_fn, js_string!("warn"), 1)
        .function(error_fn, js_string!("error"), 1)
        .function(info_fn, js_string!("info"), 1)
        .build();

    context
        .register_global_property(js_string!("console"), console, Attribute::all())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Setup Jest-style test framework: test(), describe(), expect(), and response/request globals
fn setup_jest(context: &mut Context, ctx: Rc<RefCell<ScriptContext>>) -> Result<(), String> {
    // Define the complete Jest-style test framework
    let jest_code = r#"
        (function() {
            // Test results storage (will be collected by __collectResults__)
            var __testResults__ = [];
            
            // Track if we're inside a test() block
            var __inTestBlock__ = false;
            
            // Helper to create matcher that auto-registers results
            function createMatcher(actual, isNot) {
                function recordResult(pass, message) {
                    if (!__inTestBlock__) {
                        __testResults__.push({ passed: pass, message: message });
                    }
                    if (!pass) {
                        throw new Error(message);
                    }
                }
                
                return {
                    _actual: actual,
                    _not: isNot || false,
                    get not() {
                        return createMatcher(actual, true);
                    },
                    toBe: function(expected) {
                        var pass = this._actual === expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to be " + JSON.stringify(expected);
                        recordResult(pass, msg);
                    },
                    toEqual: function(expected) {
                        var pass = JSON.stringify(this._actual) === JSON.stringify(expected);
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to equal " + JSON.stringify(expected);
                        recordResult(pass, msg);
                    },
                    toBeTruthy: function() {
                        var pass = !!this._actual;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to be truthy";
                        recordResult(pass, msg);
                    },
                    toBeFalsy: function() {
                        var pass = !this._actual;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to be falsy";
                        recordResult(pass, msg);
                    },
                    toBeNull: function() {
                        var pass = this._actual === null;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to be null";
                        recordResult(pass, msg);
                    },
                    toBeUndefined: function() {
                        var pass = this._actual === undefined;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to be undefined";
                        recordResult(pass, msg);
                    },
                    toBeDefined: function() {
                        var pass = this._actual !== undefined;
                        if (this._not) pass = !pass;
                        var msg = "Expected value" + (this._not ? " not " : " ") + "to be defined";
                        recordResult(pass, msg);
                    },
                    toContain: function(expected) {
                        var pass = false;
                        if (typeof this._actual === 'string') {
                            pass = this._actual.indexOf(expected) !== -1;
                        } else if (Array.isArray(this._actual)) {
                            pass = this._actual.indexOf(expected) !== -1;
                        }
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to contain " + JSON.stringify(expected);
                        recordResult(pass, msg);
                    },
                    toBeGreaterThan: function(expected) {
                        var pass = this._actual > expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + this._actual + (this._not ? " not " : " ") + "to be greater than " + expected;
                        recordResult(pass, msg);
                    },
                    toBeGreaterThanOrEqual: function(expected) {
                        var pass = this._actual >= expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + this._actual + (this._not ? " not " : " ") + "to be greater than or equal to " + expected;
                        recordResult(pass, msg);
                    },
                    toBeLessThan: function(expected) {
                        var pass = this._actual < expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + this._actual + (this._not ? " not " : " ") + "to be less than " + expected;
                        recordResult(pass, msg);
                    },
                    toBeLessThanOrEqual: function(expected) {
                        var pass = this._actual <= expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected " + this._actual + (this._not ? " not " : " ") + "to be less than or equal to " + expected;
                        recordResult(pass, msg);
                    },
                    toHaveLength: function(expected) {
                        var pass = this._actual && this._actual.length === expected;
                        if (this._not) pass = !pass;
                        var msg = "Expected length " + (this._actual ? this._actual.length : 'undefined') + (this._not ? " not " : " ") + "to be " + expected;
                        recordResult(pass, msg);
                    },
                    toMatch: function(pattern) {
                        var regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
                        var pass = regex.test(this._actual);
                        if (this._not) pass = !pass;
                        var msg = "Expected " + JSON.stringify(this._actual) + (this._not ? " not " : " ") + "to match " + pattern;
                        recordResult(pass, msg);
                    },
                    toHaveProperty: function(key, value) {
                        var hasKey = this._actual && key in this._actual;
                        var pass = arguments.length === 1 ? hasKey : (hasKey && this._actual[key] === value);
                        if (this._not) pass = !pass;
                        var msg = "Expected object" + (this._not ? " not " : " ") + "to have property " + key + (arguments.length > 1 ? " with value " + JSON.stringify(value) : "");
                        recordResult(pass, msg);
                    }
                };
            }
            
            // expect() function
            function expect(actual) {
                return createMatcher(actual, false);
            }
            
            // test() function - Jest style
            function test(name, fn) {
                __inTestBlock__ = true;
                try {
                    fn();
                    __testResults__.push({ passed: true, message: name });
                } catch (e) {
                    __testResults__.push({ passed: false, message: name + ": " + e.message });
                }
                __inTestBlock__ = false;
            }
            
            // it() is an alias for test()
            var it = test;
            
            // describe() for grouping tests
            function describe(name, fn) {
                try {
                    fn();
                } catch (e) {
                    __testResults__.push({ passed: false, message: name + ": " + e.message });
                }
            }
            
            // Function to get all test results
            function __collectResults__() {
                return JSON.stringify(__testResults__);
            }
            
            return { expect: expect, test: test, it: it, describe: describe, __collectResults__: __collectResults__, __testResults__: __testResults__ };
        })()
    "#;

    let source = Source::from_bytes(jest_code.as_bytes());
    let jest_obj = context.eval(source).map_err(|e| e.to_string())?;

    // Extract functions from the returned object
    if let Some(obj) = jest_obj.as_object() {
        if let Ok(expect_fn) = obj.get(js_string!("expect"), context) {
            context
                .register_global_property(js_string!("expect"), expect_fn, Attribute::all())
                .map_err(|e| e.to_string())?;
        }
        if let Ok(test_fn) = obj.get(js_string!("test"), context) {
            context
                .register_global_property(js_string!("test"), test_fn, Attribute::all())
                .map_err(|e| e.to_string())?;
        }
        if let Ok(it_fn) = obj.get(js_string!("it"), context) {
            context
                .register_global_property(js_string!("it"), it_fn, Attribute::all())
                .map_err(|e| e.to_string())?;
        }
        if let Ok(describe_fn) = obj.get(js_string!("describe"), context) {
            context
                .register_global_property(js_string!("describe"), describe_fn, Attribute::all())
                .map_err(|e| e.to_string())?;
        }
        if let Ok(collect_fn) = obj.get(js_string!("__collectResults__"), context) {
            context
                .register_global_property(
                    js_string!("__collectResults__"),
                    collect_fn,
                    Attribute::all(),
                )
                .map_err(|e| e.to_string())?;
        }
        if let Ok(results_arr) = obj.get(js_string!("__testResults__"), context) {
            context
                .register_global_property(
                    js_string!("__testResults__"),
                    results_arr,
                    Attribute::all(),
                )
                .map_err(|e| e.to_string())?;
        }
    }

    // Create request and response globals from context
    let request_json = {
        let borrowed = ctx.borrow();
        serde_json::to_string(&borrowed.request).unwrap_or("{}".to_string())
    };

    let response_json = {
        let borrowed = ctx.borrow();
        borrowed
            .response
            .as_ref()
            .map(|r| serde_json::to_string(r).unwrap_or("{}".to_string()))
            .unwrap_or("{}".to_string())
    };

    // Register request global
    let request_str = format!("({})", request_json);
    let request_source = Source::from_bytes(request_str.as_bytes());
    let request_obj = context.eval(request_source).unwrap_or(JsValue::undefined());
    context
        .register_global_property(js_string!("request"), request_obj, Attribute::all())
        .map_err(|e| e.to_string())?;

    // Register response global
    let response_str = format!("({})", response_json);
    let response_source = Source::from_bytes(response_str.as_bytes());
    let response_obj = context
        .eval(response_source)
        .unwrap_or(JsValue::undefined());
    context
        .register_global_property(js_string!("response"), response_obj, Attribute::all())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Setup pm object with environment, request, response, and test APIs
fn setup_pm(context: &mut Context, ctx: Rc<RefCell<ScriptContext>>) -> Result<(), String> {
    // pm.environment.get(key)
    let env_get_ctx = ctx.clone();
    let env_get_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let key = args
                .first()
                .map(|v| v.display().to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let value = env_get_ctx.borrow().environment.get(&key).cloned();
            match value {
                Some(v) => Ok(JsValue::from(js_string!(v))),
                None => Ok(JsValue::undefined()),
            }
        })
    };

    // pm.environment.set(key, value)
    let env_set_ctx = ctx.clone();
    let env_set_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let key = args
                .first()
                .map(|v| v.display().to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let value = args
                .get(1)
                .map(|v| v.display().to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            env_set_ctx
                .borrow_mut()
                .environment_changes
                .insert(key, Some(value));
            Ok(JsValue::undefined())
        })
    };

    // pm.environment.unset(key)
    let env_unset_ctx = ctx.clone();
    let env_unset_fn = unsafe {
        NativeFunction::from_closure(move |_, args, _| {
            let key = args
                .first()
                .map(|v| v.display().to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            env_unset_ctx
                .borrow_mut()
                .environment_changes
                .insert(key, None);
            Ok(JsValue::undefined())
        })
    };

    let environment = ObjectInitializer::new(context)
        .function(env_get_fn, js_string!("get"), 1)
        .function(env_set_fn, js_string!("set"), 2)
        .function(env_unset_fn, js_string!("unset"), 1)
        .build();

    // pm.test(name, fn) - simplified test runner
    let test_ctx = ctx.clone();
    let test_fn = unsafe {
        NativeFunction::from_closure(move |_, args, context| {
            let name = args
                .first()
                .map(|v| v.display().to_string().trim_matches('"').to_string())
                .unwrap_or("Unnamed test".to_string());

            let callback = args.get(1);
            let passed = if let Some(cb) = callback {
                if cb.is_callable() {
                    cb.as_callable()
                        .unwrap()
                        .call(&JsValue::undefined(), &[], context)
                        .is_ok()
                } else {
                    false
                }
            } else {
                false
            };

            test_ctx.borrow_mut().test_results.push(TestResult {
                passed,
                message: name,
            });
            Ok(JsValue::undefined())
        })
    };

    // Create request object from context
    let request_json = {
        let borrowed = ctx.borrow();
        serde_json::to_string(&borrowed.request).unwrap_or("{}".to_string())
    };

    // Create response object from context
    let response_json = {
        let borrowed = ctx.borrow();
        borrowed
            .response
            .as_ref()
            .map(|r| serde_json::to_string(r).unwrap_or("{}".to_string()))
            .unwrap_or("{}".to_string())
    };

    // Parse request and response as JS objects
    let request_str = format!("({})", request_json);
    let request_source = Source::from_bytes(request_str.as_bytes());
    let request_obj = context.eval(request_source).unwrap_or(JsValue::undefined());

    let response_str = format!("({})", response_json);
    let response_source = Source::from_bytes(response_str.as_bytes());
    let response_obj = context
        .eval(response_source)
        .unwrap_or(JsValue::undefined());

    let pm = ObjectInitializer::new(context)
        .property(js_string!("environment"), environment, Attribute::all())
        .property(js_string!("request"), request_obj, Attribute::all())
        .property(js_string!("response"), response_obj, Attribute::all())
        .function(test_fn, js_string!("test"), 2)
        .build();

    context
        .register_global_property(js_string!("pm"), pm, Attribute::all())
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn script_execute_pre_request(
    script_data: ScriptExecutionData,
) -> Result<ScriptResult, String> {
    if script_data.script.trim().is_empty() {
        return Ok(ScriptResult {
            success: true,
            logs: Vec::new(),
            errors: Vec::new(),
            test_results: Vec::new(),
            modified_request: Some(script_data.request),
            modified_environment: HashMap::new(),
        });
    }

    let ctx = Rc::new(RefCell::new(ScriptContext {
        logs: Vec::new(),
        test_results: Vec::new(),
        environment_changes: HashMap::new(),
        request: script_data.request.clone(),
        response: script_data.response,
        environment: script_data.environment,
    }));

    let result = execute_script(&script_data.script, ctx.clone());
    let ctx_ref = ctx.borrow();

    match result {
        Ok(_) => Ok(ScriptResult {
            success: true,
            logs: ctx_ref.logs.clone(),
            errors: Vec::new(),
            test_results: ctx_ref.test_results.clone(),
            modified_request: Some(script_data.request),
            modified_environment: ctx_ref.environment_changes.clone(),
        }),
        Err(e) => Ok(ScriptResult {
            success: false,
            logs: ctx_ref.logs.clone(),
            errors: vec![e],
            test_results: ctx_ref.test_results.clone(),
            modified_request: Some(script_data.request),
            modified_environment: ctx_ref.environment_changes.clone(),
        }),
    }
}

#[tauri::command]
pub async fn script_execute_test(script_data: ScriptExecutionData) -> Result<ScriptResult, String> {
    if script_data.script.trim().is_empty() {
        return Ok(ScriptResult {
            success: true,
            logs: Vec::new(),
            errors: Vec::new(),
            test_results: Vec::new(),
            modified_request: None,
            modified_environment: HashMap::new(),
        });
    }

    let ctx = Rc::new(RefCell::new(ScriptContext {
        logs: Vec::new(),
        test_results: Vec::new(),
        environment_changes: HashMap::new(),
        request: script_data.request,
        response: script_data.response,
        environment: script_data.environment,
    }));

    let result = execute_script(&script_data.script, ctx.clone());
    let ctx_ref = ctx.borrow();

    match result {
        Ok(_) => Ok(ScriptResult {
            success: true,
            logs: ctx_ref.logs.clone(),
            errors: Vec::new(),
            test_results: ctx_ref.test_results.clone(),
            modified_request: None,
            modified_environment: ctx_ref.environment_changes.clone(),
        }),
        Err(e) => Ok(ScriptResult {
            success: false,
            logs: ctx_ref.logs.clone(),
            errors: vec![e],
            test_results: ctx_ref.test_results.clone(),
            modified_request: None,
            modified_environment: ctx_ref.environment_changes.clone(),
        }),
    }
}
