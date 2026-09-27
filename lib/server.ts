import { GoogleGenAI } from "@google/genai";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import type { Account } from "./onboarding";

const accountCookie = "persona_account";
const quotaCookie = "persona_demo_quota";

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(value);
}

export function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return new GoogleGenAI({ apiKey });
}

export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
}

export async function readJsonLimited(request: NextRequest, maxBytes = 32_768): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function withServerDeadline<T>(task: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error("SERVER_DEADLINE_EXCEEDED"));
      }, timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    void task.catch(() => undefined);
  }
}

const bursts = new Map<string, { count: number; until: number }>();
export function allowDemoBurst(request: NextRequest, action: string, max: number, windowMs: number): boolean {
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip") || "shared";
  const key = `${action}:${ip}`;
  const now = Date.now();
  if (bursts.size > 2000) {
    for (const [item, entry] of bursts) if (entry.until <= now) bursts.delete(item);
    while (bursts.size > 2000) bursts.delete(bursts.keys().next().value!);
  }
  const current = bursts.get(key);
  if (!current || current.until <= now) { bursts.set(key, { count: 1, until: now + windowMs }); return true; }
  if (current.count >= max) return false;
  current.count += 1;
  return true;
}

export async function accountFromCookie(): Promise<Account | null> {
  try {
    const value = (await cookies()).get(accountCookie)?.value;
    if (!value) return null;
    const { payload } = await jwtVerify(value, secret(), { issuer: "persona-demo", audience: "persona-account" });
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email };
  } catch { return null; }
}

export async function accountCookieValue(account: Account): Promise<string> {
  return new SignJWT({ email: account.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(account.sub)
    .setIssuer("persona-demo")
    .setAudience("persona-account")
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function takeQuota(request: NextRequest, kind: "chat" | "voice"): Promise<{ allowed: boolean; cookie?: string }> {
  if (kind === "voice") return { allowed: true };

  const today = new Date().toISOString().slice(0, 10);
  const prior = request.cookies.get(quotaCookie)?.value;
  let chat = 0;
  if (prior) {
    try {
      const { payload } = await jwtVerify(prior, secret(), { issuer: "persona-demo", audience: "persona-quota" });
      if (payload.day === today) {
        chat = typeof payload.chat === "number" ? payload.chat : 0;
      }
    } catch { /* A new browser or expired quota starts fresh. */ }
  }
  if (kind === "chat" && chat >= 80) return { allowed: false };
  if (kind === "chat") chat += 1;
  const cookie = await new SignJWT({ day: today, chat })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("persona-demo")
    .setAudience("persona-quota")
    .setIssuedAt()
    .setExpirationTime("2d")
    .sign(secret());
  return { allowed: true, cookie };
}

export function setQuotaCookie(response: Response & { cookies: { set: (name: string, value: string, options: typeof cookieOptions) => void } }, value?: string) {
  if (value) response.cookies.set(quotaCookie, value, cookieOptions);
}
