import { OAuth2Client } from "google-auth-library";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { accountCookieValue, accountFromCookie, allowDemoBurst, cookieOptions, readJsonLimited, sameOrigin, withServerDeadline } from "../../../lib/server";

export const runtime = "nodejs";

const linkSchema = z.object({ credential: z.string().min(100).max(10000) });

export async function GET() {
  return NextResponse.json({ account: await accountFromCookie() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  if (!allowDemoBurst(request, "google", 12, 60_000)) return NextResponse.json({ error: "Too many sign-in attempts. Please try again shortly." }, { status: 429 });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "Google linking is not configured yet." }, { status: 503 });
  const parsed = linkSchema.safeParse(await readJsonLimited(request, 12_000));
  if (!parsed.success) return NextResponse.json({ error: "Invalid sign-in response" }, { status: 400 });
  try {
    const ticket = await withServerDeadline(new OAuth2Client(clientId).verifyIdToken({ idToken: parsed.data.credential, audience: clientId }), 8_000);
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      return NextResponse.json({ error: "Google could not verify this account." }, { status: 400 });
    }
    if (!payload.email.toLowerCase().endsWith("@gmail.com") && !payload.hd) {
      return NextResponse.json({ error: "Use a Gmail or Google Workspace account for this demo." }, { status: 400 });
    }
    const account = { sub: payload.sub, email: payload.email };
    const response = NextResponse.json({ account }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("persona_account", await accountCookieValue(account), { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });
    return response;
  } catch {
    return NextResponse.json({ error: "Google sign-in could not be verified. Please try again." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  const response = NextResponse.json({ account: null });
  response.cookies.set("persona_account", "", { ...cookieOptions, maxAge: 0 });
  return response;
}
