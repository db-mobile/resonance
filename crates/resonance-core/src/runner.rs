use crate::{model::*, scripts::execution::NextRequest};
use serde_json::{Map, Value, json};
use std::collections::HashMap;

pub struct Scheduler<'a> {
    queue: &'a [RequestTemplate],
    iterations: usize,
    limit: usize,
    position: usize,
    iteration: usize,
    index: usize,
    visits: usize,
    attempts: HashMap<usize, usize>,
}
impl<'a> Scheduler<'a> {
    pub fn new(queue: &'a [RequestTemplate], iterations: usize, limit: usize) -> Self {
        Self {
            queue,
            iterations,
            limit,
            position: 0,
            iteration: 1,
            index: 0,
            visits: 0,
            attempts: HashMap::new(),
        }
    }
    pub fn done(&self) -> bool {
        self.iteration > self.iterations || self.queue.is_empty()
    }
    pub fn take(&mut self) -> Result<Option<Visit>, ExecutionError> {
        if self.done() {
            return Ok(None);
        }
        if self.visits >= self.limit {
            return Err(ExecutionError::new(
                "executionLimit",
                json!({"limit":self.limit,"iteration":self.iteration}),
            ));
        }
        self.visits += 1;
        let attempt = self.attempts.entry(self.position).or_default();
        *attempt += 1;
        let request = &self.queue[self.position];
        let visit = Visit {
            index: self.index,
            queue_position: self.position,
            iteration: self.iteration,
            attempt: *attempt,
            collection_id: request.collection_id.clone(),
            endpoint_id: request.endpoint_id.clone(),
        };
        self.index += 1;
        Ok(Some(visit))
    }
    pub fn advance(&mut self, next: &NextRequest) -> Result<(), ExecutionError> {
        self.position = match next {
            NextRequest::Unchanged => self.position + 1,
            NextRequest::StopIteration => self.queue.len(),
            NextRequest::Request { target } => self.resolve(target)?,
        };
        if self.position >= self.queue.len() {
            self.iteration += 1;
            self.position = 0;
            self.visits = 0;
            self.attempts.clear();
        }
        Ok(())
    }
    fn resolve(&self, target: &str) -> Result<usize, ExecutionError> {
        if self.queue[self.position].endpoint_id.as_deref() == Some(target) {
            return Ok(self.position);
        }
        let mut matches: Vec<_> = self
            .queue
            .iter()
            .enumerate()
            .filter(|(_, r)| r.endpoint_id.as_deref() == Some(target))
            .map(|(i, _)| i)
            .collect();
        if matches.is_empty() {
            matches = self
                .queue
                .iter()
                .enumerate()
                .filter(|(_, r)| r.name == target)
                .map(|(i, _)| i)
                .collect();
        }
        if matches.len() == 1 {
            Ok(matches[0])
        } else {
            Err(ExecutionError::new(
                "invalidTarget",
                json!({"target":target,"ambiguous":!matches.is_empty()}),
            ))
        }
    }
}

pub fn execution_limit(
    value: &Option<Value>,
    queue_length: usize,
) -> Result<usize, ExecutionError> {
    let min = queue_length.max(1);
    let max = min.max(100000);
    let Some(value) = value.as_ref().filter(|v| !v.is_null() && *v != "") else {
        return Ok(min.max(1000));
    };
    let number = value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(f64::NAN);
    if !number.is_finite() || number.fract() != 0.0 || number < min as f64 || number > max as f64 {
        return Err(ExecutionError::new(
            "invalidExecutionLimit",
            json!({"min":min,"max":max}),
        ));
    }
    Ok(number as usize)
}
pub fn iterations(value: &Option<Value>) -> usize {
    // Match the editor's parseInt(value, 10), including fractional numbers and
    // numeric prefixes in saved legacy runner options.
    let raw = value
        .as_ref()
        .map(crate::variables::js_string)
        .unwrap_or_default();
    let raw = raw.trim_start().trim_start_matches('+');
    let digits: String = raw.chars().take_while(char::is_ascii_digit).collect();
    digits.parse::<u64>().unwrap_or(1).clamp(1, 1000) as usize
}

pub fn parse_data(file: &DataFile) -> Result<Vec<Value>, ExecutionError> {
    let text = file.content.trim_start_matches('\u{feff}');
    if file.name.to_lowercase().ends_with(".json") {
        let value: Value = serde_json::from_str(text)
            .map_err(|e| ExecutionError::new("invalidDataJson", e.to_string()))?;
        let rows = value
            .as_array()
            .filter(|rows| rows.iter().all(Value::is_object))
            .ok_or_else(|| ExecutionError::new("invalidDataRows", Value::Null))?;
        return Ok(rows
            .iter()
            .map(|row| {
                Value::Object(
                    row.as_object()
                        .unwrap()
                        .iter()
                        .map(|(k, v)| {
                            (
                                k.clone(),
                                Value::String(match v {
                                    Value::Null => String::new(),
                                    Value::String(s) => s.clone(),
                                    _ => v.to_string(),
                                }),
                            )
                        })
                        .collect(),
                )
            })
            .collect());
    }
    let mut records = Vec::new();
    let mut lines = Vec::new();
    let mut record = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut line = 1;
    let mut record_line = 1;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if quoted {
            if c == '"' && chars.peek() == Some(&'"') {
                field.push('"');
                chars.next();
            } else if c == '"' {
                quoted = false;
            } else {
                if c == '\n' {
                    line += 1;
                }
                field.push(c);
            }
        } else if c == '"' && field.is_empty() {
            quoted = true;
        } else if c == ',' {
            record.push(std::mem::take(&mut field));
        } else if c == '\n' || c == '\r' {
            if c == '\r' && chars.peek() == Some(&'\n') {
                chars.next();
            }
            record.push(std::mem::take(&mut field));
            if record.len() != 1 || !record[0].is_empty() {
                records.push(std::mem::take(&mut record));
                lines.push(record_line);
            } else {
                record.clear();
            }
            line += 1;
            record_line = line;
        } else {
            field.push(c);
        }
    }
    if quoted {
        return Err(ExecutionError::new(
            "unclosedDataQuote",
            json!({"line":record_line}),
        ));
    }
    if !field.is_empty() || !record.is_empty() {
        record.push(field);
        records.push(record);
        lines.push(record_line);
    }
    if records.is_empty() {
        return Ok(vec![]);
    }
    let headers: Vec<_> = records[0].iter().map(|s| s.trim().to_string()).collect();
    if headers.iter().any(String::is_empty) {
        return Err(ExecutionError::new("emptyDataHeader", Value::Null));
    }
    records
        .iter()
        .skip(1)
        .enumerate()
        .map(|(index, row)| {
            if row.len() > headers.len() {
                return Err(ExecutionError::new(
                    "extraDataValues",
                    json!({"line":lines[index+1]}),
                ));
            }
            Ok(Value::Object(
                headers
                    .iter()
                    .enumerate()
                    .map(|(i, k)| {
                        (
                            k.clone(),
                            Value::String(row.get(i).cloned().unwrap_or_default()),
                        )
                    })
                    .collect::<Map<_, _>>(),
            ))
        })
        .collect()
}
