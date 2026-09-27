import { expect, it } from "vitest";
import { transitionDeadline } from "./particle-transition";

it("bounds a stalled visual capture so setup can fall back", async () => {
  await expect(transitionDeadline(new Promise<never>(() => undefined), 10)).rejects.toThrow("timed out");
  await expect(transitionDeadline(Promise.resolve("ready"), 10)).resolves.toBe("ready");
});
