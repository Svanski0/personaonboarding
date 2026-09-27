import { expect, it } from "vitest";
import { redactDebugValue } from "./debug-log";

it("redacts credential fields and token-shaped strings from debug exports", () => {
  const value = redactDebugValue({ credential: "secret", nested: { accessToken: "secret" }, text: "Bearer example123 code=abc" });
  expect(JSON.stringify(value)).not.toContain("example123");
  expect(JSON.stringify(value)).not.toContain("secret");
  expect(JSON.stringify(value)).not.toContain("code=abc");
});
