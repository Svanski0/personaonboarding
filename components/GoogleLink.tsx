"use client";

import { useEffect, useRef, useState } from "react";
import { Link2Off } from "lucide-react";
import type { Account } from "../lib/onboarding";

type GoogleCredentialResponse = { credential?: string };
type GoogleIdentity = {
  initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void; auto_select: boolean }) => void;
  renderButton: (element: HTMLElement, options: { theme: string; size: string; shape: string; text: string; width: number }) => void;
};
declare global { interface Window { google?: { accounts?: { id?: GoogleIdentity } } } }

type Props = {
  account: Account | null;
  onLinked: (credential: string) => Promise<void>;
  onUnlink: () => Promise<void>;
  onError: (message: string) => void;
  compact?: boolean;
};

export function GoogleLink({ account, onLinked, onUnlink, onError, compact = false }: Props) {
  const target = useRef<HTMLDivElement>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (account) return;
    let disposed = false;
    let script: HTMLScriptElement | null = null;
    fetch("/api/config").then((response) => response.json()).then(({ googleClientId }: { googleClientId?: string }) => {
      if (disposed) return;
      setConfigured(Boolean(googleClientId));
      if (!googleClientId) return;
      const render = () => {
        if (!target.current || !window.google?.accounts?.id) return;
        target.current.replaceChildren();
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          auto_select: false,
          callback: ({ credential }) => {
            if (disposed || busyRef.current) return;
            if (!credential) { onError("Google sign-in was cancelled."); return; }
            busyRef.current = true;
            setBusy(true);
            void onLinked(credential).finally(() => { busyRef.current = false; if (!disposed) setBusy(false); });
          },
        });
        window.google.accounts.id.renderButton(target.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 232 });
      };
      if (window.google?.accounts?.id) render();
      else {
        script = document.createElement("script");
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.onload = render;
        script.onerror = () => { if (!disposed) onError("Google sign-in could not load. Please try again later."); };
        document.head.appendChild(script);
      }
    }).catch(() => { if (!disposed) setConfigured(false); });
    return () => { disposed = true; if (script) script.remove(); };
  }, [account, onError, onLinked]);

  if (account) return (
    <div className="account-linked">
      <span><strong>{account.email}</strong><small>Google identity linked. Gmail access was not requested.</small></span>
      <button type="button" className="plain-icon" onClick={() => void onUnlink()} title="Unlink Google account" aria-label="Unlink Google account"><Link2Off size={17} /></button>
    </div>
  );
  return (
    <div className="google-link">
      <div className="google-signin-slot">
        {configured === false
          ? <span className="quiet-note">Google linking is not configured for this preview.</span>
          : <div ref={target} aria-label="Connect a Google account" />}
      </div>
      <span className="quiet-note google-status" data-visible={busy || undefined} aria-live="polite">{busy ? "Verifying account…" : " "}</span>
      {!compact && <small>Google identity only. Gmail mailbox access is not requested.</small>}
      {compact && <small>Gmail mailbox access is not requested.</small>}
    </div>
  );
}
