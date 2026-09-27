import { describe, expect, it } from "vitest";
import { VoiceUtteranceTracker } from "./voice-transcription";
import { extractUserFacts, initialOnboardingState, onboardingReducer } from "./onboarding";

describe("canonical voice transcription", () => {
  it.each(["Probably working out", "You're probably working out", "Uh probably SAT studying", "Persona", "Gmail", "Call me Luca", "Call me Luke", "Wait... give me a second"]) ("uses Gemini for %s and emits one turn", (spoken) => {
    const tracker = new VoiceUtteranceTracker();
    const id = tracker.beginActivity();
    tracker.noteBrowser("browser guess");
    tracker.noteGemini(spoken);
    const selected = tracker.finalizeGemini(spoken, 1000);
    expect(selected).toMatchObject({ utteranceId: id, text: spoken, source: "gemini" });
    expect(tracker.finalizeBrowser(1100)).toBeNull();
    expect(tracker.finalizeGemini(spoken, 1200)).toBeNull();
  });

  it("falls back to browser once and ignores a late Gemini result", () => {
    const tracker = new VoiceUtteranceTracker();
    tracker.beginActivity();
    tracker.noteBrowser("Call me Luca");
    expect(tracker.finalizeBrowser(1800)).toMatchObject({ text: "Call me Luca", source: "browser" });
    expect(tracker.beginActivity("gemini", 1900)).toBe(1);
    expect(tracker.finalizeGemini("Call me Luke", 2000)).toBeNull();
    expect(tracker.snapshot()?.finalized?.text).toBe("Call me Luca");
  });

  it("does not finalize silence or background noise without usable text", () => {
    const tracker = new VoiceUtteranceTracker();
    tracker.beginActivity();
    expect(tracker.finalizeBrowser(1500)).toBeNull();
    expect(tracker.finalizeGemini("", 1600)).toBeNull();
  });

  it("starts a new utterance after an interruption", () => {
    const tracker = new VoiceUtteranceTracker();
    const first = tracker.beginActivity();
    tracker.finalizeGemini("Call me Luca", 1000);
    const next = tracker.beginActivity();
    expect(next).not.toBe(first);
    expect(tracker.finalizeGemini("Actually, call me Luke", 2000)).toMatchObject({ utteranceId: next, text: "Actually, call me Luke" });
  });

  it("waits through interim hesitation and parses the selected transcript only", () => {
    const tracker = new VoiceUtteranceTracker();
    const utteranceId = tracker.beginActivity();
    tracker.noteBrowser("you're probably working out");
    tracker.beginActivity();
    tracker.noteGemini("uh... probably SAT studying");
    const selected = tracker.finalizeGemini("uh... probably SAT studying", 2200);
    expect(selected?.utteranceId).toBe(utteranceId);
    const named = { ...initialOnboardingState, agentName: "Nova", step: "conversation" as const, userName: "Luca", statuses: { ...initialOnboardingState.statuses, userName: "confirmed" as const } };
    const observation = extractUserFacts(selected!.text, [{ role: "assistant", text: "What's been taking your time lately?" }], named);
    const next = onboardingReducer(named, { type: "observe", value: observation });
    expect(next.helpNeed).toBe("SAT prep");
    expect(next.helpNeed).not.toBe("Working out");
  });
});
