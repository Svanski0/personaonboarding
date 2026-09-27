import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingLevel } from "@google/genai";
import { NextRequest } from "next/server";
import { POST } from "./route";

const quota = vi.hoisted(() => ({ take: vi.fn(async () => ({ allowed: true, cookie: "test" })) }));
const generateContent = vi.fn();
vi.mock("../../../lib/input-screen", () => ({
  boundaryReply: () => "I can't help with that request.",
}));
vi.mock("../../../lib/server", () => ({
  sameOrigin: (request: NextRequest) => request.headers.get("origin") === "http://localhost:3000",
  allowDemoBurst: () => true,
  readJsonLimited: (request: NextRequest) => request.json().catch(() => null),
  takeQuota: quota.take,
  setQuotaCookie: () => undefined,
  accountFromCookie: async () => null,
  gemini: () => ({ models: { generateContent } }),
}));

function request(body: unknown, origin = "http://localhost:3000") {
  return new NextRequest("http://localhost:3000/api/conversation", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
}

const body = { mode: "reply", message: "I am Sam and need help planning my week", profile: { agentName: "Nova", userName: "", helpNeed: "", statuses: { userName: "missing", helpNeed: "missing", google: "missing" }, step: "conversation" }, turns: [] };

describe("conversation route", () => {
  beforeEach(() => {
    generateContent.mockReset();
    quota.take.mockClear();
  });

  it("rejects cross-origin and malformed input", async () => {
    expect((await POST(request(body, "https://elsewhere.test"))).status).toBe(403);
    expect((await POST(request({ ...body, message: "" }))).status).toBe(400);
  });

  it("returns a structured conversational update", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "Let's start with three priorities for this week. What deadlines matter most?", userName: "Sam", helpNeed: "Plan my week", clearUserName: false, clearHelpNeed: false, attempted: ["userName"], deferred: [], topic: "work", openGoogleLink: false }) });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect((await response.json()).userName).toBe("Sam");
    expect(generateContent.mock.calls[0][0].contents).toContain('"gmailLinked":false');
    expect(generateContent.mock.calls[0][0].config.temperature).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(generateContent.mock.calls[0][0].config.httpOptions).toBeUndefined();
    expect(generateContent.mock.calls[0][0].config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("does not charge voice reply preparation against the text chat quota", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "Got it.", userName: "", helpNeed: "", clearUserName: false, clearHelpNeed: false, attempted: [], deferred: [], topic: "personal", openGoogleLink: false }) });
    const response = await POST(request({ ...body, transport: "voice" }));
    expect(response.status).toBe(200);
    expect(quota.take).toHaveBeenCalledWith(expect.anything(), "voice");
  });

  it("ignores a browser claim that Gmail is linked", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "Hello", userName: "", helpNeed: "", clearUserName: false, clearHelpNeed: false, attempted: [], deferred: [], topic: "personal", openGoogleLink: false }) });
    await POST(request({ ...body, profile: { ...body.profile, statuses: { ...body.profile.statuses, google: "confirmed" } } }));
    expect(generateContent.mock.calls[0][0].contents).toContain('"gmailLinked":false');
  });

  it("uses a deterministic continuation for malformed model output", async () => {
    generateContent.mockResolvedValue({ text: "not json" });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect((await response.json()).diagnostic).toBe("SERVER_ERROR");
  });

  it("returns captured facts and an advanced objective when Gemini is unavailable", async () => {
    const error = Object.assign(new Error("upstream unavailable"), { status: 503 });
    generateContent.mockRejectedValue(error);
    const response = await POST(request({
      ...body,
      message: "I've been having a lot of school work and SAT stuff",
      profile: { ...body.profile, userName: "Luca" },
      turns: [{ role: "assistant", text: "What name should I use?" }, { role: "user", text: "You can call me Luca" }],
    }));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.helpNeed).toBe("Schoolwork and SAT prep");
    expect(result.openGoogleLink).toBe(true);
    expect(result.reply).toContain("connect Google");
    expect(result.reply).not.toContain("taking the most time or energy");
    expect(result.diagnostic).toBe("PROVIDER_UNAVAILABLE");
    expect(result.diagnosticReason).toBe("UPSTREAM_ERROR");
  });

  it("keeps READY_TO_GRADUATE deterministic instead of sending it back to Gemini", async () => {
    const response = await POST(request({
      ...body,
      message: "Nah, not right now",
      profile: {
        ...body.profile,
        userName: "Luca",
        helpNeed: "SAT prep",
        statuses: { userName: "confirmed", helpNeed: "confirmed", google: "deferred" },
      },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toContain("You're all set, Luca");
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("allows one concise response when someone explicitly asks to keep talking", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({
      decision: "allow", reply: "Sure, we can take one more minute. Keep it focused on your SAT prep.",
      userName: "", helpNeed: "", clearUserName: false, clearHelpNeed: false,
      attempted: [], deferred: [], topic: "work", openGoogleLink: false,
    }) });
    const response = await POST(request({
      ...body,
      message: "Not right now, but I have one more thing",
      profile: {
        ...body.profile, userName: "Luca", helpNeed: "SAT prep",
        statuses: { userName: "confirmed", helpNeed: "confirmed", google: "deferred" },
      },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toContain("one more minute");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("enforces the model's safety classification before returning a reply", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "refuse", reply: "unsafe model text", userName: "Wrong", helpNeed: "Wrong", clearUserName: false, clearHelpNeed: false, attempted: [], deferred: [], topic: "personal", openGoogleLink: false }) });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect((await response.json()).reply).toBe("I can't help with that request.");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("waits until after useful help and both details before offering Google", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "I can help you make a short plan. Want to verify your Google account? It will not access your inbox.", userName: "", helpNeed: "", clearUserName: false, clearHelpNeed: false, attempted: ["google"], deferred: [], topic: "work", openGoogleLink: true }) });
    const response = await POST(request({
      ...body,
      message: "Can you sort these priorities?",
      profile: { ...body.profile, userName: "Sam", helpNeed: "Plan my week" },
      turns: [{ role: "user", text: "I'm Sam" }, { role: "assistant", text: "What do you want help with?" }],
    }));
    const result = await response.json();
    expect(result.openGoogleLink).toBe(true);
    expect(result.attempted).toContain("google");

    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "I can help you plan that.", userName: "", helpNeed: "Plan my week", clearUserName: false, clearHelpNeed: false, attempted: ["google"], deferred: [], topic: "work", openGoogleLink: true }) });
    const firstTurn = await POST(request(body));
    const firstTurnResult = await firstTurn.json();
    expect(firstTurnResult.openGoogleLink).toBe(false);
    expect(firstTurnResult.attempted).not.toContain("google");

    generateContent.mockResolvedValue({ text: JSON.stringify({ decision: "allow", reply: "Want to link Google?", userName: "", helpNeed: "", clearUserName: false, clearHelpNeed: false, attempted: [], deferred: [], topic: "personal", openGoogleLink: true }) });
    const early = await POST(request({ ...body, profile: { ...body.profile, statuses: { ...body.profile.statuses, google: "attempted" } } }));
    expect((await early.json()).openGoogleLink).toBe(false);
  });
});
