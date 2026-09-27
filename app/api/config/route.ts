import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ googleClientId: process.env.GOOGLE_CLIENT_ID ?? "" });
}
