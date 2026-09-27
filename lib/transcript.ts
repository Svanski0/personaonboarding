const wordCharacter = /[\p{L}\p{N}]$/u;
const startsWithWordCharacter = /^[\p{L}\p{N}]/u;

export function mergeTranscript(current: string, next: string): string {
  if (!current) return next;
  if (!next || next.startsWith(current) || current.endsWith(next)) return next.startsWith(current) ? next : current;

  const overlapLimit = Math.min(current.length, next.length);
  for (let size = overlapLimit; size > 1; size -= 1) {
    if (current.slice(-size) === next.slice(0, size)) {
      return current + next.slice(size);
    }
  }

  if (/\s$/.test(current) || /^\s/.test(next)) return current + next;
  if (wordCharacter.test(current) && startsWithWordCharacter.test(next)) return `${current} ${next}`;
  if (/[.!?]$/.test(current) && startsWithWordCharacter.test(next)) return `${current} ${next}`;
  return current + next;
}

export function finalizedSpeechTranscript(results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>): string {
  return Array.from(results).filter((result) => result.isFinal)
    .map((result) => result[0]?.transcript.trim() ?? "")
    .filter(Boolean).join(" ").trim();
}
