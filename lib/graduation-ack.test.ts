import { describe, expect, it, vi } from "vitest";
import { shouldCompleteGraduationAudio } from "./graduation-ack";
import { shouldEmitAssistantOutputComplete } from "./voice-action";

describe("graduation acknowledgement playback identity", () => {
  it("ignores the Google offer ending while the final acknowledgement is queued", () => {
    expect(shouldCompleteGraduationAudio(true, true, false, "call:2", "call:1")).toBe(false);
    expect(shouldCompleteGraduationAudio(true, true, false, "call:2", "call:2")).toBe(true);
  });

  it("never graduates from TTS generation alone or before playback ends", () => {
    expect(shouldCompleteGraduationAudio(true, true, false, "call:2", null)).toBe(false);
    expect(shouldCompleteGraduationAudio(true, true, false, "call:2", "call:1")).toBe(false);
  });

  it("keeps onboarding active for a five-second audio buffer after generation completes", async () => {
    vi.useFakeTimers();
    try {
      let pendingAudioChunks = 1;
      let graduated = false;
      setTimeout(() => { pendingAudioChunks = 0; }, 5000);
      const maybeGraduate = () => {
        if (shouldEmitAssistantOutputComplete(true, pendingAudioChunks, graduated)
          && shouldCompleteGraduationAudio(true, true, graduated, "call:2", "call:2")) graduated = true;
      };
      maybeGraduate();
      await vi.advanceTimersByTimeAsync(4999);
      maybeGraduate();
      expect(graduated).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      maybeGraduate();
      expect(graduated).toBe(true);
      maybeGraduate();
      expect(graduated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores duplicate completion and an acknowledgement from an earlier call", () => {
    expect(shouldCompleteGraduationAudio(true, true, true, "call:2", "call:2")).toBe(false);
    expect(shouldCompleteGraduationAudio(true, true, false, "new-call:1", "old-call:1")).toBe(false);
  });

  it("cannot complete an acknowledgement that has not started", () => {
    expect(shouldCompleteGraduationAudio(false, true, false, "call:2", "call:2")).toBe(false);
    expect(shouldCompleteGraduationAudio(true, false, false, "call:2", "call:2")).toBe(false);
  });
});
