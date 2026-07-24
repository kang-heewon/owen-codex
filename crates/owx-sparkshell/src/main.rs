mod codex_bridge;
mod error;
mod exec;
mod prompt;
mod redaction;
#[cfg(test)]
mod test_support;
mod threshold;

use crate::codex_bridge::summarize_output;
use crate::error::SparkshellError;
use crate::exec::{execute_command, resolve_shell_argv, CommandOutput};
use crate::redaction::redact_output;
use crate::threshold::{combined_visible_lines, read_line_threshold};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{self, Write};
use std::process;

#[derive(Debug, Clone, PartialEq, Eq)]
enum SparkShellTarget {
    Command(Vec<String>),
    Shell(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SparkShellOptions {
    target: SparkShellTarget,
    json: bool,
    budget: usize,
}

#[derive(Debug, Clone)]
struct Evidence {
    stdout_lines: usize,
    stderr_lines: usize,
    raw_hash: String,
    line_range: Option<String>,
}

const DEFAULT_BUDGET: usize = 1000;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args
        .first()
        .is_some_and(|arg| arg == "--help" || arg == "-h")
    {
        println!("{}", usage_text());
        return;
    }
    if let Err(error) = run(args) {
        eprintln!("owx sparkshell: {error}");
        process::exit(error.raw_exit_code());
    }
}

fn run(args: Vec<String>) -> Result<(), SparkshellError> {
    let options = parse_input(&args)?;
    let execution_argv = match &options.target {
        SparkShellTarget::Command(command) => command.clone(),
        SparkShellTarget::Shell(script) => resolve_shell_argv(script),
    };

    let raw_output = execute_command(&execution_argv)?;
    let redacted = redact_output(&raw_output);
    let output = if options.json {
        &redacted.output
    } else {
        &raw_output
    };
    let summary_output = &redacted.output;
    let threshold = read_line_threshold();
    let line_count = combined_visible_lines(&output.stdout, &output.stderr);
    let evidence = build_evidence(output);

    if options.json {
        let summary = if line_count <= threshold {
            compact_text(&combined_text(output), options.budget)
        } else {
            summarize_output(&execution_argv, output).unwrap_or_else(|error| {
                format!("summary unavailable: {error}; raw output omitted from JSON report")
            })
        };
        write_json_report(&options, output, &summary, &evidence, redacted.count)?;
        process::exit(output.exit_code());
    }

    if line_count <= threshold {
        write_raw_output(&output.stdout, &output.stderr)?;
        process::exit(output.exit_code());
    }

    match summarize_output(&execution_argv, summary_output) {
        Ok(summary) => {
            let mut stdout = io::stdout().lock();
            stdout.write_all(compact_text(&summary, options.budget).as_bytes())?;
            if !summary.ends_with('\n') {
                stdout.write_all(b"\n")?;
            }
            stdout.flush()?;
        }
        Err(error) => {
            write_raw_output(&output.stdout, &output.stderr)?;
            eprintln!("owx sparkshell: summary unavailable ({error}); showing raw output instead");
        }
    }

    process::exit(output.exit_code());
}

fn write_raw_output(stdout_bytes: &[u8], stderr_bytes: &[u8]) -> Result<(), SparkshellError> {
    let mut stdout = io::stdout().lock();
    stdout.write_all(stdout_bytes)?;
    stdout.flush()?;

    let mut stderr = io::stderr().lock();
    stderr.write_all(stderr_bytes)?;
    stderr.flush()?;
    Ok(())
}

fn usage_text() -> String {
    concat!(
        "usage: owx-sparkshell <command> [args...]\n",
        "   or: owx-sparkshell --shell <shell-command>\n",
        "\n",
        "Direct command mode executes argv without shell metacharacter parsing.\n",
        "Shell mode executes through bash -lc/sh -lc on POSIX and a native Windows shell on Windows.\n"
    )
    .to_string()
}

fn parse_input(args: &[String]) -> Result<SparkShellOptions, SparkshellError> {
    if args.is_empty() {
        return Err(SparkshellError::InvalidArgs(usage_text()));
    }

    let mut positional = Vec::new();
    let mut json = false;
    let mut budget = DEFAULT_BUDGET;
    let mut shell = None;

    let mut index = 0;
    while index < args.len() {
        let token = &args[index];
        if !positional.is_empty() {
            positional.extend(args[index..].iter().cloned());
            break;
        }
        if token == "--" {
            positional.extend(args[index + 1..].iter().cloned());
            break;
        }
        if token == "--json" {
            json = true;
            index += 1;
            continue;
        }
        if token == "--budget" {
            let Some(next) = args.get(index + 1) else {
                return Err(SparkshellError::InvalidArgs(
                    "--budget requires a numeric value".to_string(),
                ));
            };
            budget = parse_positive_usize(next, "--budget")?;
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--budget=") {
            budget = parse_positive_usize(value, "--budget")?;
            index += 1;
            continue;
        }
        if token == "--shell" {
            let Some(next) = args.get(index + 1) else {
                return Err(SparkshellError::InvalidArgs(
                    "--shell requires a command string".to_string(),
                ));
            };
            shell = Some(next.clone());
            index += 2;
            continue;
        }
        if let Some(value) = token.strip_prefix("--shell=") {
            if value.trim().is_empty() {
                return Err(SparkshellError::InvalidArgs(
                    "--shell requires a command string".to_string(),
                ));
            }
            shell = Some(value.to_string());
            index += 1;
            continue;
        }
        positional.push(token.clone());
        index += 1;
    }

    let target = if let Some(script) = shell {
        if !positional.is_empty() {
            return Err(SparkshellError::InvalidArgs(
                "--shell does not accept additional argv".to_string(),
            ));
        }
        SparkShellTarget::Shell(script)
    } else {
        SparkShellTarget::Command(positional)
    };

    Ok(SparkShellOptions {
        target,
        json,
        budget,
    })
}

fn parse_positive_usize(raw: &str, flag: &str) -> Result<usize, SparkshellError> {
    raw.trim()
        .parse::<usize>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| SparkshellError::InvalidArgs(format!("{flag} requires a positive integer")))
}

fn build_evidence(output: &CommandOutput) -> Evidence {
    let text = combined_text(output);
    let lines = text.lines().count();
    Evidence {
        stdout_lines: String::from_utf8_lossy(&output.stdout).lines().count(),
        stderr_lines: String::from_utf8_lossy(&output.stderr).lines().count(),
        raw_hash: hash_text(&text),
        line_range: (lines > 0).then(|| format!("1-{lines}")),
    }
}

fn combined_text(output: &CommandOutput) -> String {
    format!("{}{}", output.stdout_text(), output.stderr_text())
}

fn hash_text(text: &str) -> String {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn compact_text(text: &str, budget: usize) -> String {
    if text.len() <= budget {
        return text.to_string();
    }
    let end = safe_boundary(text, budget);
    format!(
        "{}\n[truncated: {} chars omitted]",
        &text[..end],
        text.len().saturating_sub(end)
    )
}

fn safe_boundary(text: &str, max: usize) -> usize {
    let mut end = 0;
    for (index, ch) in text.char_indices() {
        let next = index + ch.len_utf8();
        if next > max {
            break;
        }
        end = next;
    }
    end
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\u{08}' => escaped.push_str("\\b"),
            '\u{0c}' => escaped.push_str("\\f"),
            ch if ch <= '\u{1f}' => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn json_str(value: &str) -> String {
    format!("\"{}\"", json_escape(value))
}

fn json_string_array(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| json_str(value))
            .collect::<Vec<_>>()
            .join(",")
    )
}

#[derive(Debug, Clone)]
struct Diagnostics {
    classification: String,
    next_action: String,
    confidence: f32,
    errors: Vec<String>,
    warnings: Vec<String>,
}

fn classify(output: &CommandOutput) -> Diagnostics {
    let text = combined_text(output).to_ascii_lowercase();
    let mut diagnostics = Diagnostics {
        classification: "unknown".to_string(),
        next_action: "inspect raw output".to_string(),
        confidence: 0.45,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    if text.contains("authorization") || text.contains("authentication") || text.contains("401") {
        diagnostics.classification = "auth_error".to_string();
        diagnostics.confidence = 0.8;
        diagnostics
            .errors
            .push("authentication-like error in output".to_string());
    } else if text.contains("typeerror") || text.contains("type error") {
        diagnostics.classification = "type_error".to_string();
        diagnostics.confidence = 0.75;
        diagnostics
            .errors
            .push("type error pattern in output".to_string());
    } else if text.contains("test failed") || text.contains("failures:") || text.contains("failed")
    {
        diagnostics.classification = "test_failure".to_string();
        diagnostics.confidence = 0.65;
        diagnostics
            .errors
            .push("failure pattern in output".to_string());
    } else if text.contains("press enter")
        || text.contains("waiting for input")
        || text.contains("continue?")
    {
        diagnostics.classification = "waiting_for_input".to_string();
        diagnostics.confidence = 0.75;
    } else if text.contains("thinking") || text.contains("running") || text.contains("building") {
        diagnostics.classification = "busy_processing".to_string();
        diagnostics.next_action = "wait".to_string();
        diagnostics.confidence = 0.65;
        diagnostics.warnings.push("do not shutdown yet".to_string());
    }

    diagnostics
}

fn write_json_report(
    options: &SparkShellOptions,
    output: &CommandOutput,
    summary: &str,
    evidence: &Evidence,
    redaction_count: usize,
) -> Result<(), SparkshellError> {
    let mode = match options.target {
        SparkShellTarget::Command(_) => "command",
        SparkShellTarget::Shell(_) => "shell",
    };
    let status = if output.status.success() {
        "ok"
    } else {
        "failed"
    };
    let mut diagnostics = classify(output);
    if !output.status.success() && diagnostics.errors.is_empty() {
        diagnostics
            .errors
            .push(compact_text(&output.stderr_text(), options.budget));
    }
    let json = format!(
        concat!(
            "{{\n",
            "  \"ok\": {},\n",
            "  \"mode\": {},\n",
            "  \"status\": {},\n",
            "  \"exit_code\": {},\n",
            "  \"summary\": {},\n",
            "  \"errors\": {},\n",
            "  \"warnings\": {},\n",
            "  \"evidence\": {{\"stdout_lines\":{},\"stderr_lines\":{},\"raw_hash\":{},\"line_range\":{}}},\n",
            "  \"next_action\": {},\n",
            "  \"confidence\": {:.2},\n",
            "  \"classification\": {},\n",
            "  \"redactions\": {{\"count\": {}}}\n",
            "}}\n"
        ),
        output.status.success(),
        json_str(mode),
        json_str(status),
        output.exit_code(),
        json_str(&compact_text(summary, options.budget)),
        json_string_array(&diagnostics.errors),
        json_string_array(&diagnostics.warnings),
        evidence.stdout_lines,
        evidence.stderr_lines,
        json_str(&evidence.raw_hash),
        evidence
            .line_range
            .as_ref()
            .map(|value| json_str(value))
            .unwrap_or_else(|| "null".to_string()),
        json_str(&diagnostics.next_action),
        diagnostics.confidence,
        json_str(&diagnostics.classification),
        redaction_count,
    );
    io::stdout().write_all(json.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_input, SparkShellTarget};

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_direct_command_mode() {
        let parsed = parse_input(&strings(&["git", "status"])).expect("parsed");
        assert_eq!(
            parsed.target,
            SparkShellTarget::Command(strings(&["git", "status"]))
        );
    }
}
