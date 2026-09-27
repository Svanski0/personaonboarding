export function shouldCompleteGraduationAudio(
  awaitingVoiceAck: boolean,
  ackStarted: boolean,
  ackComplete: boolean,
  expectedResponseId: string | null,
  completedResponseId: string | null,
): boolean {
  return awaitingVoiceAck && ackStarted && !ackComplete && expectedResponseId !== null && expectedResponseId === completedResponseId;
}
