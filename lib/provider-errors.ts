export type ProviderFailureCategory = "PROVIDER_RATE_LIMIT" | "PROVIDER_AUTH" | "PROVIDER_UNAVAILABLE" | "MODEL_NOT_FOUND" | "REQUEST_INVALID" | "TIMEOUT" | "SERVER_ERROR";

export function safeProviderReason(error: unknown): string {
  const value = error && typeof error === "object" ? error as { message?: unknown; cause?: unknown } : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as { message?: unknown } : {};
  const message = `${String(value.message ?? "")} ${String(cause.message ?? "")}`.toLowerCase();
  const knownFields = ["temperature", "thinkingconfig", "responseschema", "responsemimetype", "systeminstruction", "httpoptions", "maxoutputtokens"];
  const rejectedField = knownFields.find((field) => message.includes(field));
  if (rejectedField) return `REQUEST_FIELD:${rejectedField.toUpperCase()}`;
  if (message.includes("api key") || message.includes("gemini_api_key")) return "API_KEY_REJECTED";
  if (message.includes("model") && message.includes("not found")) return "MODEL_NOT_FOUND";
  if (message.includes("resource_exhausted") || message.includes("rate limit")) return "QUOTA_OR_RATE_LIMIT";
  if (message.includes("invalid_argument") || message.includes("invalid argument")) return "INVALID_ARGUMENT";
  return "UPSTREAM_ERROR";
}

export function classifyProviderError(error: unknown): { category: ProviderFailureCategory; status?: number } {
  const value = error && typeof error === "object" ? error as { status?: unknown; code?: unknown; message?: unknown; cause?: unknown } : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as { code?: unknown; message?: unknown } : {};
  const status = typeof value.status === "number" ? value.status : undefined;
  const code = `${String(value.code ?? "")} ${String(cause.code ?? "")}`.toLowerCase();
  const message = `${String(value.message ?? "")} ${String(cause.message ?? "")}`.toLowerCase();
  if (status === 408 || status === 504 || code.includes("timeout") || code.includes("abort") || message.includes("timeout") || message.includes("timed out") || message.includes("onboarding_model_timeout")) return { category: "TIMEOUT", status };
  if (status === 429 || code.includes("rate") || message.includes("rate limit") || message.includes("resource_exhausted")) return { category: "PROVIDER_RATE_LIMIT", status };
  if (status === 401 || status === 403 || message.includes("api key") || message.includes("gemini_api_key") || message.includes("unauthorized")) return { category: "PROVIDER_AUTH", status };
  if (status === 404 || message.includes("model") && message.includes("not found")) return { category: "MODEL_NOT_FOUND", status };
  if (status === 400 || message.includes("invalid argument") || message.includes("bad request")) return { category: "REQUEST_INVALID", status };
  if (status !== undefined && status >= 500 || message.includes("unavailable") || message.includes("overloaded")) return { category: "PROVIDER_UNAVAILABLE", status };
  return { category: "SERVER_ERROR", status };
}
