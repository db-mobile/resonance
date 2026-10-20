//! Execution owns transient state; consumers receive ordered persistence deltas.
use crate::{
    api_request::{self, RequestOptions, RequestState},
    cookies,
    model::*,
    oauth,
    preparation::{self},
    runner,
    scripts::{
        self, IterationInfo, ScriptExecutionData, ScriptResult,
        execution::{ExecutionContext as ScriptContext, ExecutionControl, NextRequest},
    },
    variables::{VariableProcessor, js_string},
};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use tokio::sync::watch;

#[derive(Clone, Debug)]
pub struct Cancellation(watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl Cancellation {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    pub fn is_cancelled(&self) -> bool {
        *self.0.borrow()
    }
    pub async fn cancelled(&self) {
        let mut rx = self.0.subscribe();
        if *rx.borrow_and_update() {
            return;
        }
        let _ = rx.changed().await;
    }
}
struct Session<F: FnMut(ExecutionEvent)> {
    id: String,
    sequence: u64,
    context: ExecutionContext,
    locals: Variables,
    refreshed: HashMap<String, Value>,
    visit: Option<Visit>,
    token: Cancellation,
    emit: F,
    runner: bool,
    strict_variables: bool,
    sent: bool,
}
impl<F: FnMut(ExecutionEvent)> Session<F> {
    fn new(
        id: String,
        context: ExecutionContext,
        token: Cancellation,
        emit: F,
        runner: bool,
    ) -> Self {
        Self {
            id,
            sequence: 0,
            context,
            locals: Variables::new(),
            refreshed: HashMap::new(),
            visit: None,
            token,
            emit,
            runner,
            strict_variables: false,
            sent: false,
        }
    }
    fn event(&mut self, kind: &str, data: Value) {
        self.sequence += 1;
        (self.emit)(ExecutionEvent {
            execution_id: self.id.clone(),
            sequence: self.sequence,
            visit: self.visit.clone(),
            kind: kind.into(),
            data,
        });
    }
    fn effect(&mut self, data: Value) {
        if !self.token.is_cancelled() {
            self.event("effect", data);
        }
    }
    fn variables(&self, template: &RequestTemplate, data: &Value) -> Variables {
        let mut variables = template
            .collection_id
            .as_ref()
            .and_then(|id| self.context.collections.get(id))
            .cloned()
            .unwrap_or_default();
        variables.extend(self.context.environment.clone());
        if let Some(data) = data.as_object() {
            variables.extend(data.clone());
        }
        variables.extend(self.locals.iter().map(|(k, v)| {
            (
                k.clone(),
                if v.is_null() {
                    Value::String("null".into())
                } else {
                    v.clone()
                },
            )
        }));
        variables
    }
    async fn renew(
        &mut self,
        template: &RequestTemplate,
        processor: &mut VariableProcessor,
        vars: &Variables,
    ) -> Value {
        let (raw, source) = preparation::effective_auth(template);
        let key = format!(
            "{}|{}|{}",
            template.collection_id.as_deref().unwrap_or(""),
            source,
            if source["kind"] == "request" {
                template.endpoint_id.as_deref().unwrap_or("")
            } else {
                ""
            }
        );
        if let Some(auth) = self.refreshed.get(&key) {
            return auth.clone();
        }
        let resolved = processor.value(&raw, vars);
        let config = &resolved["config"];
        if resolved["type"] != "oauth2"
            || config["token"].as_str().unwrap_or("").is_empty()
            || config["expiresAt"]
                .as_i64()
                .is_none_or(|at| chrono::Utc::now().timestamp_millis() < at - 30000)
        {
            return raw;
        }
        let grant = if config["refreshToken"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        {
            "refresh_token"
        } else {
            config["grantType"].as_str().unwrap_or("client_credentials")
        };
        if !matches!(grant, "refresh_token" | "client_credentials" | "password") {
            return raw;
        }
        let mut request = config.clone();
        request["grantType"] = grant.into();
        let token_request = serde_json::from_value::<oauth::OAuth2Config>(request);
        let renewal = match token_request {
            Ok(request) => oauth::oauth2_get_token(&self.context.proxy, request).await,
            Err(e) => Err(e.to_string()),
        };
        match renewal {
            Ok(result) if result.success && result.access_token.is_some() => {
                let mut next = raw.clone();
                next["config"]["token"] = result.access_token.unwrap().into();
                if let Some(ttl) = result.expires_in.filter(|n| *n != 0) {
                    next["config"]["expiresAt"] = chrono::Utc::now()
                        .timestamp_millis()
                        .saturating_add(ttl.saturating_mul(1000))
                        .into();
                } else {
                    next["config"].as_object_mut().unwrap().remove("expiresAt");
                }
                if let Some(token) = result.refresh_token.filter(|s| !s.is_empty()) {
                    next["config"]["refreshToken"] = token.into();
                }
                let mut delta = Map::new();
                for field in ["token", "expiresAt", "refreshToken"] {
                    if next["config"][field] != raw["config"][field] {
                        delta.insert(field.into(), next["config"][field].clone());
                    }
                }
                self.effect(json!({"kind":"auth","collectionId":template.collection_id,"endpointId":template.endpoint_id,"source":source,"changes":delta}));
                self.refreshed.insert(key, next.clone());
                next
            }
            result => {
                self.event("warning",json!({"code":"oauthRefreshFailed","details":match result{Err(e)=>e,Ok(r)=>r.error_description.or(r.error).unwrap_or_else(||"Missing access token".into())}}));
                raw
            }
        }
    }
    async fn script(
        &mut self,
        script: &str,
        pre: bool,
        request: &Value,
        response: Option<Value>,
        template: &RequestTemplate,
        iteration: &IterationInfo,
    ) -> Result<ScriptResult, ExecutionError> {
        let strings = |values: &Variables| {
            values
                .iter()
                .map(|(k, v)| (k.clone(), js_string(v)))
                .collect()
        };
        let collection = template
            .collection_id
            .as_ref()
            .and_then(|id| self.context.collections.get(id))
            .cloned()
            .unwrap_or_default();
        let payload = ScriptExecutionData {
            script: script.into(),
            request: [
                "url",
                "method",
                "headers",
                "body",
                "queryParams",
                "pathParams",
            ]
            .into_iter()
            .map(|key| (key.to_string(), request[key].clone()))
            .chain(std::iter::once(("tags".to_string(), json!(template.tags))))
            .collect(),
            response,
            environment: strings(&self.context.environment),
            cookies: if self.context.settings.cookie_jar_enabled == Some(false) {
                vec![]
            } else {
                self.context
                    .cookies
                    .iter()
                    .map(|cookie| json!(cookie))
                    .collect()
            },
            iteration: iteration.clone(),
            collection_variables: strings(&collection),
            local_variables: self.locals.clone(),
            execution_context: ScriptContext {
                runner: self.runner,
                request_id: template.endpoint_id.clone(),
            },
        };
        let result = scripts::execute_cancellable(
            self.context.proxy.clone(),
            payload,
            pre,
            self.token.clone(),
        )
        .await
        .map_err(|e| ExecutionError::new("scriptWorkerFailed", e))?;
        if self.token.is_cancelled() {
            return Err(ExecutionError::new("cancelled", Value::Null));
        }
        for (key, value) in &result.modified_environment {
            apply_variable(&mut self.context.environment, key, value);
        }
        if let Some(id) = &template.collection_id {
            for (key, value) in &result.modified_collection_variables {
                apply_variable(
                    self.context.collections.entry(id.clone()).or_default(),
                    key,
                    value,
                );
            }
        }
        self.locals.extend(result.modified_local_variables.clone());
        for key in &result.removed_local_variables {
            self.locals.remove(key);
        }
        if self.context.settings.cookie_jar_enabled != Some(false) {
            cookies::apply(&mut self.context.cookies, &result.cookie_changes);
        }
        if !result.modified_environment.is_empty()
            || !result.modified_collection_variables.is_empty()
            || !result.cookie_changes.is_empty()
        {
            self.effect(json!({"kind":"script","environmentId":self.context.environment_id,"collectionId":template.collection_id,"environment":result.modified_environment,"collection":result.modified_collection_variables,"cookies":if self.context.settings.cookie_jar_enabled != Some(false) {result.cookie_changes.clone()}else{vec![]}}));
        }
        self.event(
            "script",
            json!({"phase":if pre{"pre"}else{"test"},"result":result}),
        );
        Ok(result)
    }
    async fn visit(&mut self, template: &RequestTemplate, iteration: IterationInfo) -> Value {
        self.sent = false;
        let started = chrono::Utc::now().timestamp_millis();
        let mut result = json!({"collectionId":template.collection_id,"endpointId":template.endpoint_id,"name":template.name,"method":template.method,"path":template.path,"status":"pending","statusCode":null,"responseTime":null,"error":null,"variablesSet":{},"logs":[],"testResults":[],"sent":false});
        let token = self.token.clone();
        let outcome = tokio::select! {biased; _=token.cancelled()=>Err(ExecutionError::new("cancelled",Value::Null)),result=self.perform(template,&iteration,&mut result,started)=>result};
        if let Err(error) = outcome {
            result["status"] = if error.code == "cancelled" {
                "skipped"
            } else {
                "error"
            }
            .into();
            result["executionError"] = json!(error);
            result["error"] = error.code.clone().into();
            result["cancelled"] = (error.code == "cancelled").into();
        }
        result["sent"] = self.sent.into();
        if result["responseTime"].is_null() {
            result["responseTime"] = (chrono::Utc::now().timestamp_millis() - started).into();
        }
        result["time"] = result["responseTime"].clone();
        if let Some(visit) = &self.visit {
            result.as_object_mut().unwrap().extend(
                serde_json::to_value(visit)
                    .unwrap()
                    .as_object()
                    .unwrap()
                    .clone(),
            );
        }
        result
    }
    async fn perform(
        &mut self,
        template: &RequestTemplate,
        iteration: &IterationInfo,
        result: &mut Value,
        started: i64,
    ) -> Result<(), ExecutionError> {
        let data = json!(iteration.data);
        let mut processor = VariableProcessor::default();
        let vars = self.variables(template, &data);
        let auth = self.renew(template, &mut processor, &vars).await;
        let mut prepared =
            preparation::prepare(template, &self.context, &vars, &mut processor, Some(&auth))?;
        let mut control = ExecutionControl::default();
        let mut errors = vec![];
        if !template.pre_request_script.trim().is_empty() {
            let script = self
                .script(
                    &template.pre_request_script,
                    true,
                    &prepared.request,
                    None,
                    template,
                    iteration,
                )
                .await?;
            collect_script(result, &script, &mut control, &mut errors);
            if !script.success {
                return Err(ExecutionError::new(
                    "preRequestFailed",
                    json!(script.errors),
                ));
            }
            if script.execution.skipped {
                result["status"] = "skipped".into();
                result["execution"] = json!(script.execution);
                return Ok(());
            }
            let vars = self.variables(template, &data);
            let rebuilt =
                preparation::prepare(template, &self.context, &vars, &mut processor, Some(&auth))?;
            let modified = script
                .modified_request
                .as_ref()
                .unwrap_or(&prepared.request);
            prepared = preparation::refresh(
                &prepared,
                modified,
                rebuilt,
                &mut processor,
                &vars,
                template,
            );
        }
        if prepared.stripped_credentials {
            self.event(
                "warning",
                json!({"code":"credentialsRemoved", "details":null}),
            );
        }
        preparation::finalize(&mut prepared, &self.context);
        if !self.runner || self.strict_variables {
            let unresolved = crate::variables::unresolved_names(&json!({
                "url":prepared.request["url"], "headers":prepared.request["headers"],
                "queryParams":prepared.request["queryParams"], "pathParams":prepared.request["pathParams"],
                "body":prepared.request["body"], "auth":processor.value(&auth, &self.variables(template, &data))
            }));
            if !unresolved.is_empty() {
                if self.strict_variables {
                    return Err(ExecutionError::new(
                        "unresolvedVariables",
                        json!(unresolved),
                    ));
                }
                self.event(
                    "warning",
                    json!({"code":"unresolvedVariables", "details":unresolved}),
                );
            }
        }
        if self.token.is_cancelled() {
            return Err(ExecutionError::new("cancelled", Value::Null));
        }
        result["requestConfig"] = prepared.request.clone();
        result["historySensitive"] = json!({"headerNames":prepared.auth_headers.keys().collect::<Vec<_>>(),"queryNames":prepared.auth_query.keys().collect::<Vec<_>>()});
        let options: RequestOptions = serde_json::from_value(prepared.request.clone())
            .map_err(|e| ExecutionError::new("invalidRequest", e.to_string()))?;
        self.sent = true;
        self.event("request-sent", Value::Null);
        let response =
            api_request::send_api_request(&RequestState::default(), &self.context.proxy, options)
                .await
                .map_err(|e| ExecutionError::new("transportFailed", e))?;
        result["responseTime"] = (chrono::Utc::now().timestamp_millis() - started).into();
        let response_value = json!(response);
        result["apiResponse"] = response_value.clone();
        result["statusCode"] = json!(response.status);
        result["httpSuccess"] = response.success.into();
        let changes = cookies::response_changes(
            &response.set_cookies,
            prepared.request["url"].as_str().unwrap_or(""),
        );
        let response_cookies: Vec<_> = changes.iter().map(|c| c["cookie"].clone()).collect();
        result["cookies"] = json!(response_cookies);
        if self.context.settings.cookie_jar_enabled != Some(false) && !changes.is_empty() {
            cookies::apply(&mut self.context.cookies, &changes);
            self.effect(json!({"kind":"cookies","environmentId":self.context.environment_id,"cookies":changes}));
        }
        self.event("response",json!({"requestConfig":prepared.request,"response":response_value,"historySensitive":result["historySensitive"],"collectionId":template.collection_id,"endpointId":template.endpoint_id,"environmentName":self.context.environment_name}));
        let script_response = json!({"status":response.status,"statusText":response.status_text,"headers":response.headers,"body":response.data,"timings":response.timings,"cookies":response_cookies});
        for script in [&template.test_script, &template.post_response_script] {
            if !script.trim().is_empty() {
                let script = self
                    .script(
                        script,
                        false,
                        &prepared.request,
                        Some(script_response.clone()),
                        template,
                        iteration,
                    )
                    .await?;
                collect_script(result, &script, &mut control, &mut errors);
            }
        }
        if !errors.is_empty() {
            result["scriptError"] = errors.join("; ").into();
        }
        let tests = result["testResults"].as_array().unwrap().clone();
        if tests.iter().any(|t| t["passed"] != true) || !errors.is_empty() {
            result["status"] = "error".into();
            result["executionError"] = json!(ExecutionError::new(
                "testsFailed",
                json!({"tests":tests,"errors":errors})
            ));
            result["error"] = "testsFailed".into();
        } else if !tests.is_empty() || response.success {
            result["status"] = "success".into();
        } else {
            result["status"] = "error".into();
            result["error"] = response
                .message
                .clone()
                .unwrap_or_else(|| {
                    format!(
                        "{} {}",
                        response.status.unwrap_or(0),
                        response.status_text.clone().unwrap_or_default()
                    )
                })
                .into();
        }
        result["execution"] = json!(if result["status"] == "success" {
            control
        } else {
            ExecutionControl::default()
        });
        Ok(())
    }
}
fn apply_variable(values: &mut Variables, key: &str, value: &Option<String>) {
    if let Some(value) = value {
        values.insert(key.into(), value.clone().into());
    } else {
        values.remove(key);
    }
}
fn collect_script(
    result: &mut Value,
    script: &ScriptResult,
    control: &mut ExecutionControl,
    errors: &mut Vec<String>,
) {
    result["logs"]
        .as_array_mut()
        .unwrap()
        .extend(script.logs.iter().map(|l| json!(l)));
    result["testResults"]
        .as_array_mut()
        .unwrap()
        .extend(script.test_results.iter().map(|t| json!(t)));
    for (key, value) in script
        .modified_collection_variables
        .iter()
        .chain(script.modified_environment.iter())
    {
        result["variablesSet"][key] = json!(value);
    }
    errors.extend(script.errors.clone());
    if script.execution.skipped {
        *control = script.execution.clone();
    } else if script.success && !matches!(script.execution.next, NextRequest::Unchanged) {
        control.next = script.execution.next.clone();
    }
    if !script.success {
        control.next = NextRequest::Unchanged;
    }
}

pub async fn execute_request<F: FnMut(ExecutionEvent)>(
    input: RequestInput,
    token: Cancellation,
    emit: F,
) -> RequestResult {
    let mut session = Session::new(input.execution_id, input.context, token, emit, false);
    session.visit = Some(Visit {
        iteration: 1,
        attempt: 1,
        collection_id: input.request.collection_id.clone(),
        endpoint_id: input.request.endpoint_id.clone(),
        ..Default::default()
    });
    session.event("request-started", json!({"request":input.request}));
    let result = session
        .visit(&input.request, IterationInfo::default())
        .await;
    session.event("completed", result_summary(&result));
    serde_json::from_value(result).expect("executor produced a valid request result")
}
pub async fn execute_run<F: FnMut(ExecutionEvent)>(
    input: RunInput,
    token: Cancellation,
    emit: F,
) -> RunResult {
    let start = chrono::Utc::now().timestamp_millis();
    let mut session = Session::new(input.execution_id, input.context, token, emit, true);
    session.strict_variables = input.options.strict_variables;
    let mut result = json!({"runnerId":input.runner_id,"runnerName":input.runner_name,"startTime":start,"endTime":null,"totalRequests":0,"iterations":1,"passed":0,"failed":0,"skipped":0,"requests":[],"variablesSet":{},"plannedRequests":0,"sentRequests":0,"terminationReason":"completed","error":null});
    let setup = (|| {
        if input.requests.is_empty() {
            return Err(ExecutionError::new("emptyQueue", Value::Null));
        }
        let rows = input
            .data_file
            .as_ref()
            .map(runner::parse_data)
            .transpose()?;
        if rows.as_ref().is_some_and(Vec::is_empty) {
            return Err(ExecutionError::new("emptyDataFile", Value::Null));
        }
        let count = rows
            .as_ref()
            .map(Vec::len)
            .unwrap_or_else(|| runner::iterations(&input.options.iterations));
        let limit = runner::execution_limit(
            &input.options.max_executions_per_iteration,
            input.requests.len(),
        )?;
        Ok((rows, count, limit))
    })();
    match setup {
        Err(error) => {
            result["executionError"] = json!(error);
            result["error"] = error.code.into();
            result["terminationReason"] = "executionError".into();
        }
        Ok((rows, count, limit)) => {
            result["iterations"] = count.into();
            result["plannedRequests"] = (count * input.requests.len()).into();
            let labels = rows.as_ref().map(|rows| {
                rows.iter()
                    .map(|row| {
                        row.as_object()
                            .and_then(|m| m.iter().next())
                            .map(|(k, v)| format!("{k}={}", js_string(v)))
                            .unwrap_or_default()
                    })
                    .collect::<Vec<_>>()
            });
            session.event("run-started",json!({"runnerId":input.runner_id,"total":count*input.requests.len(),"timeline":true,"iterations":count,"iterationLabels":labels}));
            let mut scheduler = runner::Scheduler::new(&input.requests, count, limit);
            while !scheduler.done() {
                if session.token.is_cancelled() {
                    result["terminationReason"] = "stoppedByUser".into();
                    break;
                }
                let visit = match scheduler.take() {
                    Ok(Some(v)) => v,
                    Ok(None) => break,
                    Err(error) => {
                        result["terminationReason"] = error.code.clone().into();
                        result["error"] = error.code.clone().into();
                        result["executionError"] = json!(error);
                        break;
                    }
                };
                let template = &input.requests[visit.queue_position];
                session.visit = Some(visit.clone());
                let mut started = json!(visit);
                started["request"] = json!(template);
                session.event("request-started", started);
                let data = rows
                    .as_ref()
                    .map(|rows| rows[visit.iteration - 1].clone())
                    .unwrap_or(json!({}));
                let iteration = IterationInfo {
                    iteration: (visit.iteration - 1) as u32,
                    iteration_count: count as u32,
                    data: serde_json::from_value(data).unwrap_or_default(),
                    request_name: Some(template.name.clone()),
                };
                let mut item = session.visit(template, iteration).await;
                if !session.token.is_cancelled() {
                    let next = if item["status"] == "success" {
                        serde_json::from_value(item["execution"]["next"].clone())
                            .unwrap_or_default()
                    } else {
                        NextRequest::Unchanged
                    };
                    if let Err(error) = scheduler.advance(&next) {
                        item["status"] = "error".into();
                        item["error"] = error.code.clone().into();
                        item["executionError"] = json!(error);
                        result["error"] = error.code.clone().into();
                        result["terminationReason"] = error.code.into();
                    }
                }
                let counter = match item["status"].as_str().unwrap_or("") {
                    "success" => "passed",
                    "skipped" => "skipped",
                    _ => "failed",
                };
                result[counter] = (result[counter].as_u64().unwrap() + 1).into();
                if item["sent"] == true {
                    result["sentRequests"] = (result["sentRequests"].as_u64().unwrap() + 1).into();
                }
                result["variablesSet"]
                    .as_object_mut()
                    .unwrap()
                    .extend(item["variablesSet"].as_object().unwrap().clone());
                let failed = item["status"] == "error";
                let summary = result_summary(&item);
                result["requests"].as_array_mut().unwrap().push(item);
                result["totalRequests"] = result["requests"].as_array().unwrap().len().into();
                session.event(
                    "request-completed",
                    json!({"index":visit.index,"result":summary}),
                );
                if session.token.is_cancelled() {
                    result["terminationReason"] = "stoppedByUser".into();
                    break;
                }
                if !result["error"].is_null() {
                    break;
                }
                if failed && input.options.stop_on_error {
                    result["terminationReason"] = "stoppedOnError".into();
                    break;
                }
                if !scheduler.done()
                    && let Some(ms) = input.options.delay_ms.filter(|ms| *ms > 0)
                {
                    tokio::select! {_=session.token.cancelled()=>{},_=tokio::time::sleep(std::time::Duration::from_millis(ms))=>{}}
                }
            }
        }
    }
    result["endTime"] = chrono::Utc::now().timestamp_millis().into();
    result["totalTime"] = (result["endTime"].as_i64().unwrap() - start).into();
    session.visit = None;
    session.event("completed", result_summary(&result));
    serde_json::from_value(result).expect("executor produced a valid run result")
}

/// Progress and completion notifications carry metadata, not response bodies.
/// The executor return value is the canonical report; response events support
/// live presentation and desktop history without copying the entire run again.
fn result_summary(result: &Value) -> Value {
    Value::Object(
        result
            .as_object()
            .unwrap()
            .iter()
            .filter(|(key, _)| !matches!(key.as_str(), "apiResponse" | "requests"))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

#[cfg(test)]
mod result_tests {
    use super::*;
    #[test]
    fn completion_summaries_do_not_copy_large_response_bodies() {
        let item = json!({"status":"success", "apiResponse":{"data":"x".repeat(1_000_000)}});
        assert_eq!(result_summary(&item), json!({"status":"success"}));
        let run = json!({"requests":[item], "passed":1});
        assert_eq!(result_summary(&run), json!({"passed":1}));
    }
}
