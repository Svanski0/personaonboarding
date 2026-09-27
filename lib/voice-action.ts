export type VoiceActionWait = { active: boolean; deferredFailure: string | null };
export type VoiceFailureReason = "TRANSPORT_DISCONNECTED" | "PROVIDER_CONNECTION_FAILED" | "MICROPHONE_FATAL";

const voiceFailureReasons: VoiceFailureReason[] = ["TRANSPORT_DISCONNECTED", "PROVIDER_CONNECTION_FAILED", "MICROPHONE_FATAL"];

export function isVoiceFailureReason(reason: unknown): reason is VoiceFailureReason {
  return typeof reason === "string" && voiceFailureReasons.includes(reason as VoiceFailureReason);
}

export function shouldSurfaceVoiceFailure(reason: string): reason is VoiceFailureReason {
  return isVoiceFailureReason(reason);
}

export const initialVoiceActionWait: VoiceActionWait = { active: false, deferredFailure: null };

export function beginVoiceActionWait(): VoiceActionWait {
  return { active: true, deferredFailure: null };
}

export function shouldRunVoiceWatchdog(actionWait: VoiceActionWait): boolean {
  return !actionWait.active;
}

export function shouldEmitAssistantOutputComplete(responseComplete: boolean, pendingAudioChunks: number, alreadyEmitted: boolean): boolean {
  return responseComplete && pendingAudioChunks === 0 && !alreadyEmitted;
}

export function isVoiceResponseStalled(input: {
  actionWait: VoiceActionWait;
  lastProgressAt: number;
  now: number;
  timeoutMs: number;
  audioPlaying: boolean;
  userSpeaking: boolean;
}): boolean {
  return shouldRunVoiceWatchdog(input.actionWait)
    && !input.audioPlaying
    && !input.userSpeaking
    && input.now - input.lastProgressAt >= input.timeoutMs;
}

export type VoiceWatchdogDisposition = "wait" | "deterministic_fallback" | "transport_failure";
export type RecognitionErrorDisposition = "retry" | "fatal" | "ignore";

export function getRecognitionErrorDisposition(error: string, networkFailureCount: number): RecognitionErrorDisposition {
  if (error === "not-allowed" || error === "service-not-allowed" || error === "audio-capture") return "fatal";
  if (error === "network") return networkFailureCount >= 5 ? "fatal" : "retry";
  return "ignore";
}

export function getVoiceWatchdogDisposition(input: {
  actionWait: VoiceActionWait;
  lastProgressAt: number;
  now: number;
  timeoutMs: number;
  audioPlaying: boolean;
  userSpeaking: boolean;
  socketReadyState?: number;
  callActive?: boolean;
}): VoiceWatchdogDisposition {
  if (input.callActive === false) return "wait";
  if (!isVoiceResponseStalled(input)) return "wait";
  return input.socketReadyState !== undefined && input.socketReadyState !== 1
    ? "transport_failure"
    : "deterministic_fallback";
}

export function recordVoiceFailure(actionWait: VoiceActionWait, message: string): { state: VoiceActionWait; surface: boolean } {
  if (actionWait.active) return { state: { ...actionWait, deferredFailure: message }, surface: false };
  return { state: actionWait, surface: true };
}

export function finishVoiceActionWait(actionWait: VoiceActionWait): { state: VoiceActionWait; deferredFailure: string | null } {
  return { state: initialVoiceActionWait, deferredFailure: actionWait.deferredFailure };
}
