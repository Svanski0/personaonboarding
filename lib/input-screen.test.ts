import { beforeEach, describe, expect, it, vi } from "vitest";
import { screenUserInput } from "./input-screen";

const model = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("./server", () => ({
  gemini: () => ({ models: { generateContent: model.generateContent } }),
  withServerDeadline: <T>(task: Promise<T>) => task,
}));

describe("Persona input screen", () => {
  beforeEach(() => model.generateContent.mockReset());

  it("uses a structured decision and allows ordinary practical requests", async () => {
    model.generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow" }) });
    await expect(screenUserInput("Can you help me plan my week?")).resolves.toBe("allow");
    expect(model.generateContent.mock.calls[0][0].model).toBe("gemini-3.5-flash-lite");
    expect(model.generateContent.mock.calls[0][0].config.temperature).toBe(0);
  });

  it("rejects an invalid model decision so callers can fail closed", async () => {
    model.generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "maybe" }) });
    await expect(screenUserInput("Can you help me?")).rejects.toThrow("invalid result");
  });
});
