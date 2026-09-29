/**
 * The single structured logger (CLAUDE.md rule 12). One JSON line per event.
 *
 * Log ids and counts only. Never log note contents, extracted text, file
 * contents, titles, tokens or keys. Fields whose names look sensitive are
 * redacted as a backstop, not as permission to pass them in.
 */

type Level = "debug" | "info" | "warn" | "error";
type Primitive = string | number | boolean | null | undefined;
export type LogFields = Record<string, Primitive>;

const SENSITIVE =
  /content|text|title|notes?|body|token|key|secret|password|cookie|authorization/i;

export const REDACTED = "[redacted]";

export function redact(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [name, value] of Object.entries(fields)) {
    out[name] = SENSITIVE.test(name) ? REDACTED : value;
  }
  return out;
}

function write(level: Level, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(fields),
  });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
