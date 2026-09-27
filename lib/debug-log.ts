const sensitiveKey = /(?:credential|access.?token|refresh.?token|authorization|cookie|api.?key|secret|oauth.?code)/i;

export function redactDebugText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]")
    .replace(/\bya29\.[A-Za-z0-9._-]+\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(?:code|token|credential)=[^\s&"']+/gi, "[REDACTED]")
    .replace(/([?&](?:code|token|credential)=)[^\s&"']+/gi, "$1[REDACTED]");
}

export function redactDebugValue(value: unknown, key = "", seen = new WeakSet<object>(), depth = 0): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactDebugText(value.slice(0, 3000));
  if (depth > 6) return "[TRUNCATED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactDebugValue(item, "", seen, depth + 1));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    if (Object.getPrototypeOf(value) !== Object.prototype) return "[OBJECT]";
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([name, item]) => [name, redactDebugValue(item, name, seen, depth + 1)]));
  }
  return value;
}
