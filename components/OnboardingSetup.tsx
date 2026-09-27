"use client";

import { useEffect, useRef, useState } from "react";
import { PersonaWordmark } from "./PersonaWordmark";
import { prepareParticleTransition, transitionToCall } from "../lib/particle-transition";

type OnboardingSetupProps = {
  name: string;
  onNameChange: (value: string) => void;
  onBeginCall: (agentName: string) => void;
  onContinue: () => void;
};

const suggestions = ["Nova", "Atlas", "Echo", "Orion", "Halo"];

export function OnboardingSetup({ name, onNameChange, onBeginCall, onContinue }: OnboardingSetupProps) {
  const transitioning = useRef(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [suggestion, setSuggestion] = useState(suggestions[0]);
  const [suggestionPhase, setSuggestionPhase] = useState<"hold" | "erase" | "type">("hold");
  const hasCustomName = name.trim().length > 0;

  useEffect(() => {
    void prepareParticleTransition().catch(() => undefined);
    const timer = window.setTimeout(() => {
      const root = document.querySelector<HTMLElement>(".setup-screen");
      if (root) void prepareParticleTransition(root).catch(() => undefined);
    }, 320);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!name.trim()) return;
    const timer = window.setTimeout(() => {
      const root = document.querySelector<HTMLElement>(".setup-screen");
      if (root) void prepareParticleTransition(root).catch(() => undefined);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [name]);

  useEffect(() => {
    if (name.trim()) return;
    const target = suggestions[suggestionIndex];
    const delay = suggestionPhase === "hold" ? 5000 : suggestionPhase === "erase" ? 58 : 104;
    const timer = window.setTimeout(() => {
      if (suggestionPhase === "hold") {
        setSuggestionPhase("erase");
      } else if (suggestionPhase === "erase") {
        if (suggestion.length) setSuggestion((current) => current.slice(0, -1));
        else {
          setSuggestionIndex((current) => (current + 1) % suggestions.length);
          setSuggestionPhase("type");
        }
      } else if (suggestion.length < target.length) {
        setSuggestion(target.slice(0, suggestion.length + 1));
      } else {
        setSuggestionPhase("hold");
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [name, suggestion, suggestionIndex, suggestionPhase]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (transitioning.current) return;
    transitioning.current = true;
    const agentName = hasCustomName ? name.trim() : suggestion;
    onBeginCall(agentName);
    void transitionToCall(() => {
      if (!hasCustomName) onNameChange(agentName);
      onContinue();
    }).finally(() => { transitioning.current = false; });
  }

  return (
    <section className="setup-screen screen-enter" aria-labelledby="setup-title">
      <header className="page-header">
        <a className="wordmark-link" href="#main" aria-label="Persona home">
          <PersonaWordmark />
        </a>
      </header>

      <main id="main" className="setup-main">
        <div className="setup-content">
          <h1 id="setup-title" className="setup-title">Name your Persona.</h1>

          <form className="name-form" onSubmit={handleSubmit}>
            <div className="name-field">
              <input
                aria-label="Persona name"
                autoComplete="off"
                id="persona-name"
                name="persona-name"
                type="text"
                maxLength={32}
                placeholder={suggestion}
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
              />
            </div>
            <button className={`primary-button setup-continue-button${hasCustomName ? " setup-continue-button--named" : ""}`} type="submit">
              Continue
            </button>
          </form>
        </div>
      </main>
    </section>
  );
}
