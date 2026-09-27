"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Check, CircleHelp, Settings2, X } from "lucide-react";
import { CallControls } from "./CallControls";
import { GoogleLink } from "./GoogleLink";
import { PersonaRing } from "./PersonaRing";
import { PersonaWordmark } from "./PersonaWordmark";
import type { Account, OnboardingState } from "../lib/onboarding";

type Props = {
  state: OnboardingState;
  account: Account | null;
  googlePromptOpen: boolean;
  ringSignal: number;
  uiCue: { id: number; type: "name" | "focus" | "google" | "resume" | "success"; label: string } | null;
  pending: boolean;
  error: string;
  voiceDraft: {
    role: "user" | "assistant";
    text: string;
    timing: { startAt: number | null; endAt: number | null } | null;
  } | null;
  onAssistantTextVisible: (text: string, afterTranscript?: boolean) => void;
  onSend: (message: string) => Promise<boolean>;
  onStart: () => void;
  onEnd: (reason?: "user_hangup" | "switch_to_text" | "oauth_action") => void;
  onMute: () => void;
  onGraduate: () => void;
  onRequestGoogle: () => void;
  onEdit: (field: "agentName" | "userName" | "helpNeed", value: string) => void;
  onLink: (credential: string) => Promise<void>;
  onUnlink: () => Promise<void>;
  onDeferGooglePrompt: () => void;
  onCloseGooglePrompt: () => void;
  onError: (message: string) => void;
  onReset: () => void;
};

const statusText = {
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  action_waiting: "Waiting for your choice",
  ended: "Call ended",
  error: "Call interrupted",
};

function VoiceTypewriter({ text, timing, onVisibleText }: { text: string; timing: { startAt: number | null; endAt: number | null } | null; onVisibleText?: (text: string) => void }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const fallbackStart = useRef<number | null>(null);
  const previousText = useRef("");

  useEffect(() => {
    if (!text) {
      fallbackStart.current = null;
      previousText.current = "";
      setVisibleCount(0);
      return;
    }

    const now = performance.now();
    const revised = !text.startsWith(previousText.current) && !previousText.current.startsWith(text);
    let stablePrefix = 0;
    if (revised) {
      const max = Math.min(text.length, previousText.current.length);
      while (stablePrefix < max && text[stablePrefix] === previousText.current[stablePrefix]) stablePrefix += 1;
      setVisibleCount(stablePrefix);
      fallbackStart.current = now;
    }
    previousText.current = text;
    const audioStart = timing?.startAt;
    const audioEnd = timing?.endAt;
    const audioDuration = audioStart != null && audioEnd != null && audioEnd > audioStart ? audioEnd - audioStart : null;
    const startedAt = revised ? (fallbackStart.current ?? now) : audioDuration !== null ? audioStart! : (fallbackStart.current ?? now);
    if (audioDuration === null && fallbackStart.current === null) fallbackStart.current = startedAt;
    const duration = revised
      ? Math.max(180, (text.length - stablePrefix) * 34)
      : audioDuration ?? Math.max(240, text.length * 48);
    let frame = 0;
    const animate = (time: number) => {
      const progress = Math.max(0, Math.min(1, (time - startedAt) / duration));
      const count = Math.ceil(text.length * progress);
      setVisibleCount((current) => Math.max(current, count));
      if (count < text.length) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [text, timing?.startAt, timing?.endAt]);

  useEffect(() => {
    onVisibleText?.(text.slice(0, visibleCount));
  }, [onVisibleText, text, visibleCount]);

  return <>{text.slice(0, visibleCount)}</>;
}

export function CallScreen({ state, account, googlePromptOpen, ringSignal, uiCue, pending, error, voiceDraft, onAssistantTextVisible, onSend, onStart, onEnd, onMute, onGraduate, onRequestGoogle, onEdit, onLink, onUnlink, onDeferGooglePrompt, onCloseGooglePrompt, onError, onReset }: Props) {
  const [draft, setDraft] = useState("");
  const [textOpen, setTextOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const dialogCloseRef = useRef<HTMLButtonElement>(null);
  const assistant = state.step === "assistant";
  const activeCall = ["connecting", "listening", "thinking", "speaking", "action_waiting"].includes(state.callState);
  const assistantThinking = pending || state.callState === "thinking";
  const latestUser = [...state.turns].reverse().find((turn) => turn.role === "user");
  const latestAssistant = [...state.turns].reverse().find((turn) => turn.role === "assistant");
  const liveUserText = voiceDraft?.role === "user" ? voiceDraft.text : "";
  const liveAssistantText = voiceDraft?.role === "assistant" ? voiceDraft.text : "";
  const liveAssistantTiming = voiceDraft?.role === "assistant" ? voiceDraft.timing : null;
  useEffect(() => {
    if (latestAssistant?.source === "text") onAssistantTextVisible(latestAssistant.text, true);
  }, [latestAssistant?.id, latestAssistant?.source, latestAssistant?.text, onAssistantTextVisible]);
  useEffect(() => {
    if (!detailsOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogCloseRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailsOpen(false); };
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("keydown", dismiss); previousFocus?.focus(); };
  }, [detailsOpen]);

  function openDetails() {
    if (activeCall) onEnd("user_hangup");
    setDetailsOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || pending) return;
    const sent = await onSend(message);
    if (sent) setDraft("");
  }

  return (
    <section className={`experience-screen${assistant ? " experience-screen--assistant" : ""}`} aria-label={assistant ? "Persona assistant" : "Persona onboarding conversation"}>
      <header className="page-header experience-header">
        <div className="wordmark-link"><PersonaWordmark /></div>
        <div className="header-actions">
          <button className="plain-icon" type="button" onClick={openDetails} aria-label="Review your details" title="Review your details"><Settings2 size={19} /></button>
        </div>
      </header>

      <main className="experience-main">
        {!assistant && (
          <div className="voice-stage">
            {(latestAssistant || liveAssistantText || assistantThinking) && <div className="voice-message-bubble voice-message-bubble--assistant" role="log" aria-live="polite">{liveAssistantText ? <VoiceTypewriter text={liveAssistantText} timing={liveAssistantTiming} onVisibleText={onAssistantTextVisible} /> : assistantThinking ? "Thinking…" : latestAssistant?.text}</div>}
            <div className="conversation-intro">
              <PersonaRing state={state.callState} topic={state.topic} dimmed={state.callState === "ended"} signal={ringSignal} reaction={uiCue?.type === "success" ? "success" : uiCue?.type === "google" ? "action-required" : uiCue?.type === "name" || uiCue?.type === "focus" ? "captured-info" : undefined} />
              <h1>{state.agentName}</h1>
              <p className="conversation-status" aria-live="polite">{state.callState === "ready" ? " " : statusText[state.callState]}</p>
            </div>
            <div className="onboarding-cue-slot" aria-live="polite">{uiCue && <div key={uiCue.id} className={`onboarding-cue onboarding-cue--${uiCue.type}`}>{uiCue.type === "focus" && <span>FOCUS</span>}{uiCue.label.replace(/^FOCUS · /, "")}</div>}</div>
            {(latestUser || liveUserText) && <div className="transcript voice-latest-user" role="log" aria-label="Latest transcript" aria-live="polite"><div className="transcript-turn transcript-turn--user"><span>You</span><p>{liveUserText || latestUser?.text}</p></div></div>}
          </div>
        )}
        {assistant && (
          <div className="assistant-heading">
            <h1>What should we work on?</h1>
            {state.userName && <p className="assistant-context-name">For {state.userName}</p>}
            <p><span className="assistant-focus-label">Focus · </span>{state.helpNeed}</p>
            <div className="assistant-context" aria-label="Your Persona context">
              <span>Google · {account ? account.email : "Not connected"}</span>
              {!account && <button className="reset-link" type="button" onClick={onRequestGoogle}>Connect Google</button>}
            </div>
          </div>
        )}
        {assistant && state.turns.length > 0 && (
          <div className="transcript" role="log" aria-label="Latest conversation turns" aria-live="polite">
            {[latestUser, latestAssistant].filter((turn): turn is NonNullable<typeof turn> => Boolean(turn)).sort((a, b) => a.at - b.at).map((turn) => <div className={`transcript-turn transcript-turn--${turn.role}`} key={turn.id}>
              <span>{turn.role === "assistant" ? state.agentName : "You"}</span>
              <p>{turn.text}</p>
            </div>)}
            {pending && <div className="transcript-turn transcript-turn--assistant"><span>{state.agentName}</span><p>Thinking…</p></div>}
          </div>
        )}
        {!assistant && state.helpNeed && state.statuses.helpNeed === "confirmed" && (
          <div className="graduation">
            <button className="primary-button" type="button" onClick={onGraduate}>Enter Persona <ArrowUp size={17} className="arrow-forward" /></button>
            {state.statuses.google === "attempted" && !googlePromptOpen && <button className="reset-link" type="button" onClick={onRequestGoogle}>Connect Google</button>}
          </div>
        )}
      </main>

      <footer className="experience-footer">
        {error && <div className="experience-error" role="alert">{error}<button type="button" aria-label="Dismiss error" onClick={() => onError("")}><X size={15} /></button></div>}
        {!assistant && (
          <div className="voice-action">
            <CallControls state={state.callState} muted={state.muted} onStart={() => { setTextOpen(false); onStart(); }} onMute={onMute} onEnd={onEnd} />
            {!textOpen && <button className="type-control" type="button" onClick={() => { if (activeCall) onEnd("switch_to_text"); setTextOpen(true); setTimeout(() => composerRef.current?.focus(), 0); }}>Type instead</button>}
          </div>
        )}
        {(textOpen || assistant) && (
          <form className="chat-composer" onSubmit={submit}>
            <textarea ref={composerRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(event); } }} rows={1} maxLength={3000} placeholder={assistant ? `Ask ${state.agentName} anything…` : "Say what’s on your mind…"} aria-label="Message to Persona" />
            <button type="submit" disabled={!draft.trim() || pending} aria-label="Send message" title="Send message"><ArrowUp size={19} /></button>
          </form>
        )}
        <p className="privacy-note"><CircleHelp size={13} /> Demo · Use test details. Gemini may use inputs to improve its products.</p>
      </footer>

      {detailsOpen && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
        <div className="details-dialog" role="dialog" aria-modal="true" aria-labelledby="details-title">
          <header><div><h2 id="details-title">Your details</h2></div><button ref={dialogCloseRef} className="plain-icon" type="button" onClick={() => setDetailsOpen(false)} aria-label="Close details"><X size={20} /></button></header>
          <label>Agent name<input value={state.agentName} maxLength={32} onChange={(event) => onEdit("agentName", event.target.value)} /></label>
          <label>Your name<input value={state.userName} maxLength={80} placeholder="Not shared yet" onChange={(event) => onEdit("userName", event.target.value)} /></label>
          <label>What you want help with<textarea value={state.helpNeed} maxLength={500} rows={3} placeholder="Not shared yet" onChange={(event) => onEdit("helpNeed", event.target.value)} /></label>
          <div className="details-account"><div className="details-label">Google account {account && <Check size={15} />}</div><GoogleLink account={account} onLinked={onLink} onUnlink={onUnlink} onError={onError} /></div>
          <button className="reset-link" type="button" onClick={() => { if (window.confirm("Start this demo over and erase this browser's conversation?")) { onReset(); setDetailsOpen(false); } }}>Reset this demo</button>
        </div>
      </div>}

      {googlePromptOpen && !account && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCloseGooglePrompt(); }}>
        <div className="details-dialog google-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="google-prompt-title">
          <header><h2 id="google-prompt-title">Connect Google</h2><button className="plain-icon" type="button" onClick={onCloseGooglePrompt} aria-label="Close Google dialog"><X size={20} /></button></header>
          <p className="google-prompt-copy">Link your Google identity to {state.agentName}. This demo does not request Gmail mailbox access.</p>
          <GoogleLink account={account} onLinked={onLink} onUnlink={onUnlink} onError={onError} compact />
          <button className="reset-link" type="button" onClick={onDeferGooglePrompt}>Not now</button>
        </div>
      </div>}
    </section>
  );
}
