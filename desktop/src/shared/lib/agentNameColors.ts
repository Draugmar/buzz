import type { CSSProperties } from "react";

export const AGENT_NAME_COLOR_IDS = [
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
] as const;

export type AgentNameColorId = (typeof AGENT_NAME_COLOR_IDS)[number];

function isAgentNameColorId(value: string): value is AgentNameColorId {
  return (AGENT_NAME_COLOR_IDS as readonly string[]).includes(value);
}

/**
 * Style to apply to an agent's name text. Unset/unknown colors return `{}`,
 * preserving whatever theme-derived color the element already has.
 */
export function getAgentNameColorStyle(
  nameColor?: string | null,
): CSSProperties {
  if (!nameColor || !isAgentNameColorId(nameColor)) {
    return {};
  }
  return { color: `var(--agent-color-${nameColor})` };
}
