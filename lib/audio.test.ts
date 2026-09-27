import { describe, expect, it } from "vitest";
import { decodePcm16, encodePcm16 } from "./audio";

describe("browser PCM conversion", () => {
  it("downsamples microphone frames to 16 kHz mono PCM", () => {
    const source = new Float32Array(480).fill(0.5);
    const encoded = encodePcm16(source, 48000);
    const output = decodePcm16(encoded);
    expect(output).toHaveLength(160);
    expect(output[0]).toBeCloseTo(0.5, 2);
  });

  it("clips samples before converting to signed 16-bit", () => {
    const output = decodePcm16(encodePcm16(new Float32Array([2, -2]), 16000));
    expect(output[0]).toBeCloseTo(1, 2);
    expect(output[1]).toBe(-1);
  });
});
