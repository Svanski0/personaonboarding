import { describe, expect, it } from "vitest";
import { classifyProviderError } from "./provider-errors";

describe("Gemini provider error classification", () => {
  it.each([
    [{ status: 429 }, "PROVIDER_RATE_LIMIT"],
    [{ status: 403 }, "PROVIDER_AUTH"],
    [new Error("GEMINI_API_KEY is not configured"), "PROVIDER_AUTH"],
    [{ status: 503 }, "PROVIDER_UNAVAILABLE"],
    [{ status: 404 }, "MODEL_NOT_FOUND"],
    [{ status: 400 }, "REQUEST_INVALID"],
    [new Error("ONBOARDING_MODEL_TIMEOUT"), "TIMEOUT"],
    [new Error("unexpected"), "SERVER_ERROR"],
  ])("classifies %j", (error, category) => {
    expect(classifyProviderError(error).category).toBe(category);
  });
});
