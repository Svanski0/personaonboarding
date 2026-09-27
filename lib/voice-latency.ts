import { getNextObjective, type OnboardingState } from "./onboarding";

export type VoiceTurnTiming = {
  turnId: number;
  utteranceId?: number;
  speechEnd?: number;
  transcriptFinal?: number;
  structuredCaptureComplete?: number;
  objectiveSelected?: number;
  modelRequestStarted?: number;
  modelFirstToken?: number;
  modelResponseComplete?: number;
  ttsStarted?: number;
  firstAudioPlayed?: number;
  ttsComplete?: number;
  replyPreparationStarted?: number;
  replyPreparationComplete?: number;
  fallbackStarted?: number;
  gateRequestStarted?: number;
  gateResponseComplete?: number;
  speechGateServerMs?: number;
};

export async function resolveWithin<T>(
  task: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<{ value: T; timedOut: false } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      resolve({ timedOut: true });
    }, timeoutMs);
    task.then((value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ value, timedOut: false });
    }, (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
  });
}

export function isCurrentVoiceGeneration(currentId: number, turnId: number, signal: AbortSignal): boolean {
  return currentId === turnId && !signal.aborted;
}

export function shouldRetryVoiceStart(timing: VoiceTurnTiming, activeTurnId: number): boolean {
  return timing.turnId === activeTurnId && timing.modelFirstToken === undefined && timing.fallbackStarted === undefined;
}

function elapsed(start?: number, end?: number): number | null {
  return start !== undefined && end !== undefined ? Math.max(0, Math.round(end - start)) : null;
}

export function voiceLatencySummary(timing: VoiceTurnTiming, outcome: "complete" | "interrupted" | "ended") {
  const base = timing.speechEnd ?? timing.transcriptFinal;
  return {
    turnId: timing.turnId,
    outcome,
    stages: Object.fromEntries(Object.entries(timing)
      .filter(([key, value]) => key !== "turnId" && key !== "utteranceId" && key !== "speechGateServerMs" && typeof value === "number")
      .map(([key, value]) => [key, elapsed(base, value as number)])),
    serverMs: { speechGateHandler: timing.speechGateServerMs ?? null },
    durationsMs: {
      speech_end_to_transcript_final: elapsed(timing.speechEnd, timing.transcriptFinal),
      transcript_final_to_structured_capture_complete: elapsed(timing.transcriptFinal, timing.structuredCaptureComplete),
      transcript_final_to_objective_selected: elapsed(timing.transcriptFinal, timing.objectiveSelected),
      objective_selected_to_model_request_started: elapsed(timing.objectiveSelected, timing.modelRequestStarted),
      model_request_started_to_first_token: elapsed(timing.modelRequestStarted, timing.modelFirstToken),
      first_token_to_first_audio: elapsed(timing.modelFirstToken, timing.firstAudioPlayed),
      speech_end_to_first_audio: elapsed(timing.speechEnd, timing.firstAudioPlayed),
      speech_end_to_complete_response: elapsed(timing.speechEnd, timing.ttsComplete),
      gate_duration: elapsed(timing.gateRequestStarted, timing.gateResponseComplete),
      gate_unattributed_overhead: elapsed(timing.gateRequestStarted, timing.gateResponseComplete) === null || timing.speechGateServerMs === undefined
        ? null : Math.max(0, (elapsed(timing.gateRequestStarted, timing.gateResponseComplete) ?? 0) - timing.speechGateServerMs),
      reply_preparation_duration: elapsed(timing.replyPreparationStarted, timing.replyPreparationComplete),
    },
    speechEndIsEstimatedFromRecognition: true,
  };
}

function hasCorrectionOrDetour(message: string): boolean {
  return /\b(?:actually|instead|not anymore|that's not what i meant|that is not what i meant|why|what is|what's|do you know|tell me about|don't want|do not want|no thanks|not now|rather not|confused|overwhelmed|anxious|stressed|exhausted|frustrated|scared|burned out|burnt out|can't cope)\b/i.test(message)
    || message.includes("?") || message.length > 180;
}

export function isFastVoiceTransition(previous: OnboardingState, current: OnboardingState, message: string): boolean {
  const objective = getNextObjective(current);
  const declinedGoogle = getNextObjective(previous) === "CONNECT_GOOGLE" && current.statuses.google === "deferred";
  if (objective === "READY_TO_GRADUATE" && declinedGoogle) return true;
  if (hasCorrectionOrDetour(message)) return false;
  const capturedName = !previous.userName && Boolean(current.userName);
  const capturedNeed = previous.helpNeed !== current.helpNeed && Boolean(current.helpNeed);
  if (objective === "READY_TO_GRADUATE") return true;
  if (objective === "DISCOVER_HELP_NEED" && capturedName) return true;
  if (objective === "CONFIRM_HELP_NEED" && capturedNeed && message.length <= 100) return true;
  return objective === "CONNECT_GOOGLE" && capturedNeed;
}

export function fastVoiceReply(state: OnboardingState): string {
  const variant = state.turns.filter((turn) => turn.role === "user").length % 2;
  const name = state.userName || "there";
  const need = state.helpNeed || "that";
  const agent = state.agentName || "I";
  switch (getNextObjective(state)) {
    case "DISCOVER_HELP_NEED":
      return variant ? `Got it, ${name}. What's been taking the most energy this week?` : `Nice to meet you, ${name}. What's been taking up most of your time lately?`;
    case "CONFIRM_HELP_NEED":
      return variant ? `So ${need} is the main thing right now?` : `Did I get that right—${need} is what you'd like help with?`;
    case "CONNECT_GOOGLE":
      return variant ? `Makes sense, ${need}. Want to link Google so I can help?` : `Got it, ${need}. Want to connect Google so I can help?`;
    case "READY_TO_GRADUATE":
      return `You're all set${state.userName ? `, ${state.userName}` : ""}. Let's get started.`;
    case "ASK_USER_NAME":
      return "What's a name you'd like me to use?";
    case "OPTIONAL_CONVERSATION":
      return "What would be most useful to tackle first?";
  }
}
