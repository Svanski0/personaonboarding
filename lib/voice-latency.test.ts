import { afterEach, describe, expect, it, vi } from "vitest";
import { extractUserFacts, initialOnboardingState, onboardingReducer } from "./onboarding";
import { fastVoiceReply, isCurrentVoiceGeneration, isFastVoiceTransition, resolveWithin, shouldRetryVoiceStart, voiceLatencySummary, type VoiceTurnTiming } from "./voice-latency";

const conversation = { ...initialOnboardingState, agentName: "Nova", step: "conversation" as const };

describe("voice latency fast paths", () => {
  it("answers a clear name capture without reply-model generation", () => {
    const current = onboardingReducer(conversation, { type: "observe", value: { updates: { userName: "Luca" } } });
    expect(isFastVoiceTransition(conversation, current, "You can call me Luca")).toBe(true);
    expect(fastVoiceReply(current)).toMatch(/Luca.*taking up.*time/i);
  });

  it("advances a captured goal directly to the Google objective", () => {
    const named = onboardingReducer(conversation, { type: "observe", value: { updates: { userName: "Luca" } } });
    const observation = extractUserFacts("I've been having a lot of school work and SAT stuff", [], named);
    const current = onboardingReducer(named, { type: "observe", value: observation });
    expect(current.helpNeed).toBe("Schoolwork and SAT prep");
    expect(isFastVoiceTransition(named, current, "I've been having a lot of school work and SAT stuff")).toBe(true);
    expect(fastVoiceReply(current)).toMatch(/connect Google/i);
  });

  it("graduates without a reply-model request", () => {
    const ready = onboardingReducer(conversation, { type: "observe", value: { updates: { userName: "Luca", helpNeed: "SAT prep" } } });
    const deferred = onboardingReducer(ready, { type: "observe", value: { deferred: ["google"] } });
    expect(isFastVoiceTransition(ready, deferred, "No thanks")).toBe(true);
    expect(isFastVoiceTransition(deferred, deferred, "Okay")).toBe(true);
    expect(fastVoiceReply(deferred)).toMatch(/all set, Luca/i);
  });

  it("keeps ambiguous turns on the dynamic path", () => {
    expect(isFastVoiceTransition(conversation, conversation, "Maybe, I'm not sure yet")).toBe(false);
  });
});

describe("voice response deadlines and stale generations", () => {
  afterEach(() => vi.useRealTimers());

  it("uses one deterministic response when the dynamic reply misses its deadline", async () => {
    vi.useFakeTimers();
    let resolveTask!: (value: string) => void;
    const task = new Promise<string>((resolve) => { resolveTask = resolve; });
    const abort = vi.fn();
    const pending = resolveWithin(task, 1200, abort);
    await vi.advanceTimersByTimeAsync(1200);
    const result = await pending;
    expect(result).toEqual({ timedOut: true });
    expect(abort).toHaveBeenCalledOnce();
    resolveTask("late model reply");
    await Promise.resolve();
    expect(result).not.toHaveProperty("value");
  });

  it("keeps a quick model result and cancels its deadline", async () => {
    vi.useFakeTimers();
    const result = await resolveWithin(Promise.resolve("quick reply"), 1200, vi.fn());
    expect(result).toEqual({ value: "quick reply", timedOut: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects late or interrupted turn results", () => {
    const controller = new AbortController();
    expect(isCurrentVoiceGeneration(8, 8, controller.signal)).toBe(true);
    expect(isCurrentVoiceGeneration(9, 8, controller.signal)).toBe(false);
    controller.abort();
    expect(isCurrentVoiceGeneration(8, 8, controller.signal)).toBe(false);
  });

  it("retries voice only when the current turn has produced no first token", () => {
    const timing: VoiceTurnTiming = { turnId: 4 };
    expect(shouldRetryVoiceStart(timing, 4)).toBe(true);
    timing.modelFirstToken = 100;
    expect(shouldRetryVoiceStart(timing, 4)).toBe(false);
    timing.modelFirstToken = undefined;
    timing.fallbackStarted = 500;
    expect(shouldRetryVoiceStart(timing, 4)).toBe(false);
    expect(shouldRetryVoiceStart(timing, 5)).toBe(false);
  });

  it("reports only durations whose lifecycle stages were observed", () => {
    const timing: VoiceTurnTiming = {
      turnId: 2, speechEnd: 100, transcriptFinal: 120, structuredCaptureComplete: 125,
      objectiveSelected: 126, modelRequestStarted: 130, modelFirstToken: 430,
      firstAudioPlayed: 510, modelResponseComplete: 800, ttsComplete: 900,
    };
    expect(voiceLatencySummary(timing, "complete").durationsMs).toMatchObject({
      speech_end_to_transcript_final: 20,
      transcript_final_to_structured_capture_complete: 5,
      objective_selected_to_model_request_started: 4,
      model_request_started_to_first_token: 300,
      first_token_to_first_audio: 80,
      speech_end_to_first_audio: 410,
      speech_end_to_complete_response: 800,
    });
  });
});
