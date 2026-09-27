import { describe, expect, it } from "vitest";
import { beginVoiceActionWait, finishVoiceActionWait, getRecognitionErrorDisposition, getVoiceWatchdogDisposition, initialVoiceActionWait, isVoiceFailureReason, isVoiceResponseStalled, recordVoiceFailure, shouldEmitAssistantOutputComplete, shouldRunVoiceWatchdog, shouldSurfaceVoiceFailure } from "./voice-action";
import { ambiguousOnboardingReply, initialOnboardingState, isTrivialSemanticInput } from "./onboarding";

describe("intentional voice action waiting", () => {
  it("waits for the final audio chunk before completing assistant output", () => {
    expect(shouldEmitAssistantOutputComplete(false, 0, false)).toBe(false);
    expect(shouldEmitAssistantOutputComplete(true, 2, false)).toBe(false);
    expect(shouldEmitAssistantOutputComplete(true, 0, false)).toBe(true);
    expect(shouldEmitAssistantOutputComplete(true, 0, true)).toBe(false);
  });

  it("pauses watchdog eligibility for as long as the user has the action open", () => {
    const waiting = beginVoiceActionWait();
    expect(shouldRunVoiceWatchdog(waiting)).toBe(false);
    expect(shouldRunVoiceWatchdog(waiting)).toBe(false);
    expect(getVoiceWatchdogDisposition({ actionWait: waiting, lastProgressAt: 0, now: 30_000, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 1 })).toBe("wait");
    expect(getVoiceWatchdogDisposition({ actionWait: waiting, lastProgressAt: 0, now: 30_000, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 3 })).toBe("wait");
  });

  it("keeps a real transport failure internal until the action is resolved", () => {
    const failed = recordVoiceFailure(beginVoiceActionWait(), "Live socket closed");
    expect(failed.surface).toBe(false);
    expect(failed.state.active).toBe(true);
    expect(finishVoiceActionWait(failed.state)).toEqual({ state: initialVoiceActionWait, deferredFailure: "Live socket closed" });
  });

  it("still surfaces actual failures outside an intentional action", () => {
    expect(recordVoiceFailure(initialVoiceActionWait, "Live socket closed").surface).toBe(true);
    expect(shouldRunVoiceWatchdog(initialVoiceActionWait)).toBe(true);
  });

  it("treats a long response, live progress, or user speech as non-stalled", () => {
    expect(isVoiceResponseStalled({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 20_000, timeoutMs: 9_000, audioPlaying: true, userSpeaking: false })).toBe(false);
    expect(isVoiceResponseStalled({ actionWait: initialVoiceActionWait, lastProgressAt: 15_000, now: 20_000, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false })).toBe(false);
    expect(isVoiceResponseStalled({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 20_000, timeoutMs: 9_000, audioPlaying: false, userSpeaking: true })).toBe(false);
  });

  it("detects a response stall without assuming that the call failed", () => {
    expect(isVoiceResponseStalled({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 9_001, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false })).toBe(true);
    expect(isVoiceResponseStalled({ actionWait: beginVoiceActionWait(), lastProgressAt: 0, now: 30_000, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false })).toBe(false);
  });

  it("never surfaces semantic timeouts or silence as a transport failure", () => {
    expect(shouldSurfaceVoiceFailure("LIVE_RESPONSE_STALLED")).toBe(false);
    expect(shouldSurfaceVoiceFailure("LIVE_FIRST_OUTPUT_DEADLINE")).toBe(false);
    expect(shouldSurfaceVoiceFailure("TURN_RESOLUTION_DEADLINE")).toBe(false);
    expect(shouldSurfaceVoiceFailure("TIMEOUT")).toBe(false);
    expect(shouldSurfaceVoiceFailure("SILENCE")).toBe(false);
    expect(shouldSurfaceVoiceFailure("TRANSPORT_DISCONNECTED")).toBe(true);
    expect(isVoiceFailureReason("PROVIDER_CONNECTION_FAILED")).toBe(true);
    expect(isVoiceFailureReason("VOICE_PROGRESS_TIMEOUT")).toBe(false);
  });

  it("uses a deterministic fallback when generation stalls on an open socket", () => {
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 9_001, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 1 })).toBe("deterministic_fallback");
    expect(shouldSurfaceVoiceFailure("LIVE_RESPONSE_STALLED")).toBe(false);
  });

  it("keeps filler and clarification turns out of transport failure handling", () => {
    expect(isTrivialSemanticInput("um")).toBe(true);
    expect(ambiguousOnboardingReply("um", initialOnboardingState)).toBe("Take your time.");
    expect(ambiguousOnboardingReply("you", { ...initialOnboardingState, step: "conversation", userName: "Luca" })).toContain("one real thing");
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 8_000, now: 8_500, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 1 })).toBe("wait");
  });

  it("does not fail while assistant audio keeps playing past the watchdog interval", () => {
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 30_000, timeoutMs: 9_000, audioPlaying: true, userSpeaking: false, socketReadyState: 1 })).toBe("wait");
  });

  it("surfaces an unexpectedly closed provider socket but ignores intentional teardown", () => {
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 9_001, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 3 })).toBe("transport_failure");
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 9_001, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 1 })).toBe("deterministic_fallback");
    expect(getVoiceWatchdogDisposition({ actionWait: initialVoiceActionWait, lastProgressAt: 0, now: 9_001, timeoutMs: 9_000, audioPlaying: false, userSpeaking: false, socketReadyState: 3, callActive: false })).toBe("wait");
  });

  it("retries a transient speech-recognition network error before treating input transport as fatal", () => {
    expect(getRecognitionErrorDisposition("network", 1)).toBe("retry");
    expect(getRecognitionErrorDisposition("network", 2)).toBe("retry");
    expect(getRecognitionErrorDisposition("network", 3)).toBe("retry");
    expect(getRecognitionErrorDisposition("network", 4)).toBe("retry");
    expect(getRecognitionErrorDisposition("network", 5)).toBe("fatal");
    expect(getRecognitionErrorDisposition("not-allowed", 0)).toBe("fatal");
    expect(getRecognitionErrorDisposition("no-speech", 0)).toBe("ignore");
  });
});
