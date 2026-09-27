import { Mic, MicOff, PhoneOff } from "lucide-react";
import type { CallState } from "../lib/onboarding";

type Props = {
  state: CallState;
  muted: boolean;
  onStart: () => void;
  onMute: () => void;
  onEnd: () => void;
};

export function CallControls({ state, muted, onStart, onMute, onEnd }: Props) {
  const active = state !== "ready" && state !== "ended" && state !== "error";

  return (
    <div className={`call-controls-shell${active ? " call-controls-shell--active" : ""}`}>
      <button className="primary-button call-start-button" type="button" onClick={onStart} disabled={active} aria-hidden={active} tabIndex={active ? -1 : 0}><Mic size={17} /> {state === "ready" ? "Start a call" : "Resume call"}</button>
      <div className="call-control-row" aria-label="Call controls" aria-hidden={!active}>
        <button className={`icon-control${muted ? " icon-control--muted" : ""}`} type="button" onClick={onMute} disabled={!active} aria-label={muted ? "Turn microphone on" : "Mute microphone"} title={muted ? "Turn microphone on" : "Mute microphone"} aria-pressed={muted}>
          {muted ? <MicOff size={21} /> : <Mic size={21} />}
        </button>
        <button className="icon-control icon-control--end" type="button" onClick={() => onEnd()} disabled={!active} aria-label="End call" title="End call"><PhoneOff size={20} /></button>
      </div>
    </div>
  );
}
