function normalizeTranscript(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9']+/g, " ").trim().replace(/\s+/g, " ");
}

export function isAssistantEcho(transcript: string, assistantText: string): boolean {
  const heard = normalizeTranscript(transcript);
  const spoken = normalizeTranscript(assistantText);
  if (!heard || !spoken) return false;
  const heardWords = heard.split(" ");
  const spokenWords = spoken.split(" ");
  if (heardWords.length === 1) {
    return heard.length >= 6 && spokenWords.at(-1) === heard;
  }

  // SpeechRecognition often finalizes a clipped tail such as "connect G" while Nova
  // is still speaking "connect Google". Filter that suffix/prefix echo without
  // swallowing unrelated short interruptions like "wait" or "yeah".
  if (` ${spoken} `.includes(` ${heard} `)) return true;
  const matchedWordCount = heardWords.length - 1;
  return matchedWordCount >= 1
    && heardWords[0].length >= 6
    && spokenWords.slice(-matchedWordCount).join(" ") === heardWords.slice(0, matchedWordCount).join(" ");
}

export function isDuplicateAssistantOutput(
  previous: { turnId: number; text: string } | null,
  next: { turnId: number; text: string },
): boolean {
  return previous?.turnId === next.turnId
    && normalizeTranscript(previous.text) === normalizeTranscript(next.text);
}
