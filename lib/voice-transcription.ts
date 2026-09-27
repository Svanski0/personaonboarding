export type CanonicalTranscript = {
  utteranceId: number;
  text: string;
  source: "gemini" | "browser";
  browserText: string;
  geminiText: string;
};

type Utterance = {
  id: number;
  browserText: string;
  geminiText: string;
  finalized: CanonicalTranscript | null;
  finalizedAt: number;
};

export class VoiceUtteranceTracker {
  private sequence = 0;
  private current: Utterance | null = null;

  beginActivity(source: "browser" | "gemini" = "browser", now = 0): number {
    if (!this.current || (this.current.finalized && !(source === "gemini" && this.current.finalized.source === "browser" && now >= this.current.finalizedAt && now - this.current.finalizedAt < 4000))) {
      this.current = this.newUtterance();
    }
    return this.current.id;
  }

  noteBrowser(text: string): number {
    const utterance = this.current ?? (this.current = this.newUtterance());
    utterance.browserText = text.trim();
    return utterance.id;
  }

  noteGemini(text: string): number {
    const utterance = this.current ?? (this.current = this.newUtterance());
    if (!utterance.finalized) utterance.geminiText = text.trim();
    return utterance.id;
  }

  finalizeGemini(text: string, now: number): CanonicalTranscript | null {
    let utterance = this.current ?? (this.current = this.newUtterance());
    if (utterance.finalized) {
      if (utterance.finalized.source === "browser" && now - utterance.finalizedAt < 4000) {
        utterance.geminiText = text.trim();
        return null;
      }
      if (utterance.finalized.text.toLowerCase() === text.trim().toLowerCase() && now - utterance.finalizedAt < 4000) return null;
      utterance = this.current = this.newUtterance();
    }
    utterance.geminiText = text.trim();
    return this.finalize(utterance, "gemini", now);
  }

  finalizeBrowser(now: number): CanonicalTranscript | null {
    const utterance = this.current;
    return utterance && !utterance.finalized ? this.finalize(utterance, "browser", now) : null;
  }

  snapshot(): { utteranceId: number; browserText: string; geminiText: string; finalized: CanonicalTranscript | null } | null {
    const utterance = this.current;
    return utterance ? { utteranceId: utterance.id, browserText: utterance.browserText, geminiText: utterance.geminiText, finalized: utterance.finalized } : null;
  }

  reset(): void { this.current = null; }

  private newUtterance(): Utterance {
    return { id: ++this.sequence, browserText: "", geminiText: "", finalized: null, finalizedAt: 0 };
  }

  private finalize(utterance: Utterance, source: CanonicalTranscript["source"], now: number): CanonicalTranscript | null {
    const text = (source === "gemini" ? utterance.geminiText : utterance.browserText).trim();
    if (!text) return null;
    const result = { utteranceId: utterance.id, text, source, browserText: utterance.browserText, geminiText: utterance.geminiText };
    utterance.finalized = result;
    utterance.finalizedAt = now;
    return result;
  }
}
