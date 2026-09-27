export type ConversationTopic = "personal" | "work" | "home" | "travel" | "money" | "people";

export const conversationTopics: Record<ConversationTopic, { label: string; color: string; glow: string }> = {
  personal: { label: "Personal", color: "#171716", glow: "rgba(23, 23, 22, 0.2)" },
  work: { label: "Work", color: "#4e7f98", glow: "rgba(78, 127, 152, 0.25)" },
  home: { label: "Home", color: "#627f54", glow: "rgba(98, 127, 84, 0.25)" },
  travel: { label: "Travel", color: "#c66545", glow: "rgba(198, 101, 69, 0.25)" },
  money: { label: "Money", color: "#9a772f", glow: "rgba(154, 119, 47, 0.25)" },
  people: { label: "People", color: "#ad6370", glow: "rgba(173, 99, 112, 0.25)" },
};

export function inferConversationTopic(message: string): ConversationTopic {
  const patterns: Array<[ConversationTopic, RegExp]> = [
    ["work", /\b(work|office|project|deadline|meeting|job|study|class|school|exam|career|client|focus)\b/i],
    ["home", /\b(home|family|house|clean|laundry|grocer|grocery|dinner|chores|household)\b/i],
    ["travel", /\b(travel|trip|flight|hotel|vacation|holiday|airport|weekend away|road trip)\b/i],
    ["money", /\b(money|bill|budget|bank|expense|subscription|payment|save|spending|rent)\b/i],
    ["people", /\b(friend|partner|relationship|people|birthday|conversation|call my|text my)\b/i],
  ];

  return patterns.find(([, pattern]) => pattern.test(message))?.[0] ?? "personal";
}
