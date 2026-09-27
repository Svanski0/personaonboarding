import { describe, expect, it } from "vitest";
import { finalizedSpeechTranscript, mergeTranscript } from "./transcript";

describe("voice transcript chunk merging", () => {
  it("keeps cumulative transcription updates intact", () => {
    expect(mergeTranscript("Hi, I'm Halo.", "Hi, I'm Halo. What name should I use for you?"))
      .toBe("Hi, I'm Halo. What name should I use for you?");
  });

  it("inserts missing spaces between delta chunks", () => {
    expect(mergeTranscript("Hi, I'm Halo.", "What name should I"))
      .toBe("Hi, I'm Halo. What name should I");
    expect(mergeTranscript("What name should I", "use for you?"))
      .toBe("What name should I use for you?");
  });

  it("does not duplicate overlapping chunks or existing whitespace", () => {
    expect(mergeTranscript("Hello there", "there, friend"))
      .toBe("Hello there, friend");
    expect(mergeTranscript("Hello ", "there"))
      .toBe("Hello there");
  });

  it("keeps all finalized speech fragments when only a later result changes", () => {
    const results = [
      { isFinal: true, 0: { transcript: "My name is" } },
      { isFinal: true, 0: { transcript: "Luca" } },
      { isFinal: false, 0: { transcript: "and" } },
    ];
    expect(finalizedSpeechTranscript(results)).toBe("My name is Luca");
  });
});
