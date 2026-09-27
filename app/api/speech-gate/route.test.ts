import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

const screen = vi.hoisted(() => ({ userInput: vi.fn(), takeQuota: vi.fn(async () => ({ allowed: true, cookie: "test" })) }));
vi.mock("../../../lib/input-screen", () => ({
  screenUserInput: screen.userInput,
  boundaryReply: (decision: string) => `Boundary: ${decision}`,
}));
vi.mock("../../../lib/server", () => ({
  sameOrigin: (request: NextRequest) => request.headers.get("origin") === "http://localhost:3000",
  allowDemoBurst: () => true,
  readJsonLimited: (request: NextRequest) => request.json().catch(() => null),
  takeQuota: screen.takeQuota,
  setQuotaCookie: () => undefined,
}));

function request(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/speech-gate", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("speech gate route", () => {
  beforeEach(() => { screen.userInput.mockReset().mockResolvedValue("allow"); screen.takeQuota.mockClear(); });

  it("approves only a screened transcript", async () => {
    const response = await POST(request({ text: "Help me plan my week" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ allowed: true, reply: "" });
    expect(response.headers.get("server-timing")).toMatch(/app;dur=[\d.]+, model;dur=[\d.]+/);
    expect(screen.userInput).toHaveBeenCalledWith("Help me plan my week");
    expect(screen.takeQuota).toHaveBeenCalledWith(expect.anything(), "chat");
  });

  it("does not charge voice screening against the text chat quota", async () => {
    const response = await POST(request({ text: "Help me plan my week", transport: "voice" }));
    expect(response.status).toBe(200);
    expect(screen.takeQuota).toHaveBeenCalledWith(expect.anything(), "voice");
  });

  it("returns a boundary reply for disallowed speech", async () => {
    screen.userInput.mockResolvedValue("redirect");
    const response = await POST(request({ text: "Tell me how to break into an account" }));
    expect(await response.json()).toEqual({ allowed: false, reply: "Boundary: redirect" });
  });

  it("rejects cross-origin and malformed transcripts", async () => {
    expect((await POST(request({ text: "hello" }, "https://elsewhere.test"))).status).toBe(403);
    expect((await POST(request({ text: " " }))).status).toBe(400);
    expect(screen.userInput).not.toHaveBeenCalled();
  });

});
