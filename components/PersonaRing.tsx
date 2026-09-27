import type { CSSProperties } from "react";
import type { ConversationTopic } from "../lib/persona";
import type { CallState } from "../lib/onboarding";
import { conversationTopics } from "../lib/persona";

type PersonaRingProps = {
  state: CallState;
  topic: ConversationTopic;
  dimmed?: boolean;
  signal?: number;
  reaction?: "captured-info" | "action-required" | "success";
};

export function PersonaRing({ state, topic, dimmed = false, signal = 0, reaction }: PersonaRingProps) {
  const appearance = conversationTopics[topic];

  return (
    <div
      className={`persona-ring persona-ring--${state}${dimmed ? " persona-ring--dimmed" : ""}${reaction ? ` persona-ring--${reaction}` : ""}`}
      style={{ "--ring-accent": appearance.color, "--ring-glow": appearance.glow } as CSSProperties}
      role="img"
      aria-label={`Persona ring${dimmed ? ", call ended" : `, ${state}, about ${appearance.label}`}`}
    >
      {signal > 0 && <span key={signal} className="persona-ring__echo" aria-hidden="true" />}
      <span className="persona-ring__light" aria-hidden="true" />
    </div>
  );
}
