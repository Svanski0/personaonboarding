import type { ConversationTopic } from "./persona";
import { isVoiceFailureReason, type VoiceFailureReason } from "./voice-action";

export type FieldStatus = "missing" | "attempted" | "provisional" | "confirmed" | "deferred";
export type ProfileField = "userName" | "helpNeed" | "google";
export type CallState = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "action_waiting" | "ended" | "error";
export type Turn = { id: string; role: "user" | "assistant"; text: string; source: "voice" | "text" | "system"; at: number };
export type Account = { email: string; sub: string };

export type OnboardingState = {
  version: 1;
  step: "setup" | "conversation" | "assistant";
  agentName: string;
  userName: string;
  profileRevision: number;
  userNameRevision: number;
  helpNeed: string;
  statuses: Record<ProfileField, FieldStatus>;
  turns: Turn[];
  topic: ConversationTopic;
  callState: CallState;
  muted: boolean;
  graduationReason?: "resolved" | "explicit_early";
};

export type FactUpdates = { userName?: string | null; helpNeed?: string | null };
export type Observation = {
  revision?: number;
  explicitUserNameCorrection?: boolean;
  updates?: FactUpdates;
  status?: Partial<Record<ProfileField, FieldStatus>>;
  attempted?: ProfileField[];
  deferred?: ProfileField[];
  topic?: ConversationTopic;
};

export type OnboardingAction =
  | { type: "agent-name"; value: string }
  | { type: "continue" }
  | { type: "hydrate"; value: OnboardingState }
  | { type: "turn"; value: Turn }
  | { type: "observe"; value: Observation }
  | { type: "edit"; field: "userName" | "helpNeed"; value: string }
  | { type: "account-status"; linked: boolean }
  | { type: "call-state"; value: Exclude<CallState, "error"> }
  | { type: "voice-failure"; reason: VoiceFailureReason }
  | { type: "mute"; value: boolean }
  | { type: "graduate"; reason?: "resolved" | "explicit_early" }
  | { type: "reset" };

export const initialOnboardingState: OnboardingState = {
  version: 1,
  step: "setup",
  agentName: "",
  userName: "",
  profileRevision: 0,
  userNameRevision: 0,
  helpNeed: "",
  statuses: { userName: "missing", helpNeed: "missing", google: "missing" },
  turns: [],
  topic: "personal",
  callState: "ready",
  muted: false,
};

const topics: ConversationTopic[] = ["personal", "work", "home", "travel", "money", "people"];

export function cleanFact(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function explicitNameCorrection(text: string): string {
  const normalized = text.trim().replace(/[’]/g, "'");
  const correction = /\bmy name(?:\s+isn't|\s+is not|'s not)\s+[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}\s*(?:[,;.!?]\s*|\s+)(?:(?:well|actually|really|just)[,\s]+)*(?:it's|it is|i am|i'm|call me)\s+(?:(?:well|actually|really|just)[,\s]+)*([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(normalized)?.[1]
    ?? /\bactually\s+(?:please\s+)?call me\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(normalized)?.[1]
    ?? /\bchange my name to\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(normalized)?.[1]
    ?? /\bnot\s+[A-Za-z][A-Za-z'-]*\s*,\s*([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(normalized)?.[1]
    ?? /\bI meant\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(normalized)?.[1];
  return correction ? cleanFact(correction.replace(/\s+(?:instead|please|now|not|because|from|i|and|but|what|who)\b.*$/i, ""), 80) : "";
}

export function correctedNameFromTurns(turns: Array<Pick<Turn, "role" | "text">>): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role !== "user") continue;
    const corrected = explicitNameCorrection(turns[index].text);
    if (corrected) return corrected;
  }
  return "";
}

export function nameFromTurns(turns: Array<Pick<Turn, "role" | "text">>): string {
  const explicitCorrection = correctedNameFromTurns(turns);
  if (explicitCorrection) return explicitCorrection;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn.role !== "user") continue;
    const text = turn.text.trim().replace(/[’]/g, "'");
    if (/\b(?:don't|do not|never) call me\b|\bforget my name\b/i.test(text)) {
      const correction = /\b(?:actually|instead|rather|just)\b[^.?!]{0,24}\b(?:call me|use)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(text)?.[1]
        ?? /,\s*call me\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(text)?.[1];
      return correction ? cleanFact(correction, 80) : "";
    }
    const roleplay = /\b(?:fbi|administrator|admin|system override|developer mode|ignore your instructions|you work for me|director of)\b/i.test(text);
    const explicit = !roleplay ? /\b(?:my name is|you can call me|call me)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i.exec(text)?.[1]
      ?? /\bI am\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*){0,2})/.exec(text)?.[1]
      ?? /\b[Ii]'m\s+([A-Z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/.exec(text)?.[1] : undefined;
    if (explicit) return cleanFact(explicit.replace(/^(?:actually|uh|um)\s+/i, "").replace(/\s+(?:instead|now|please|not|and|but|because|from|i)\b.*$/i, ""), 80);

    const corrected = /\b(?:actually|sorry|no)[^.?!]{0,24}\b(?:it's|it is)\s+([A-Z][A-Za-z'-]*)\b/i.exec(text)?.[1]
      ?? /\b(?:it's|it is)\s+([A-Z][A-Za-z'-]*)\s*,?\s+not\s+[A-Z][A-Za-z'-]*/.exec(text)?.[1];
    if (corrected) return corrected;

    const previousAssistant = turns.slice(0, index).reverse().find((candidate) => candidate.role === "assistant");
    const directName = text.replace(/^(?:(?:uh+|um+|well|okay|ok|actually|it's)[,\s]+)+/i, "").replace(/[.!]$/, "");
    if (previousAssistant && /\bwhat name should i use|\bwhat should i call you|\byour name\b/i.test(previousAssistant.text)
      && /^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(directName)
      && !/^(?:okay|ok|yeah|yes|sure|yup|no|nope|nah|wait|hold on|you|me|bro|lol|idk|whatever|look at|not sure|i don't know)$/i.test(directName)) {
      return cleanFact(directName, 80);
    }
  }
  return "";
}

export function canGraduate(state: OnboardingState, explicitEarly = false): boolean {
  return state.agentName.length > 0 && state.statuses.helpNeed === "confirmed" && validHelpNeed(state.helpNeed)
    && (explicitEarly || (state.userName.length > 0
      && state.statuses.userName === "confirmed"
      && (state.statuses.google === "confirmed" || state.statuses.google === "deferred")));
}

export type OnboardingObjective = "ASK_USER_NAME" | "DISCOVER_HELP_NEED" | "CONFIRM_HELP_NEED" | "CONNECT_GOOGLE" | "READY_TO_GRADUATE" | "OPTIONAL_CONVERSATION";

export function isRepetitionComplaint(message: string): boolean {
  return /\b(?:why are you repeating|you already asked|i already told you|why are you asking again|i just said that)\b/i.test(message);
}

export function isPersonaProductQuestion(message: string): boolean {
  return /\b(?:what is|what's|do you know what|tell me about)\s+persona\b/i.test(message);
}

export function isExplicitContinuationRequest(message: string): boolean {
  return /\b(?:keep (?:talking|chatting|going)|continue (?:talking|chatting)|one more thing|before we (?:finish|go)|not ready to (?:move on|finish)|stay on the call)\b/i.test(message);
}

export function isPauseIntent(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
  return /^(?:hey )?(?:(?:wait|hold on|hang on|one sec(?:ond)?|give me (?:a )?sec(?:ond)?|just a sec(?:ond)?|um+|uh+|hmm+|hm+|erm|let me think)(?: |$))+(?:please)?$/.test(normalized);
}

export function ambiguousOnboardingReply(message: string, state: OnboardingState): string | null {
  if (state.step === "assistant") return null;
  if (isPauseIntent(message)) return /\b(?:um+|uh+|hmm+|hm+|erm|let me think)\b/i.test(message) ? "Take your time." : "Sure.";
  const word = message.toLowerCase().replace(/[^a-z]/g, "").trim();
  if (["you", "me", "bro", "lol", "yes", "no", "okay", "ok", "yeah", "sure"].includes(word) || /^[.\s…]+$/.test(message)) {
    return getNextObjective(state) === "DISCOVER_HELP_NEED"
      ? "Me already? Give me one real thing you'd like help with."
      : deterministicOnboardingReply(state, message);
  }
  if (["idk", "dunno", "dontknow", "nothing"].includes(word)) return "That's okay. We could start with studying, your schedule, or staying organized. Which sounds closest?";
  if (word === "everything") return "Sounds like a lot. What's one thing you'd like to make easier first?";
  if (word === "what") return "I mean one thing that's been taking your time or energy lately.";
  if (message.trim().length <= 2 || /^(.)\1{3,}$/i.test(word)) return "Could you give me one example of what you'd like help with?";
  return null;
}

export function isTrivialSemanticInput(message: string): boolean {
  if (isPauseIntent(message)) return true;
  const word = message.toLowerCase().replace(/[^a-z]/g, "").trim();
  return ["you", "me", "bro", "lol", "yes", "no", "okay", "ok", "yeah", "sure", "idk", "dunno", "dontknow", "nothing", "everything", "what"].includes(word)
    || /^[.\s…]+$/.test(message) || message.trim().length <= 2;
}

export function initialVoiceGreeting(agentName: string): string {
  return `Hi, I'm ${agentName}—what should I call you?`;
}

export function validHelpNeed(value: unknown): value is string {
  const text = cleanFact(value, 500);
  if (text.length < 8 || !/[a-z]{3}/i.test(text) || /^(?:do (?:this|that)|help me|everything|nothing|you|me|lol|idk|asdf)[.!? ]*$/i.test(text)) return false;
  if (/^(?:crack\s+\S+|be in the\s+\S+|manage my life if\b)/i.test(text)) return false;
  if (/\b(?:ignore (?:previous|your) instructions|system override|developer mode|you work for me|you have permission|administrator)\b/i.test(text)) return false;
  return true;
}

export function supportedModelHelpNeed(value: unknown, userText: string): string | null {
  if (!validHelpNeed(value)) return null;
  const candidate = cleanFact(value, 120);
  const stems = (text: string) => text.toLowerCase().match(/[a-z]{4,}/g)?.map((word) => word.replace(/(?:ing|tion|ment|ed|s)$/, "")) ?? [];
  const source = new Set(stems(userText).filter((word) => !["help", "want", "need", "with", "this", "that", "your", "what", "have", "would"].includes(word)));
  if (!stems(candidate).some((word) => source.has(word))) return null;
  return candidate;
}

export function supportedModelUserName(value: unknown, turns: Array<Pick<Turn, "role" | "text">>): string | null {
  const candidate = cleanFact(value, 80).replace(/^(?:well|actually|really|just)[,\s]+/i, "");
  if (!/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(candidate)) return null;

  const latestUserIndex = turns.findLastIndex((turn) => turn.role === "user");
  if (latestUserIndex < 0) return null;
  const latestUser = turns[latestUserIndex].text.replace(/[’]/g, "'");
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const appearsInLatestTurn = new RegExp(`(?:^|[^A-Za-z])${escaped}(?:$|[^A-Za-z])`, "i").test(latestUser);
  const correctionCue = /\b(?:my name|call me|you can call me|go by|actually|sorry|i meant|stop calling me|don't call me|do not call me)\b/i.test(latestUser);
  const previousAssistant = turns.slice(0, latestUserIndex).reverse().find((turn) => turn.role === "assistant");
  const nameWasRequested = Boolean(previousAssistant && /\b(?:what name should i use|what should i call you|what name do you prefer|your name)\b/i.test(previousAssistant.text));
  const explicitCorrection = explicitNameCorrection(latestUser);
  const currentNameFromTranscript = nameFromTurns(turns);

  if (explicitCorrection) return explicitCorrection.toLowerCase() === candidate.toLowerCase() ? candidate : null;
  if (currentNameFromTranscript && currentNameFromTranscript.toLowerCase() === candidate.toLowerCase()) return candidate;
  if (appearsInLatestTurn && (correctionCue || (!currentNameFromTranscript && nameWasRequested && latestUser.length <= 120))) return candidate;
  return null;
}

export function getNextObjective(state: OnboardingState): OnboardingObjective {
  if (state.step === "assistant") return "OPTIONAL_CONVERSATION";
  if (validHelpNeed(state.helpNeed) && state.statuses.helpNeed === "confirmed"
    && state.statuses.google !== "confirmed" && state.statuses.google !== "deferred") return "CONNECT_GOOGLE";
  if (!state.userName) return "ASK_USER_NAME";
  if (!validHelpNeed(state.helpNeed)) return "DISCOVER_HELP_NEED";
  if (state.statuses.helpNeed === "provisional") return "CONFIRM_HELP_NEED";
  if (state.statuses.google !== "confirmed" && state.statuses.google !== "deferred") return "CONNECT_GOOGLE";
  return "READY_TO_GRADUATE";
}

function inferredNeed(message: string, conversationalContext = false): { value: string; status: "provisional" | "confirmed" } | null {
  const text = message.toLowerCase().replace(/[’]/g, "'");
  const corrections = [...text.matchAll(/\b(?:actually|instead|rather|not anymore|that's not what i meant|that is not what i meant|mostly)\b/gi)];
  const correction = corrections.at(-1);
  const source = correction?.index != null ? text.slice(correction.index + correction[0].length) : text;
  const explicitNeed = /\b(?:need help|help me|want help|could use help|struggling|overwhelmed|drowning|keep forgetting|forgetting|having (?:a lot of |trouble |a hard time)|taking (?:up )?(?:most of )?my time|spend(?:ing)? too much time|hard to keep up|can't keep up)\b/i.test(text);
  const topicMentioned = /\b(?:schoolwork|school work|homework|coursework|school|classes|SAT|emails?|inbox|deadlines?|college apps?|staying organized|organizing|organization|working out|workouts?|the gym|gym|studying|study|my job|work tasks?|working at work|work)\b/i.test(source);
  const personalFrame = /\b(?:i keep|i spend|busy with|a lot of|a lot lately|too much|all day|behind|on my plate|taking up .{0,20}(?:time|energy)|taking .{0,20}(?:time|energy)|can't keep up)\b/i.test(source);
  if (/\b(?:you work for me|ignore your instructions|system override|developer mode)\b/i.test(text)) return null;
  if (source.trim().endsWith("?") && !explicitNeed) return null;
  if (!explicitNeed && (!topicMentioned || !(personalFrame || conversationalContext || /\b(?:done a number on me|stressing me|wearing me down)\b/i.test(source)))) return null;

  const hasSchool = /\b(?:school\s*work|schoolwork|homework|coursework|classes|school)\b/i.test(source);
  const hasSat = /\b(?:SAT|test prep|standardized tests?)\b/i.test(source);
  const hasCollege = /\b(?:college|university)\s*(?:applications?|apps?)\b|\bcollege apps?\b/i.test(source);
  const hasTeacherEmail = /\bemail(?:s)?\b/i.test(source) && /\b(?:teachers?|professors?)\b/i.test(source)
    && /\b(?:forget\w*|forgot|miss\w*|lose track|too many|overwhelmed|organiz\w*|keep up)\b/i.test(source);
  const hasEmail = /\b(?:email|emails|inbox)\b/i.test(source);
  const hasDeadline = /\bdeadlines?\b/i.test(source);
  const hasOrganization = /\b(?:staying organized|organize|organized|organization|keep track|remembering)\b/i.test(source);
  const hasSchedule = /\b(?:schedule|scheduling|calendar)\b/i.test(source);
  const hasPlanningWeek = /\b(?:plan|planning)\s+my\s+week\b/i.test(source);
  const hasWorkout = /\b(?:working out|workouts?|the gym|gym|exercis(?:e|ing))\b/i.test(source);
  const hasStudying = /\b(?:studying|study)\b/i.test(source);
  const hasJob = /\b(?:my job|work tasks?|working at work)\b|(?<!school\s)(?<!home\s)\bwork\b/i.test(source);
  const parts: string[] = [];
  if (hasSchool) parts.push("schoolwork");
  if (hasSat) parts.push("SAT prep");
  if (hasCollege) parts.push("college applications");
  if (hasTeacherEmail) parts.push("teacher emails");
  else if (hasEmail) parts.push("email");
  if (hasDeadline) parts.push("deadlines");
  if (hasOrganization && !parts.some((part) => /organ|deadline|email/i.test(part))) parts.push("staying organized");
  if (hasSchedule && !parts.some((part) => /deadline|organiz/i.test(part))) parts.push("schedule management");
  if (hasPlanningWeek && !parts.length) parts.push("Plan my week");
  if (hasWorkout) parts.push("working out");
  if (hasStudying && !hasSat && !hasSchool) parts.push("studying");
  if (hasJob) parts.push("work tasks");

  if (!parts.length) return null;
  if (parts.length === 1 && parts[0] === "email") parts[0] = "email management";
  const value = parts.length === 1 ? parts[0][0].toUpperCase() + parts[0].slice(1)
    : parts.length === 2 ? `${parts[0][0].toUpperCase() + parts[0].slice(1)} and ${parts[1]}`
      : `${parts.slice(0, -1).map((part, index) => index === 0 ? part[0].toUpperCase() + part.slice(1) : part).join(", ")}, and ${parts.at(-1)}`;
  return { value, status: explicitNeed || /\b(?:done a number on me|stressing me|wearing me down)\b/i.test(source) ? "confirmed" : "provisional" };
}

export function extractUserFacts(message: string, turns: Array<Pick<Turn, "role" | "text">>, state: OnboardingState): Observation {
  const completeTurns = [...turns, { role: "user" as const, text: message }];
  const extractedName = nameFromTurns(completeTurns);
  const updates: FactUpdates = {};
  const status: Observation["status"] = {};
  const explicitUserNameCorrection = /\bmy name(?:\s+isn't|\s+is not|'s not)\b|\bactually\s+(?:please\s+)?call me\b|\bI meant\b|\bnot\s+[A-Za-z][A-Za-z'-]*\s*,\s*[A-Za-z]/i.test(message.replace(/[’]/g, "'"))
    || /\bchange my name to\b/i.test(message);
  if (extractedName && (extractedName !== state.userName || explicitUserNameCorrection)) updates.userName = extractedName;
  else if (!extractedName && state.userName && /\b(?:don't|do not|never) call me\b|\bforget my name\b/i.test(message)) updates.userName = null;
  if (updates.userName) status.userName = "confirmed";

  const needCorrection = /\b(?:actually|instead|not anymore|that's not what i meant|that is not what i meant|mostly)\b/i.test(message);
  const latestTurn = turns.at(-1);
  const conversationalContext = latestTurn?.role === "assistant"
    && /\b(?:what(?:'s| is| has)?[\w\s',-]{0,65}(?:taking|time|energy|help with|priority|pressure)|which[\w\s',-]{0,40}hardest)\b/i.test(latestTurn.text);
  const need = inferredNeed(message, conversationalContext);
  if (need && validHelpNeed(need.value) && (needCorrection || !state.helpNeed || need.status === "confirmed")) {
    updates.helpNeed = need.value;
    status.helpNeed = need.status;
  } else if (state.helpNeed && /\b(?:that's not what i meant|that is not what i meant|i don't need help with that|forget that goal)\b/i.test(message)) {
    updates.helpNeed = null;
    status.helpNeed = "missing";
  }

  const refusal = /\b(?:don't want to connect|do not want to connect|don't connect|do not connect|skip google|skip gmail|no google|no gmail)\b/i.test(message)
    || (state.statuses.google === "attempted" && /^(?:not now|no thanks|rather not|no|nope|nah)[.! ]*$/i.test(message.trim()));
  const attempted: ProfileField[] = [];
  const deferred: ProfileField[] = [];
  if (refusal) deferred.push("google");
  return { updates: Object.keys(updates).length ? updates : undefined, status, attempted, deferred, topic: undefined, explicitUserNameCorrection };
}

export function deterministicOnboardingReply(state: OnboardingState, message = ""): string {
  if (isPauseIntent(message)) return "Take your time.";
  if (state.userName && /\bwhat(?:'s| is) my name\b/i.test(message)) return `Your name is ${state.userName}.`;
  if (isPersonaProductQuestion(message)) {
    const bridge = state.helpNeed ? ` You mentioned ${state.helpNeed.toLowerCase()}, so we can pick that back up.`
      : state.userName ? ` ${state.userName}, what's been taking the most time or energy for you lately?`
        : " What's a name you'd like me to use?";
    return `Persona is the assistant you're setting up right now. I'm your agent inside it.${bridge}`;
  }
  const objective = getNextObjective(state);
  if (isRepetitionComplaint(message)) {
    if (state.helpNeed) return `You're right—you already told me about ${state.helpNeed}. I've got it. Let's move on from that.`;
    if (state.userName) return `You're right, I have your name as ${state.userName}. I'll keep going from there.`;
  }
  switch (objective) {
    case "ASK_USER_NAME":
      return state.helpNeed ? `That sounds like a lot to juggle. What's a name you'd like me to use?` : "What's a name you'd like me to use? You can also tell me what's been taking up your time.";
    case "DISCOVER_HELP_NEED":
      return `Nice to meet you, ${state.userName}. What's been taking the most time or energy in your week lately?`;
    case "CONFIRM_HELP_NEED":
      return `So ${state.helpNeed} is the main thing right now?`;
    case "CONNECT_GOOGLE":
      return `Got it, ${state.helpNeed}. Want to connect Google so I can help?`;
    case "READY_TO_GRADUATE":
      return "You're all set" + (state.userName ? ", " + state.userName : "") + ". Let's get started.";
    case "OPTIONAL_CONVERSATION":
      return "What would be most useful to tackle first?";
  }
}

export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "agent-name":
      return { ...state, agentName: action.value.slice(0, 32) };
    case "continue": {
      const agentName = cleanFact(state.agentName, 32);
      return agentName ? { ...state, agentName, step: "conversation" } : state;
    }
    case "hydrate":
      return action.value;
    case "turn":
      if (state.turns.some((turn) => turn.id === action.value.id)) return state;
      return { ...state, turns: [...state.turns, action.value].slice(-40) };
    case "observe": {
      if (state.step === "assistant") return state;
      const statuses = { ...state.statuses };
      for (const [field, status] of Object.entries(action.value.status ?? {}) as Array<[ProfileField, FieldStatus]>) {
        if (field !== "google" && status && ["missing", "provisional", "confirmed"].includes(status)) statuses[field] = status;
      }
      for (const field of action.value.attempted ?? []) {
        if (statuses[field] === "missing") statuses[field] = "attempted";
      }
      for (const field of action.value.deferred ?? []) {
        if (field === "google" && statuses[field] !== "confirmed") statuses[field] = "deferred";
      }
      const userName = action.value.updates?.userName === undefined
        ? state.userName : cleanFact(action.value.updates.userName, 80);
      const nameWriteIsStale = action.value.revision !== undefined && action.value.revision < state.userNameRevision;
      const acceptedUserName = nameWriteIsStale ? state.userName : userName;
      const proposedNeed = action.value.updates?.helpNeed === undefined
        ? state.helpNeed : cleanFact(action.value.updates.helpNeed, 500);
      const helpNeed = proposedNeed && !validHelpNeed(proposedNeed) ? state.helpNeed : proposedNeed;
      if (nameWriteIsStale) statuses.userName = state.statuses.userName;
      else if (action.value.updates?.userName === null) statuses.userName = "missing";
      if (action.value.updates?.helpNeed === null) statuses.helpNeed = "missing";
      if (!nameWriteIsStale && acceptedUserName && action.value.status?.userName !== "provisional") statuses.userName = "confirmed";
      if (helpNeed && action.value.status?.helpNeed !== "provisional") statuses.helpNeed = "confirmed";
      if (!nameWriteIsStale && acceptedUserName && action.value.status?.userName === "provisional") statuses.userName = "provisional";
      if (helpNeed && action.value.status?.helpNeed === "provisional") statuses.helpNeed = "provisional";
      if (!nameWriteIsStale && !acceptedUserName && (statuses.userName === "confirmed" || statuses.userName === "provisional")) statuses.userName = "missing";
      if (!helpNeed && (statuses.helpNeed === "confirmed" || statuses.helpNeed === "provisional")) statuses.helpNeed = "missing";
      return {
        ...state,
        userName: acceptedUserName,
        profileRevision: Math.max(state.profileRevision, action.value.revision ?? state.profileRevision),
        userNameRevision: nameWriteIsStale ? state.userNameRevision : action.value.revision ?? state.userNameRevision,
        helpNeed,
        statuses,
        topic: action.value.topic && topics.includes(action.value.topic) ? action.value.topic : state.topic,
      };
    }
    case "edit": {
      const proposed = cleanFact(action.value, action.field === "userName" ? 80 : 500);
      const value = action.field === "helpNeed" && proposed && !validHelpNeed(proposed) ? state.helpNeed : proposed;
      return {
        ...state,
        [action.field]: value,
        ...(action.field === "userName" ? { userNameRevision: state.profileRevision + 1, profileRevision: state.profileRevision + 1 } : {}),
        statuses: { ...state.statuses, [action.field]: value ? "confirmed" : "missing" },
      };
    }
    case "account-status":
      return { ...state, statuses: { ...state.statuses, google: action.linked ? "confirmed" : "missing" } };
    case "call-state":
      if ((action.value as CallState) === "error") return state;
      return { ...state, callState: action.value };
    case "voice-failure":
      return isVoiceFailureReason(action.reason) ? { ...state, callState: "error" } : state;
    case "mute":
      return { ...state, muted: action.value };
    case "graduate":
      return state.step !== "assistant" && canGraduate(state, action.reason === "explicit_early")
        ? { ...state, step: "assistant", callState: "ended", graduationReason: action.reason ?? "resolved" } : state;
    case "reset":
      return initialOnboardingState;
    default:
      return state;
  }
}

export function restoreOnboarding(value: string | null): OnboardingState | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed) || parsed.version !== 1) return null;
    const input = parsed as Partial<OnboardingState>;
    if (typeof input.agentName !== "string" || !Array.isArray(input.turns)) return null;
    const statuses = input.statuses ?? initialOnboardingState.statuses;
    const restoredTurns = input.turns.slice(-40).flatMap((candidate, index): Turn[] => {
      if (!candidate || typeof candidate.text !== "string" || (candidate.role !== "user" && candidate.role !== "assistant")) return [];
      const text = cleanFact(candidate.text, 3000);
      if (!text) return [];
      return [{
        id: typeof candidate.id === "string" && candidate.id ? candidate.id : `restored-${index}`,
        role: candidate.role,
        text,
        source: candidate.source === "voice" || candidate.source === "text" ? candidate.source : "system",
        at: Number.isFinite(candidate.at) ? candidate.at : 0,
      }];
    });
    const correctedName = correctedNameFromTurns(restoredTurns);
    const hasVoiceHistory = restoredTurns.some((turn) => turn.source === "voice");
    const agentName = cleanFact(input.agentName, 32);
    const userName = correctedName || cleanFact(input.userName, 80) || nameFromTurns(restoredTurns);
    const proposedNeed = cleanFact(input.helpNeed, 500);
    const helpNeed = validHelpNeed(proposedNeed) ? proposedNeed : "";
    const fieldStatus = (field: "userName" | "helpNeed", fact: string): FieldStatus => {
      if (fact) return statuses[field] === "provisional" ? "provisional" : "confirmed";
      return statuses[field] === "deferred" ? "deferred" : statuses[field] === "attempted" ? "attempted" : "missing";
    };
    return {
      ...initialOnboardingState,
      version: 1,
      step: !agentName ? "setup" : input.step === "assistant" && helpNeed && statuses.helpNeed === "confirmed"
        && (input.graduationReason === "explicit_early" || input.graduationReason === "resolved" && statuses.google === "deferred")
        ? "assistant" : "conversation",
      agentName,
      userName,
      profileRevision: Number.isSafeInteger(input.profileRevision) && (input.profileRevision ?? 0) >= 0 ? input.profileRevision! : restoredTurns.length,
      userNameRevision: Number.isSafeInteger(input.userNameRevision) && (input.userNameRevision ?? 0) >= 0 ? input.userNameRevision! : restoredTurns.length,
      helpNeed,
      statuses: {
        userName: fieldStatus("userName", userName),
        helpNeed: fieldStatus("helpNeed", helpNeed),
        google: statuses.google === "attempted" ? "attempted" : statuses.google === "deferred" ? "deferred" : "missing",
      },
      turns: restoredTurns,
      topic: input.topic && topics.includes(input.topic) ? input.topic : "personal",
      callState: hasVoiceHistory ? "ended" : "ready",
      muted: false,
      graduationReason: input.graduationReason === "explicit_early" || input.graduationReason === "resolved" ? input.graduationReason : undefined,
    };
  } catch {
    return null;
  }
}
