"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { CallScreen } from "./CallScreen";
import { OnboardingSetup } from "./OnboardingSetup";
import { useVoiceCall } from "./useVoiceCall";
import { ambiguousOnboardingReply, canGraduate, deterministicOnboardingReply, extractUserFacts, getNextObjective, initialOnboardingState, isExplicitContinuationRequest, isPersonaProductQuestion, isRepetitionComplaint, nameFromTurns, onboardingReducer, restoreOnboarding, supportedModelHelpNeed, supportedModelUserName, type Account, type Observation, type OnboardingAction, type OnboardingState, type Turn } from "../lib/onboarding";
import { fastVoiceReply, isFastVoiceTransition, resolveWithin, type VoiceTurnTiming } from "../lib/voice-latency";
import { redactDebugValue } from "../lib/debug-log";
import { shouldSurfaceVoiceFailure } from "../lib/voice-action";
import { shouldCompleteGraduationAudio } from "../lib/graduation-ack";

const storageKey = "persona-onboarding-v1";
const debugStorageKey = "persona-onboarding-debug-v1";

function createRunId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function turn(role: Turn["role"], text: string, source: Turn["source"]): Turn {
  return { id: crypto.randomUUID(), role, text, source, at: Date.now() };
}

type AgentResult = { reply: string; userName: string; helpNeed: string; clearUserName: boolean; clearHelpNeed: boolean; attempted: Observation["attempted"]; deferred: Observation["deferred"]; topic: Observation["topic"]; openGoogleLink: boolean; diagnostic?: string; diagnosticReason?: string };
type VoiceReplyPayload = { response: Response; result: AgentResult & { error?: string } };
type PreparedReplyResult = { value: VoiceReplyPayload; timedOut: false } | { timedOut: true } | { error: unknown };
type PreparedVoiceReply = { text: string; turnId: number; controller: AbortController; startedAt: number; result: Promise<PreparedReplyResult> };
type DebugEvent = { at: string; sessionId: string; onboardingRunId: string; type: string; detail?: Record<string, unknown> };
type UiCue = { id: number; type: "name" | "focus" | "google" | "resume" | "success"; label: string };
type GraduationReason = "resolved" | "explicit_early";

function httpFailureCategory(status?: number, cause?: unknown): string {
  if (cause instanceof Error && cause.name === "AbortError") return "TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMIT";
  if (status === 401 || status === 403) return "PROVIDER_AUTH";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 400) return "REQUEST_INVALID";
  if (status && status >= 500) return "PROVIDER_UNAVAILABLE";
  return "SERVER_ERROR";
}

function prepareVoiceReply(text: string, turnId: number, profile: OnboardingState, timing: VoiceTurnTiming): PreparedVoiceReply {
  const controller = new AbortController();
  const startedAt = performance.now();
  timing.replyPreparationStarted = startedAt;
  const request = (async () => {
    const response = await fetch("/api/conversation", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ mode: "reply", transport: "voice", message: text, profile, turns: profile.turns.slice(-12) }),
    });
    const result: AgentResult & { error?: string } = await response.json();
    return { response, result };
  })();
  const result: Promise<PreparedReplyResult> = resolveWithin(request, 1200, () => {
    timing.replyPreparationComplete = performance.now();
    controller.abort();
  }).then((value) => {
    timing.replyPreparationComplete ??= performance.now();
    return value;
  }, (error: unknown) => {
    timing.replyPreparationComplete = performance.now();
    return { error };
  });
  return { text, turnId, controller, startedAt, result };
}

export function OnboardingExperience() {
  const [state, dispatch] = useReducer(onboardingReducer, initialOnboardingState);
  const stateRef = useRef<OnboardingState>(initialOnboardingState);
  const mountedRef = useRef(true);
  const [hydrated, setHydrated] = useState(false);
  const hydrationStartedRef = useRef(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [googlePromptOpen, setGooglePromptOpen] = useState(false);
  const googlePromptShown = useRef(false);
  const actionWaitingRef = useRef(false);
  const actionWaitPendingRef = useRef(false);
  const setVoiceActionWaitingRef = useRef<(waiting: boolean) => void>(() => undefined);
  const continueVoiceRef = useRef<(reply: string) => string | null>(() => null);
  const currentVoiceResponseIdRef = useRef<() => string | null>(() => null);
  const voiceAudioPlayingRef = useRef<() => boolean>(() => false);
  const [ringSignal, setRingSignal] = useState(0);
  const [uiCue, setUiCue] = useState<UiCue | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<{
    role: "user" | "assistant";
    text: string;
    timing: { startAt: number | null; endAt: number | null } | null;
  } | null>(null);
  const debugEventsRef = useRef<DebugEvent[]>([]);
  const sessionIdRef = useRef(createRunId());
  const onboardingRunIdRef = useRef(createRunId());
  const requestEpoch = useRef(0);
  const profileRevisionRef = useRef(0);
  const textPendingRef = useRef(false);
  const textAbortRef = useRef<AbortController | null>(null);
  const linkPromiseRef = useRef<Promise<void> | null>(null);
  const graduationAfterVoiceRef = useRef(false);
  const graduationAckTimerRef = useRef<number | null>(null);
  const graduationVoiceDeadlineRef = useRef<number | null>(null);
  const graduationVoiceTextSeenRef = useRef(false);
  const graduationResponseIdRef = useRef<string | null>(null);
  const graduationAckCompleteRef = useRef(false);
  const finishGraduationAckRef = useRef<(runId: string, transport: "voice" | "text", reason?: string) => void>(() => undefined);
  const recoverGraduationAckRef = useRef<(reason: string) => void>(() => undefined);
  const cueTimerRef = useRef<number | null>(null);
  const graduationAckStartedRef = useRef(false);
  const googleResolutionRef = useRef(false);
  const preparedVoiceCaptureRef = useRef<{ text: string; observation: Observation; cueShown: boolean; revision: number } | null>(null);
  const preparedVoiceReplyRef = useRef<PreparedVoiceReply | null>(null);
  const completeOnboardingRef = useRef<(message?: string, reason?: GraduationReason) => void>(() => undefined);

  const appendDebug = useCallback((type: string, detail?: Record<string, unknown>) => {
    const previous = debugEventsRef.current.at(-1);
    if (type === "state_action:call-state" && previous?.type === type && previous.detail?.value === detail?.value) return;
    debugEventsRef.current = [...debugEventsRef.current.slice(-499), { at: new Date().toISOString(), sessionId: sessionIdRef.current, onboardingRunId: onboardingRunIdRef.current, type, ...(detail ? { detail: redactDebugValue(detail) as Record<string, unknown> } : {}) }];
    try { localStorage.setItem(debugStorageKey, JSON.stringify({ sessionId: sessionIdRef.current, onboardingRunId: onboardingRunIdRef.current, events: debugEventsRef.current })); }
    catch { /* Diagnostics stay in memory if storage is unavailable. */ }
  }, []);

  const scheduleGraduationAckComplete = useCallback((transport: "voice" | "text") => {
    if (graduationAckTimerRef.current !== null) window.clearTimeout(graduationAckTimerRef.current);
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    graduationVoiceDeadlineRef.current = null;
    const runId = onboardingRunIdRef.current;
    graduationAckTimerRef.current = window.setTimeout(() => {
      graduationAckTimerRef.current = null;
      if (onboardingRunIdRef.current !== runId) return;
      finishGraduationAckRef.current(runId, transport);
    }, 900);
  }, []);

  const startGraduationAck = useCallback((transport: "voice" | "text" | "voice-or-text", reason: string) => {
    if (graduationAckStartedRef.current || stateRef.current.step === "assistant") return false;
    graduationAckStartedRef.current = true;
    graduationAckCompleteRef.current = false;
    graduationVoiceTextSeenRef.current = false;
    graduationResponseIdRef.current = transport === "voice" ? currentVoiceResponseIdRef.current() : null;
    if (transport !== "text") {
      const runId = onboardingRunIdRef.current;
      let playbackWasActive = false;
      const checkDeadline = () => {
        graduationVoiceDeadlineRef.current = null;
        if (onboardingRunIdRef.current !== runId || graduationAckCompleteRef.current) return;
        if (voiceAudioPlayingRef.current()) {
          playbackWasActive = true;
          graduationVoiceDeadlineRef.current = window.setTimeout(checkDeadline, 500);
          return;
        }
        if (playbackWasActive) {
          playbackWasActive = false;
          graduationVoiceDeadlineRef.current = window.setTimeout(checkDeadline, 5000);
          return;
        }
        recoverGraduationAckRef.current("voice_ack_timeout");
      };
      graduationVoiceDeadlineRef.current = window.setTimeout(checkDeadline, 15000);
    }
    appendDebug("ui_event", { name: "GRADUATION_ACK_STARTED", transport, reason });
    return true;
  }, [appendDebug]);

  const showCue = useCallback((type: UiCue["type"], label: string) => {
    const id = Date.now();
    setUiCue({ id, type, label });
    if (cueTimerRef.current !== null) window.clearTimeout(cueTimerRef.current);
    cueTimerRef.current = window.setTimeout(() => {
      cueTimerRef.current = null;
      setUiCue((current) => current?.id === id ? null : current);
    }, 2600);
    appendDebug("ui_event", { name: type === "name" ? "USER_NAME_CAPTURED" : type === "focus" ? "HELP_NEED_CAPTURED" : type === "google" ? "GOOGLE_CONNECT_REQUESTED" : type === "resume" ? "RESUMING_IN_TEXT" : "GOOGLE_CONNECTED", label });
  }, [appendDebug]);

  const send = useCallback((action: OnboardingAction) => {
    const detail = action.type === "turn"
      ? { role: action.value.role, text: action.value.text, source: action.value.source }
      : action.type === "observe"
        ? { updates: action.value.updates, status: action.value.status, attempted: action.value.attempted, deferred: action.value.deferred, topic: action.value.topic }
        : action.type === "agent-name" || action.type === "edit"
          ? { ...action }
        : action.type === "graduate"
          ? { from: stateRef.current.step, to: "assistant" }
          : action.type === "call-state" || action.type === "mute"
            ? { value: action.value }
            : {};
    appendDebug(`state_action:${action.type}`, detail);
    stateRef.current = onboardingReducer(stateRef.current, action);
    profileRevisionRef.current = Math.max(profileRevisionRef.current, stateRef.current.profileRevision);
    dispatch(action);
  }, [appendDebug]);

  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;
    let stored: string | null = null;
    try { stored = localStorage.getItem(storageKey); } catch { /* Private browsing can disable storage. */ }
    const restored = restoreOnboarding(stored);
    try {
      const saved = JSON.parse(localStorage.getItem(debugStorageKey) ?? "null") as { sessionId?: unknown; onboardingRunId?: unknown; events?: unknown } | null;
      if (saved && typeof saved.sessionId === "string" && typeof saved.onboardingRunId === "string" && Array.isArray(saved.events)) {
        sessionIdRef.current = saved.sessionId;
        onboardingRunIdRef.current = saved.onboardingRunId;
        debugEventsRef.current = saved.events.slice(-500).filter((event): event is DebugEvent => Boolean(event && typeof event === "object" && typeof event.type === "string" && typeof event.onboardingRunId === "string"))
          .map((event) => ({ ...event, detail: redactDebugValue(event.detail) as Record<string, unknown> | undefined }));
      }
    } catch { /* Corrupt diagnostics must not block onboarding. */ }
    if (restored) {
      profileRevisionRef.current = restored.profileRevision;
      send({ type: "hydrate", value: restored });
    }
    appendDebug("onboarding_run_started", { onboardingRunId: onboardingRunIdRef.current, restored: Boolean(restored) });
    setHydrated(true);
    const epoch = requestEpoch.current;
    void fetch("/api/google").then((response) => response.json()).then(({ account }: { account: Account | null }) => {
      if (!mountedRef.current || epoch !== requestEpoch.current) return;
      setAccount(account);
      if (account) {
        send({ type: "account-status", linked: true });
      }
    }).catch(() => { /* Account linking remains available later. */ });
  }, [appendDebug, send]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Continue without persistence if storage is full or disabled. */ }
  }, [state, hydrated]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
    mountedRef.current = false;
    if (textAbortRef.current) requestEpoch.current += 1;
    textAbortRef.current?.abort();
    preparedVoiceReplyRef.current?.controller.abort();
    if (graduationAckTimerRef.current !== null) window.clearTimeout(graduationAckTimerRef.current);
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    if (cueTimerRef.current !== null) window.clearTimeout(cueTimerRef.current);
    };
  }, []);

  const openGooglePrompt = useCallback((markAttempted = true, waitAfterVoiceLine = false) => {
    const googleStatus = stateRef.current.statuses.google;
    if (googlePromptShown.current || googleStatus === "confirmed" || googleStatus === "deferred") return;
    googlePromptShown.current = true;
    if (markAttempted) send({ type: "observe", value: { attempted: ["google"] } });
    showCue("google", "Google account · optional");
    setGooglePromptOpen(true);
    if (["connecting", "listening", "thinking", "speaking"].includes(stateRef.current.callState)) {
      if (waitAfterVoiceLine) actionWaitPendingRef.current = true;
      else {
        actionWaitingRef.current = true;
        setVoiceActionWaitingRef.current(true);
      }
    }
  }, [appendDebug, send, showCue]);

  const deferGooglePrompt = useCallback(() => {
    if (stateRef.current.step === "assistant") {
      setGooglePromptOpen(false);
      appendDebug("ui_event", { name: "GOOGLE_LINK_RETRY_DEFERRED" });
      return;
    }
    if (googleResolutionRef.current || stateRef.current.statuses.google === "deferred" || stateRef.current.statuses.google === "confirmed") return;
    googleResolutionRef.current = true;
    send({ type: "observe", value: { deferred: ["google"] } });
    appendDebug("ui_event", { name: "GOOGLE_CONNECT_DEFERRED" });
    setGooglePromptOpen(false);
    actionWaitPendingRef.current = false;
    const objective = getNextObjective(stateRef.current);
    const continuation = `No problem—you can connect Google later. ${deterministicOnboardingReply(stateRef.current)}`;
    if (objective === "READY_TO_GRADUATE") startGraduationAck("voice-or-text", "google_deferred");
    if (objective === "READY_TO_GRADUATE") graduationAfterVoiceRef.current = true;
    const responseId = continueVoiceRef.current(continuation);
    if (responseId) {
      graduationResponseIdRef.current = responseId;
      return;
    }
    graduationAfterVoiceRef.current = false;
    actionWaitingRef.current = false;
    appendDebug("CALL_END_REQUESTED", { reason: "onboarding_complete", state: "ended", source: "google_deferred_without_live_voice" });
    send({ type: "call-state", value: "ended" });
    appendDebug("assistant_continuation_after_google_decline", { transport: "text", objective, reply: continuation });
    send({ type: "turn", value: turn("assistant", continuation, "text") });
    if (objective === "READY_TO_GRADUATE") scheduleGraduationAckComplete("text");
  }, [appendDebug, scheduleGraduationAckComplete, send, startGraduationAck]);

  const acceptUserTurn = useCallback((message: string, source: "voice" | "text", alreadyRecorded = false, timing?: VoiceTurnTiming) => {
    const before = stateRef.current;
    if (source === "text" && (before.callState === "ended" || before.callState === "error")) showCue("resume", "Picking up where we left off");
    if (!alreadyRecorded) send({ type: "turn", value: turn("user", message, source) });
    if (before.step === "assistant") return stateRef.current;
    const priorTurns = alreadyRecorded ? before.turns.slice(0, -1) : before.turns;
    const preparedCapture = source === "voice" && alreadyRecorded && preparedVoiceCaptureRef.current?.text === message
      ? preparedVoiceCaptureRef.current : null;
    if (preparedCapture) preparedVoiceCaptureRef.current = null;
    const revision = preparedCapture?.revision ?? ++profileRevisionRef.current;
    profileRevisionRef.current = Math.max(profileRevisionRef.current, revision);
    const observation = { ...(preparedCapture?.observation ?? extractUserFacts(message, priorTurns, before)), revision };
    if (observation.updates?.userName || observation.updates?.helpNeed) {
      appendDebug("structured_capture", { source, userName: observation.updates.userName ?? undefined, helpNeed: observation.updates.helpNeed ?? undefined, status: observation.status });
    }
    if (observation.deferred?.includes("google")) {
      setGooglePromptOpen(false);
      actionWaitPendingRef.current = false;
      if (actionWaitingRef.current) {
        actionWaitingRef.current = false;
        setVoiceActionWaitingRef.current(false);
      }
      appendDebug("ui_event", { name: "GOOGLE_CONNECT_DEFERRED" });
    }
    send({ type: "observe", value: observation });
    if (observation.updates?.userName && observation.updates.userName !== before.userName && !preparedCapture?.cueShown) {
      showCue("name", `Got it, ${observation.updates.userName}`);
      setRingSignal((signal) => signal + 1);
    }
    if (observation.updates?.helpNeed && observation.updates.helpNeed !== before.helpNeed && !preparedCapture?.cueShown) {
      showCue("focus", `FOCUS · ${observation.updates.helpNeed}`);
      setRingSignal((signal) => signal + 1);
    }
    const nextState = stateRef.current;
    const objective = getNextObjective(nextState);
    if (timing) {
      timing.structuredCaptureComplete ??= performance.now();
      timing.objectiveSelected ??= performance.now();
    }
    appendDebug("objective_selected", { objective, reason: "structured_state_after_user_turn" });
    appendDebug("graduation_decision", { ready: Boolean(nextState.agentName && nextState.helpNeed), objective });
    return nextState;
  }, [appendDebug, send, showCue]);

  const maybeOpenGooglePrompt = useCallback((text: string, afterTranscript = false) => {
    if (getNextObjective(stateRef.current) !== "CONNECT_GOOGLE") return;
    if (!/\b(?:connect|google|gmail|link)\b/i.test(text)) return;
    const voiceStillReplying = ["connecting", "thinking", "speaking"].includes(stateRef.current.callState);
    openGooglePrompt(true, voiceStillReplying && !afterTranscript);
  }, [openGooglePrompt]);

  const requestVoiceReply = useCallback(async (message: string, turnSignal: AbortSignal, timing: VoiceTurnTiming): Promise<string> => {
    const before = stateRef.current;
    const snapshot = acceptUserTurn(message, "voice", true, timing);
    const safeFallback = deterministicOnboardingReply(snapshot, message);
    const objective = getNextObjective(snapshot);
    const objectiveBeforeTurn = getNextObjective(before);
    const ambiguityReply = ambiguousOnboardingReply(message, snapshot);
    if (ambiguityReply && !(objectiveBeforeTurn === "CONNECT_GOOGLE" && snapshot.statuses.google === "deferred")) {
      appendDebug("pause_intent_acknowledged", { objective, message });
      return ambiguityReply;
    }
    if (objectiveBeforeTurn === "CONNECT_GOOGLE" && snapshot.statuses.google === "deferred") {
      const readyToGraduate = objective === "READY_TO_GRADUATE";
      graduationAfterVoiceRef.current = readyToGraduate;
      const acknowledgement = `No problem—you can connect Google later. ${deterministicOnboardingReply(snapshot)}`;
      if (readyToGraduate) startGraduationAck("voice", "google_deferred_by_speech");
      else appendDebug("ui_event", { name: "ACTION_WAITING_ENDED", reason: "google_deferred_by_speech", nextObjective: objective });
      return acknowledgement;
    }
    if (objective === "CONNECT_GOOGLE" && objectiveBeforeTurn !== "CONNECT_GOOGLE") {
      const reply = fastVoiceReply(snapshot);
      appendDebug("fast_path_selected", { transport: "voice", objective, reason: "state_owned_google_transition" });
      appendDebug("fallback_generated", { transport: "voice", reason: "deterministic_google_transition", objective, reply });
      return reply;
    }
    if (isFastVoiceTransition(before, snapshot, message)) {
      const reply = fastVoiceReply(snapshot);
      appendDebug("fast_path_selected", { transport: "voice", objective, reason: "clear_onboarding_transition" });
      appendDebug("fallback_generated", { transport: "voice", reason: "deterministic_fast_path", objective, reply });
      if (objective === "READY_TO_GRADUATE") graduationAfterVoiceRef.current = true;
      return reply;
    }
    if (isRepetitionComplaint(message) || isPersonaProductQuestion(message)) {
      appendDebug("fallback_generated", { transport: "voice", reason: isRepetitionComplaint(message) ? "repetition_guard" : "contextual_product_answer", objective, reply: safeFallback });
      return safeFallback;
    }
    if (objective === "READY_TO_GRADUATE") {
      appendDebug("graduation_decision", { ready: true, objective, explicitContinuation: isExplicitContinuationRequest(message) });
      if (!isExplicitContinuationRequest(message)) {
        appendDebug("fallback_generated", { transport: "voice", reason: "deterministic_graduation", objective, reply: safeFallback });
        return safeFallback;
      }
    }
    let failureStatus: number | undefined;
    const prepared = prepareVoiceReply(message, timing.turnId, snapshot, timing);
    preparedVoiceReplyRef.current = prepared;
    const abortPrepared = () => prepared.controller.abort();
    if (turnSignal.aborted) abortPrepared();
    else turnSignal.addEventListener("abort", abortPrepared, { once: true });
    appendDebug("voice_reply_request", { message, step: snapshot.step, turnCount: snapshot.turns.length });
    try {
      const bounded = await prepared.result;
      if ("error" in bounded) throw bounded.error;
      if (bounded.timedOut) {
        appendDebug("generation_failed", { category: "LATENCY_DEADLINE", transport: "voice", deadlineMs: 1200 });
        appendDebug("fallback_generated", { transport: "voice", reason: "reply_preparation_deadline", objective: getNextObjective(snapshot), reply: safeFallback });
        return safeFallback;
      }
      const { response, result } = bounded.value;
      appendDebug("voice_reply_response", { status: response.status, modelReply: result.reply, userName: result.userName, helpNeed: result.helpNeed, attempted: result.attempted, deferred: result.deferred, topic: result.topic, openGoogleLink: result.openGoogleLink, diagnostic: result.diagnostic, diagnosticReason: result.diagnosticReason, error: result.error });
      if (result.diagnostic) appendDebug("generation_failed", { category: result.diagnostic, reason: result.diagnosticReason, routeStatus: response.status, transport: "voice" });
      if (!response.ok) { failureStatus = response.status; throw new Error(result.error ?? "The assistant could not shape a reply."); }
      if (turnSignal.aborted) return "";
      const localNeed = snapshot.helpNeed;
      const modelName = snapshot.step !== "assistant" ? supportedModelUserName(result.userName, snapshot.turns) : null;
      const nameChanged = Boolean(modelName && modelName !== snapshot.userName);
      const updates: Observation["updates"] = {
        ...(nameChanged ? { userName: modelName! } : {}),
        ...(snapshot.step !== "assistant" && !localNeed && supportedModelHelpNeed(result.helpNeed, message) ? { helpNeed: supportedModelHelpNeed(result.helpNeed, message) } : {}),
      };
      if (Object.keys(updates).length) send({ type: "observe", value: { updates, ...(nameChanged ? { status: { userName: "confirmed" as const } } : {}) } });
      if (nameChanged && modelName) {
        appendDebug("structured_capture", { source: "text_model", userName: modelName, status: { userName: "confirmed" } });
        showCue("name", `Got it, ${modelName}`);
        setRingSignal((signal) => signal + 1);
      }
      if (result.topic) send({ type: "observe", value: { topic: result.topic } });
      const latestState = stateRef.current;
      const selected = getNextObjective(latestState);
      appendDebug("objective_selected", { objective: selected, reason: "state_after_model_observation" });
      if (selected === "READY_TO_GRADUATE") {
        const transition = deterministicOnboardingReply(latestState, message);
        if (!isExplicitContinuationRequest(message)) {
          appendDebug("graduation_decision", { ready: true, objective: selected, explicitContinuation: false });
          appendDebug("fallback_generated", { transport: "voice", reason: "deterministic_graduation", objective: selected, reply: transition });
          return transition;
        }
      }
      const knownGoal = latestState.helpNeed || localNeed;
      const genericHelpQuestion = /\b(?:how can i help|what can i help|what can i do for you|what would you like help (?:with|making easier)|how may i assist|what's on your mind|what brings you here|how can i support you)\b/i.test(result.reply);
      const repeatedDiscoveryQuestion = Boolean(knownGoal && (/\bwhat(?:'s| has) been taking (?:up )?(?:the most )?(?:time|energy)|\bwhat do you want help with\b|\bwhich part (?:has been|is) (?:taking|hardest)|\btell me more about (?:your )?(?:goal|need)\b/i.test(result.reply)
        || selected === "CONNECT_GOOGLE" && result.reply.includes("?") && !/\bgoogle\b/i.test(result.reply)));
      if ((genericHelpQuestion || repeatedDiscoveryQuestion) && latestState.step !== "assistant") {
        const guardedReply = deterministicOnboardingReply(latestState, message);
        appendDebug("voice_reply_guardrail", { reason: "replaced_generic_help_question", modelReply: result.reply, reply: guardedReply });
        return guardedReply;
      }
      if (selected === "CONNECT_GOOGLE" && !/\bgoogle\b/i.test(result.reply)) return deterministicOnboardingReply(latestState, message);
      if (result.reply) return result.reply;
    } catch (cause) {
      if (turnSignal.aborted) return "";
      appendDebug("generation_failed", { category: httpFailureCategory(failureStatus, cause), transport: "voice", status: failureStatus, message: cause instanceof Error ? cause.message : "unknown" });
    } finally {
      turnSignal.removeEventListener("abort", abortPrepared);
      if (preparedVoiceReplyRef.current === prepared) preparedVoiceReplyRef.current = null;
    }

    const current = stateRef.current;
    const fallback = deterministicOnboardingReply(current, message);
    appendDebug("fallback_generated", { transport: "voice", objective: getNextObjective(current), reply: fallback });
    return fallback || safeFallback;
  }, [acceptUserTurn, appendDebug, send, showCue, startGraduationAck]);

  const voice = useVoiceCall({
    onState: (value) => {
      if (value === "ended" && graduationAfterVoiceRef.current && graduationAckStartedRef.current) {
        recoverGraduationAckRef.current(`voice_${value}`);
        return;
      }
      if ((actionWaitingRef.current || actionWaitPendingRef.current) && value === "ended") {
        appendDebug("voice_failure_suppressed_during_action", { state: value });
        return;
      }
      if (value !== "action_waiting") actionWaitingRef.current = false;
      else actionWaitingRef.current = true;
      if (stateRef.current.callState !== value) appendDebug("call_state", { from: stateRef.current.callState, to: value });
      send({ type: "call-state", value });
      if (value === "listening" && actionWaitPendingRef.current && getNextObjective(stateRef.current) === "CONNECT_GOOGLE") {
        actionWaitPendingRef.current = false;
        actionWaitingRef.current = true;
        setVoiceActionWaitingRef.current(true);
        return;
      }
    },
    onUserPartial: (text) => setVoiceDraft(text ? { role: "user", text, timing: null } : null),
    onUserTurn: (text, timing) => {
      setVoiceDraft({ role: "user", text, timing: null });
      send({ type: "turn", value: turn("user", text, "voice") });
      const current = stateRef.current;
      const observation = extractUserFacts(text, current.turns.slice(0, -1), current);
      const projected = onboardingReducer(current, { type: "observe", value: observation });
      const revision = ++profileRevisionRef.current;
      preparedVoiceCaptureRef.current = { text, observation, cueShown: false, revision };
      timing.structuredCaptureComplete = performance.now();
      timing.objectiveSelected = performance.now();
      appendDebug("capture_prepared", { objective: getNextObjective(projected), stagedUntilSpeechScreen: true });
    },
    onUserTurnCancelled: (turnId) => {
      const prepared = preparedVoiceReplyRef.current;
      if (!prepared || (turnId !== undefined && prepared.turnId !== turnId)) return;
      prepared.controller.abort();
      preparedVoiceReplyRef.current = null;
    },
    onAssistantPartial: (text, timing) => setVoiceDraft(text ? { role: "assistant", text, timing } : null),
    onAssistantTurn: (text, timing, responseId) => {
      if (graduationAfterVoiceRef.current && graduationAckStartedRef.current && responseId === graduationResponseIdRef.current) graduationVoiceTextSeenRef.current = true;
      setVoiceDraft({ role: "assistant", text, timing });
      send({ type: "turn", value: turn("assistant", text, "voice") });
    },
    onAssistantAudioStarted: (responseId) => {
      if (graduationAfterVoiceRef.current && responseId === graduationResponseIdRef.current) {
        appendDebug("ui_event", { name: "GRADUATION_AUDIO_STARTED", responseId });
      }
    },
    onAssistantOutputComplete: (playedAudio, responseId) => {
      if (!shouldCompleteGraduationAudio(graduationAfterVoiceRef.current, graduationAckStartedRef.current, graduationAckCompleteRef.current, graduationResponseIdRef.current, responseId)) return;
      graduationAfterVoiceRef.current = false;
      if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
      graduationVoiceDeadlineRef.current = null;
      if (playedAudio) {
        appendDebug("ui_event", { name: "GRADUATION_AUDIO_ENDED", responseId });
        finishGraduationAckRef.current(onboardingRunIdRef.current, "voice");
      } else {
        scheduleGraduationAckComplete("text");
      }
    },
    onError: (message, reason) => {
      if (graduationAfterVoiceRef.current && graduationAckStartedRef.current) {
        recoverGraduationAckRef.current(`voice_error_${reason}`);
        return;
      }
      if (!shouldSurfaceVoiceFailure(reason)) {
        appendDebug("voice_error_suppressed_invalid_reason", { reason });
        return;
      }
      if (actionWaitingRef.current || actionWaitPendingRef.current) {
        appendDebug("voice_failure_deferred_during_action", { message, reason });
        return;
      }
      appendDebug("voice_error", { message, reason });
      send({ type: "voice-failure", reason });
      appendDebug("ui_event", { name: "RECOVERY_PRESENTED" });
      showCue("resume", "We got disconnected · continue here");
      setError(message);
    },
    onApprovedUserTurn: requestVoiceReply,
    onVoiceLatencyFallback: (message) => deterministicOnboardingReply(stateRef.current, message),
    onDebug: appendDebug,
  });
  continueVoiceRef.current = voice.continueAfterGoogleDecline;
  currentVoiceResponseIdRef.current = voice.getCurrentResponseId;
  voiceAudioPlayingRef.current = voice.isAudioPlaying;
  setVoiceActionWaitingRef.current = voice.setActionWaiting;

  const completeOnboarding = useCallback((message?: string, reason: GraduationReason = "resolved") => {
    const current = stateRef.current;
    const explicitEarly = reason === "explicit_early";
    if (current.step === "assistant" || !canGraduate(current, explicitEarly)) {
      appendDebug("graduation_blocked", { reason, objective: getNextObjective(current), googleStatus: current.statuses.google });
      return;
    }
    if (message && !graduationAckStartedRef.current) {
      startGraduationAck("text", "explicit_early");
      send({ type: "turn", value: turn("assistant", message, "system") });
      appendDebug("ui_event", { name: "GRADUATION_ACK_COMPLETE", transport: "text" });
    }
    appendDebug("graduation_decision", { ready: getNextObjective(current) === "READY_TO_GRADUATE", objective: getNextObjective(current), transition: explicitEarly ? "explicit_early_request" : "resolved_objectives" });
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    graduationVoiceDeadlineRef.current = null;
    voice.stop("ended", "onboarding_complete");
    setGooglePromptOpen(false);
    appendDebug("ui_event", { name: "ONBOARDING_GRADUATED" });
    send({ type: "graduate", reason });
    appendDebug("ui_event", { name: "MAIN_EXPERIENCE_ENTERED" });
  }, [appendDebug, send, startGraduationAck, voice]);
  completeOnboardingRef.current = completeOnboarding;
  finishGraduationAckRef.current = (runId, transport, reason) => {
    if (runId !== onboardingRunIdRef.current || !graduationAckStartedRef.current || graduationAckCompleteRef.current || stateRef.current.step === "assistant") return;
    graduationAckCompleteRef.current = true;
    graduationAfterVoiceRef.current = false;
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    graduationVoiceDeadlineRef.current = null;
    appendDebug("ui_event", { name: "GRADUATION_ACK_COMPLETE", transport, reason });
    completeOnboardingRef.current();
  };
  recoverGraduationAckRef.current = (reason) => {
    if (!graduationAfterVoiceRef.current || !graduationAckStartedRef.current || stateRef.current.step === "assistant") return;
    graduationAfterVoiceRef.current = false;
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    graduationVoiceDeadlineRef.current = null;
    if (!graduationVoiceTextSeenRef.current) {
      send({ type: "turn", value: turn("assistant", deterministicOnboardingReply(stateRef.current), "text") });
    }
    scheduleGraduationAckComplete("text");
  };

  const requestGoogleFromMain = useCallback(() => {
    if (account) return;
    googleResolutionRef.current = false;
    googlePromptShown.current = false;
    setGooglePromptOpen(true);
    appendDebug("ui_event", { name: "GOOGLE_LINK_RETRY_OPENED" });
  }, [account, appendDebug]);

  const closeGooglePrompt = useCallback(() => {
    if (stateRef.current.step !== "assistant" && getNextObjective(stateRef.current) === "CONNECT_GOOGLE") {
      appendDebug("ui_event", { name: "GOOGLE_DIALOG_DISMISSED_AS_NOT_NOW" });
      deferGooglePrompt();
      return;
    }
    setGooglePromptOpen(false);
    actionWaitPendingRef.current = false;
    if (actionWaitingRef.current) {
      actionWaitingRef.current = false;
      setVoiceActionWaitingRef.current(false);
    }
    appendDebug("ui_event", { name: "GOOGLE_DIALOG_CLOSED", objective: getNextObjective(stateRef.current) });
  }, [appendDebug, deferGooglePrompt]);

  const startCall = useCallback((profile: OnboardingState) => {
    appendDebug("call_start_requested", { turnCount: profile.turns.length, hasName: Boolean(profile.userName), hasGoal: Boolean(profile.helpNeed) });
    if (profile.step === "assistant") return;
    const transcriptName = nameFromTurns(profile.turns);
    if (!profile.userName && transcriptName) {
      send({ type: "observe", value: { updates: { userName: transcriptName } } });
      profile = stateRef.current;
    }
    void voice.start(profile);
  }, [appendDebug, send, voice]);

  const sendText = useCallback(async (message: string): Promise<boolean> => {
    if (textPendingRef.current) return false;
    textPendingRef.current = true;
    const epoch = ++requestEpoch.current;
    const controller = new AbortController();
    let failureStatus: number | undefined;
    textAbortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 8000);
    if (["connecting", "listening", "thinking", "speaking", "action_waiting"].includes(stateRef.current.callState)) voice.stop("ended", "switch_to_text");
    setPending(true);
    setError("");
    let googleResolvedThisTurn = false;
    try {
      const objectiveBeforeTurn = getNextObjective(stateRef.current);
      const snapshot = acceptUserTurn(message, "text");
      const objectiveAfterTurn = getNextObjective(snapshot);
      googleResolvedThisTurn = objectiveBeforeTurn === "CONNECT_GOOGLE" && snapshot.statuses.google === "deferred";
      const ambiguityReply = ambiguousOnboardingReply(message, snapshot);
      if (ambiguityReply && !googleResolvedThisTurn) {
        const acknowledgement = ambiguityReply;
        appendDebug("pause_intent_acknowledged", { objective: objectiveAfterTurn, message });
        send({ type: "turn", value: turn("assistant", acknowledgement, "text") });
        return true;
      }
      if (objectiveAfterTurn === "CONNECT_GOOGLE" && objectiveBeforeTurn !== "CONNECT_GOOGLE") {
        const reply = fastVoiceReply(stateRef.current);
        appendDebug("fast_path_selected", { transport: "text", objective: objectiveAfterTurn, reason: "state_owned_google_transition" });
        send({ type: "turn", value: turn("assistant", reply, "text") });
        return true;
      }
      if (googleResolvedThisTurn && !isExplicitContinuationRequest(message)) {
        const readyToGraduate = objectiveAfterTurn === "READY_TO_GRADUATE";
        const reply = `No problem—you can connect Google later. ${deterministicOnboardingReply(snapshot, message)}`;
        appendDebug("fallback_generated", { transport: "text", reason: readyToGraduate ? "deterministic_graduation" : "deterministic_google_deferral", objective: objectiveAfterTurn, reply });
        if (readyToGraduate) startGraduationAck("text", "google_resolved");
        else appendDebug("ui_event", { name: "ACTION_WAITING_ENDED", transport: "text", reason: "google_resolved" });
        send({ type: "turn", value: turn("assistant", reply, "text") });
        appendDebug("graduation_decision", { ready: readyToGraduate, objective: objectiveAfterTurn, explicitContinuation: false });
        if (readyToGraduate) scheduleGraduationAckComplete("text");
        return true;
      }
      if (isRepetitionComplaint(message) || isPersonaProductQuestion(message)) {
        const reply = deterministicOnboardingReply(snapshot, message);
        appendDebug("fallback_generated", { transport: "text", reason: isRepetitionComplaint(message) ? "repetition_guard" : "contextual_product_answer", objective: getNextObjective(snapshot), reply });
        send({ type: "turn", value: turn("assistant", reply, "text") });
        return true;
      }
      appendDebug("text_reply_request", { message, step: snapshot.step, turnCount: snapshot.turns.length });
      const response = await fetch("/api/conversation", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ mode: "reply", message, profile: snapshot, turns: snapshot.turns.slice(-12) }),
      });
      const result: AgentResult & { error?: string } = await response.json();
      appendDebug("text_reply_response", { status: response.status, reply: result.reply, userName: result.userName, helpNeed: result.helpNeed, attempted: result.attempted, deferred: result.deferred, topic: result.topic, openGoogleLink: result.openGoogleLink, diagnostic: result.diagnostic, diagnosticReason: result.diagnosticReason, error: result.error });
      if (result.diagnostic) appendDebug("generation_failed", { category: result.diagnostic, reason: result.diagnosticReason, routeStatus: response.status, transport: "text" });
      if (epoch !== requestEpoch.current) return false;
      if (!response.ok) { failureStatus = response.status; throw new Error(result.error ?? "The assistant could not respond."); }
      const modelName = snapshot.step !== "assistant" ? supportedModelUserName(result.userName, snapshot.turns) : null;
      const nameChanged = Boolean(modelName && modelName !== snapshot.userName);
      const updates: Observation["updates"] = {
        ...(nameChanged ? { userName: modelName! } : {}),
        ...(snapshot.step !== "assistant" && !snapshot.helpNeed && supportedModelHelpNeed(result.helpNeed, message) ? { helpNeed: supportedModelHelpNeed(result.helpNeed, message) } : {}),
      };
      if (Object.keys(updates).length) send({ type: "observe", value: { updates, ...(nameChanged ? { status: { userName: "confirmed" as const } } : {}) } });
      if (nameChanged && modelName) {
        appendDebug("structured_capture", { source: "text_model", userName: modelName, status: { userName: "confirmed" } });
        showCue("name", `Got it, ${modelName}`);
        setRingSignal((signal) => signal + 1);
      }
      if (result.topic) send({ type: "observe", value: { topic: result.topic } });
      const current = stateRef.current;
      const objective = getNextObjective(current);
      appendDebug("objective_selected", { objective, reason: "state_after_model_observation" });
      const repeats = Boolean(current.helpNeed && (/\bwhat(?:'s| has) been taking (?:up )?(?:the most )?(?:time|energy)|\bwhat do you want help with\b|\bhow can i help\b|\bwhich part (?:has been|is) (?:taking|hardest)|\btell me more about (?:your )?(?:goal|need)\b/i.test(result.reply)
        || objective === "CONNECT_GOOGLE" && result.reply.includes("?") && !/\bgoogle\b/i.test(result.reply)));
      const generic = /\b(?:how can i help|what can i help|what can i do for you|what's on your mind|what would you like help with)\b/i.test(result.reply);
      const reply = (repeats || generic) && current.step !== "assistant" || (objective === "CONNECT_GOOGLE" && !/\bgoogle\b/i.test(result.reply))
        ? deterministicOnboardingReply(current, message)
        : result.reply || deterministicOnboardingReply(current, message);
      const finalReply = objective === "READY_TO_GRADUATE" && !isExplicitContinuationRequest(message)
        ? deterministicOnboardingReply(current, message)
        : reply;
      send({ type: "turn", value: turn("assistant", finalReply, "text") });
      if (googleResolvedThisTurn && objective === "READY_TO_GRADUATE" && !isExplicitContinuationRequest(message)) {
        appendDebug("graduation_decision", { ready: true, objective, explicitContinuation: isExplicitContinuationRequest(message) });
        startGraduationAck("text", "google_deferred_by_text");
        scheduleGraduationAckComplete("text");
      }
      return true;
    } catch (cause) {
      if (epoch !== requestEpoch.current) return false;
      appendDebug("generation_failed", { category: httpFailureCategory(failureStatus, cause), transport: "text", status: failureStatus, message: cause instanceof Error ? cause.message : "unknown" });
      const current = stateRef.current;
      const reply = deterministicOnboardingReply(current, message);
      appendDebug("fallback_generated", { transport: "text", objective: getNextObjective(current), reply });
      send({ type: "turn", value: turn("assistant", reply, "text") });
      return true;
    } finally {
      window.clearTimeout(timer);
      if (textAbortRef.current === controller) textAbortRef.current = null;
      textPendingRef.current = false;
      if (epoch === requestEpoch.current) setPending(false);
    }
  }, [acceptUserTurn, appendDebug, scheduleGraduationAckComplete, send, showCue, startGraduationAck, voice]);

  const link = useCallback(async (credential: string) => {
    if (googleResolutionRef.current || account) return;
    googleResolutionRef.current = true;
    const runId = onboardingRunIdRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch("/api/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential }), signal: controller.signal });
      const result: { account?: Account; error?: string } = await response.json();
      if (!mountedRef.current || runId !== onboardingRunIdRef.current) return;
      if (!response.ok || !result.account) throw new Error(result.error ?? "Google sign-in failed.");
      setAccount(result.account);
      send({ type: "account-status", linked: true });
      setGooglePromptOpen(false);
      googlePromptShown.current = false;
      actionWaitPendingRef.current = false;
      showCue("success", "Google account linked");
      setRingSignal((signal) => signal + 1);
      setError("");
      const nextObjective = getNextObjective(stateRef.current);
      {
        const readyToGraduate = nextObjective === "READY_TO_GRADUATE";
        const acknowledgement = deterministicOnboardingReply(stateRef.current);
        const continuation = readyToGraduate ? acknowledgement : `Thanks for linking Google. ${acknowledgement}`;
        if (readyToGraduate) startGraduationAck("voice-or-text", "google_connected");
        else appendDebug("ui_event", { name: "GOOGLE_CONNECTED_ACK_STARTED", transport: "voice-or-text", nextObjective });
        graduationAfterVoiceRef.current = readyToGraduate;
        const responseId = continueVoiceRef.current(continuation);
        if (responseId) graduationResponseIdRef.current = responseId;
        else {
          graduationAfterVoiceRef.current = false;
          actionWaitingRef.current = false;
          send({ type: "call-state", value: "ended" });
          send({ type: "turn", value: turn("assistant", continuation, "text") });
          if (readyToGraduate) scheduleGraduationAckComplete("text");
        }
      }
    } catch (cause) { if (mountedRef.current && runId === onboardingRunIdRef.current) setError(cause instanceof Error ? cause.message : "Google sign-in failed."); }
    finally {
      window.clearTimeout(timer);
      if (mountedRef.current && runId === onboardingRunIdRef.current && stateRef.current.statuses.google !== "confirmed") googleResolutionRef.current = false;
    }
  }, [account, appendDebug, scheduleGraduationAckComplete, send, showCue, startGraduationAck]);

  const trackedLink = useCallback((credential: string) => {
    const operation = link(credential);
    linkPromiseRef.current = operation;
    void operation.finally(() => { if (linkPromiseRef.current === operation) linkPromiseRef.current = null; });
    return operation;
  }, [link]);

  const endCall = useCallback((reason: "user_hangup" | "switch_to_text" | "oauth_action" = "user_hangup") => {
    const finishInText = graduationAfterVoiceRef.current && graduationAckStartedRef.current;
    if (finishInText) graduationAfterVoiceRef.current = false;
    actionWaitPendingRef.current = false;
    actionWaitingRef.current = false;
    if (googlePromptOpen) setGooglePromptOpen(false);
    voice.stop("ended", reason);
    voice.setActionWaiting(false);
    if (finishInText) {
      if (!graduationVoiceTextSeenRef.current) send({ type: "turn", value: turn("assistant", deterministicOnboardingReply(stateRef.current), "text") });
      scheduleGraduationAckComplete("text");
    }
  }, [googlePromptOpen, scheduleGraduationAckComplete, send, voice]);

  const unlink = useCallback(async () => {
    try {
      await linkPromiseRef.current?.catch(() => undefined);
      const response = await fetch("/api/google", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not unlink this account.");
      if (!mountedRef.current) return;
      setAccount(null);
      send({ type: "account-status", linked: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not unlink this account."); }
  }, [send]);

  const reset = useCallback(() => {
    if (graduationAckTimerRef.current !== null) window.clearTimeout(graduationAckTimerRef.current);
    graduationAckTimerRef.current = null;
    if (graduationVoiceDeadlineRef.current !== null) window.clearTimeout(graduationVoiceDeadlineRef.current);
    graduationVoiceDeadlineRef.current = null;
    graduationVoiceTextSeenRef.current = false;
    graduationResponseIdRef.current = null;
    graduationAckCompleteRef.current = false;
    if (cueTimerRef.current !== null) window.clearTimeout(cueTimerRef.current);
    cueTimerRef.current = null;
    setUiCue(null);
    setVoiceDraft(null);
    setRingSignal(0);
    requestEpoch.current += 1;
    preparedVoiceCaptureRef.current = null;
    preparedVoiceReplyRef.current?.controller.abort();
    preparedVoiceReplyRef.current = null;
    textAbortRef.current?.abort();
    textAbortRef.current = null;
    setPending(false);
    actionWaitPendingRef.current = false;
    actionWaitingRef.current = false;
    voice.stop("ended", "reset");
    voice.setActionWaiting(false);
    googlePromptShown.current = false;
    googleResolutionRef.current = false;
    profileRevisionRef.current = 0;
    graduationAckStartedRef.current = false;
    graduationAfterVoiceRef.current = false;
    setGooglePromptOpen(false);
    try { localStorage.removeItem(storageKey); } catch { /* The in-memory reset still succeeds. */ }
    send({ type: "reset" });
    setError("");
    onboardingRunIdRef.current = createRunId();
    appendDebug("onboarding_run_started", { onboardingRunId: onboardingRunIdRef.current, reason: "reset" });
    void unlink();
  }, [appendDebug, send, unlink, voice]);

  if (!hydrated) return <div className="experience-loading" aria-label="Loading Persona" />;
  if (state.step === "setup") return <OnboardingSetup
    name={state.agentName}
    onNameChange={(value) => send({ type: "agent-name", value })}
    onBeginCall={(agentName) => {
      setError("");
      startCall({ ...stateRef.current, agentName, step: "conversation" });
    }}
    onContinue={() => send({ type: "continue" })}
  />;

  return <CallScreen
    state={state} account={account} googlePromptOpen={googlePromptOpen} ringSignal={ringSignal} uiCue={uiCue} pending={pending} error={error} voiceDraft={voiceDraft} onAssistantTextVisible={maybeOpenGooglePrompt} onSend={sendText}
    onStart={() => { if (textPendingRef.current) { requestEpoch.current += 1; textAbortRef.current?.abort(); setPending(false); } setError(""); startCall(stateRef.current); }}
    onEnd={endCall}
    onMute={() => { const muted = !stateRef.current.muted; send({ type: "mute", value: muted }); voice.setMuted(muted); }}
    onGraduate={() => {
      appendDebug("EARLY_GRADUATION_REQUESTED", { source: "enter_persona_button", objective: getNextObjective(stateRef.current) });
      if (!graduationAckStartedRef.current) completeOnboarding(deterministicOnboardingReply(stateRef.current), "explicit_early");
    }}
    onRequestGoogle={requestGoogleFromMain}
    onEdit={(field, value) => {
      if (field === "agentName") send({ type: "agent-name", value });
      else {
        send({ type: "edit", field, value });
      }
    }}
    onLink={trackedLink} onUnlink={unlink} onDeferGooglePrompt={deferGooglePrompt} onCloseGooglePrompt={closeGooglePrompt} onError={setError} onReset={reset}
  />;
}
