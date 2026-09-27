import { Modality } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { allowDemoBurst, gemini, sameOrigin, withServerDeadline } from "../../../lib/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  if (!allowDemoBurst(request, "live-token", 8, 60_000)) return NextResponse.json({ error: "Too many call attempts. Please wait a moment." }, { status: 429 });
  try {
    const token = await withServerDeadline(gemini().authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
        liveConnectConstraints: {
          model: "gemini-3.8-live",
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            realtimeInputConfig: { automaticActivityDetection: { prefixPaddingMs: 100, silenceDurationMs: 800 } },
            sessionResumption: {},
          },
        },
      },
    }), 10_000);
    return NextResponse.json({ token: token.name }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("GEMINI_API_KEY") || message.includes("SESSION_SECRET")) {
      return NextResponse.json({ error: "Voice is not configured yet. Continue by text." }, { status: 503 });
    }
    return NextResponse.json({ error: "The call could not connect. Continue by text or retry." }, { status: 503 });
  }
}
