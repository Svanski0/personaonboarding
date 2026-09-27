import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { boundaryReply, screenUserInput } from "../../../lib/input-screen";
import { allowDemoBurst, readJsonLimited, sameOrigin, setQuotaCookie, takeQuota } from "../../../lib/server";

export const runtime = "nodejs";
const moduleInitializedAt = performance.now();

const requestSchema = z.object({ text: z.string().trim().min(1).max(3000), transport: z.enum(["text", "voice"]).default("text") });

export async function POST(request: NextRequest) {
  const requestStarted = performance.now();
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  if (!allowDemoBurst(request, "speech", 60, 60_000)) return NextResponse.json({ error: "Please slow down and try again shortly." }, { status: 429 });
  const parsed = requestSchema.safeParse(await readJsonLimited(request, 8_192));
  if (!parsed.success) return NextResponse.json({ error: "Invalid speech transcript" }, { status: 400 });

  try {
    const quota = await takeQuota(request, parsed.data.transport === "voice" ? "voice" : "chat");
    if (!quota.allowed) return NextResponse.json({ error: "This demo reached its daily conversation limit. Please try tomorrow." }, { status: 429 });
    const modelStarted = performance.now();
    const decision = await screenUserInput(parsed.data.text);
    const modelMs = Math.round(performance.now() - modelStarted);
    const response = NextResponse.json({
      allowed: decision === "allow",
      reply: decision === "allow" ? "" : boundaryReply(decision),
    });
    const handlerMs = Math.round(performance.now() - requestStarted);
    const instanceAgeMs = Math.round(performance.now() - moduleInitializedAt);
    response.headers.set("Server-Timing", `app;dur=${handlerMs}, model;dur=${modelMs}, instance_age;dur=${instanceAgeMs}`);
    console.info(JSON.stringify({ event: "speech_gate_latency", handlerMs, modelMs, instanceAgeMs }));
    setQuotaCookie(response, quota.cookie);
    return response;
  } catch {
    console.warn(JSON.stringify({ event: "speech_gate_failure", handlerMs: Math.round(performance.now() - requestStarted) }));
    return NextResponse.json({ error: "I couldn't check that turn. Please try again or continue by text." }, { status: 503 });
  }
}
