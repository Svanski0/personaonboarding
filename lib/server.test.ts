import { expect, it } from "vitest";
import { NextRequest } from "next/server";
import { allowDemoBurst, readJsonLimited, sameOrigin, withServerDeadline } from "./server";

it("rejects oversized JSON and a same-host origin with a different scheme", async () => {
  const request = new NextRequest("https://persona.example/api/conversation", { method: "POST", headers: { origin: "http://persona.example" }, body: JSON.stringify({ text: "x".repeat(100) }) });
  expect(sameOrigin(request)).toBe(false);
  expect(await readJsonLimited(request, 32)).toBeNull();
});

it("bounds repeated public token issuance within an instance", () => {
  const request = new NextRequest("https://persona.example/api/live-token", { headers: { "x-vercel-forwarded-for": `test-${crypto.randomUUID()}` } });
  expect(allowDemoBurst(request, "test-token", 2, 60_000)).toBe(true);
  expect(allowDemoBurst(request, "test-token", 2, 60_000)).toBe(true);
  expect(allowDemoBurst(request, "test-token", 2, 60_000)).toBe(false);
});

it("settles a provider request that never resolves", async () => {
  await expect(withServerDeadline(new Promise<never>(() => undefined), 10)).rejects.toThrow("SERVER_DEADLINE_EXCEEDED");
});
