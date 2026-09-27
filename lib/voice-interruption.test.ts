import { describe, expect, it } from "vitest";
import { isAssistantEcho, isDuplicateAssistantOutput } from "./voice-interruption";

describe("voice barge-in echo filtering", () => {
  it("ignores a clear verbatim phrase from Nova's current response", () => {
    expect(isAssistantEcho("what name should I use", "Hi, I'm Nova. What name should I use for you?" )).toBe(true);
  });

  it("does not swallow short user interruptions", () => {
    const assistant = "I can help you get started. What has been taking up most of your time lately?";
    expect(isAssistantEcho("yeah", assistant)).toBe(false);
    expect(isAssistantEcho("wait", assistant)).toBe(false);
    expect(isAssistantEcho("I", assistant)).toBe(false);
  });

  it("does not treat scattered shared words as assistant echo", () => {
    expect(isAssistantEcho("help with school", "I can help you get started with what matters to you." )).toBe(false);
  });

  it("filters a clipped browser transcript at the end of an assistant phrase", () => {
    expect(isAssistantEcho("connect G", "Want to connect" )).toBe(true);
    expect(isAssistantEcho("Google", "Want to connect Google" )).toBe(true);
    expect(isAssistantEcho("wait", "Want to connect Google" )).toBe(false);
    expect(isAssistantEcho("yeah", "Want to connect Google" )).toBe(false);
  });

  it("suppresses duplicate assistant transcript finals only within the same voice turn", () => {
    const previous = { turnId: 4, text: "No problem, Luca." };
    expect(isDuplicateAssistantOutput(previous, { turnId: 4, text: "No problem Luca" })).toBe(true);
    expect(isDuplicateAssistantOutput(previous, { turnId: 5, text: "No problem, Luca." })).toBe(false);
  });
});
