import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("google-auth-library", () => ({ OAuth2Client: class { verifyIdToken = mocks.verifyIdToken; } }));
vi.mock("../../../lib/server", () => ({
  sameOrigin: (request: NextRequest) => request.headers.get("origin") === "http://localhost:3000",
  allowDemoBurst: () => true,
  readJsonLimited: (request: NextRequest) => request.json().catch(() => null),
  withServerDeadline: (task: Promise<unknown>) => task,
  accountFromCookie: async () => null,
  accountCookieValue: async () => "signed-session",
  cookieOptions: { httpOnly: true, secure: false, sameSite: "lax", path: "/" },
}));

function request(method: "POST" | "DELETE", credential = "x".repeat(150)) {
  return new NextRequest("http://localhost:3000/api/google", { method, headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: method === "POST" ? JSON.stringify({ credential }) : undefined });
}

describe("Google link boundary", () => {
  beforeEach(() => { process.env.GOOGLE_CLIENT_ID = "demo-client"; mocks.verifyIdToken.mockReset(); });

  it("starts unlinked and never accepts an arbitrary credential", async () => {
    expect((await GET()).status).toBe(200);
    mocks.verifyIdToken.mockRejectedValue(new Error("bad signature"));
    expect((await POST(request("POST"))).status).toBe(400);
  });

  it("accepts a verified Gmail identity", async () => {
    mocks.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-123", email: "sam@gmail.com", email_verified: true }) });
    const response = await POST(request("POST"));
    expect(response.status).toBe(200);
    expect((await response.json()).account.email).toBe("sam@gmail.com");
    expect(response.cookies.get("persona_account")?.value).toBe("signed-session");
  });

  it("rejects unverified and third-party email accounts", async () => {
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ sub: "a", email: "sam@gmail.com", email_verified: false }) });
    expect((await POST(request("POST"))).status).toBe(400);
    mocks.verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ sub: "a", email: "sam@example.com", email_verified: true }) });
    expect((await POST(request("POST"))).status).toBe(400);
  });

  it("unlinks by expiring the session cookie", async () => {
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(200);
    expect(response.cookies.get("persona_account")?.value).toBe("");
  });
});
