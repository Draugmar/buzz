---
title: "Agent Name Color Design"
tags: [agents, desktop, design]
status: active
created: 2026-07-30
---

# Agent Name Color

## Problem

Agent identity in the desktop app (name text in messages, @-mention pills, agent
lists, badges, etc.) has no per-agent color today — it's entirely theme-derived
(`hsl(var(--foreground))`, `hsl(var(--primary))`). Two agents in the same
conversation are visually indistinguishable by name color alone. Per-agent
avatar background color already exists (`AVATAR_COLORS` in
`ProfileAvatarEditor.utils.ts`) but that's a separate concept (avatar fill),
not the name text.

## Goal

Let a user pick one of a fixed set of 16 colors per agent, in the
create/edit-agent dialog, that colors that agent's name text everywhere it
appears in the desktop app. Agents with no color chosen (all existing agents,
by default) keep exactly today's look.

## Data Model

- `AgentPersona` / `CreatePersonaInput` / `UpdatePersonaInput`
  (`desktop/src/shared/api/types.ts`): new optional field `nameColor: string | null`,
  holding one of the 16 fixed palette ids (e.g. `"blue"`) or `null`/absent.
- `AgentDefinition` (`desktop/src-tauri/src/managed_agents/types.rs`): mirrored
  Rust field `name_color: Option<String>`, `#[serde(default)]` so existing
  on-disk agent JSON (with no such field) deserializes to `None` with no
  migration step.
- Not published as a Nostr event. The agent definition (name, instructions,
  harness, model, parallelism, env vars, avatar, and now name color) is local,
  file-based JSON persisted via `save_personas`/`load_personas`
  (`desktop/src-tauri/src/managed_agents/{personas,storage}.rs`). `kind:10100`
  is a separate, narrower concept (`channel_add_policy` only) and is untouched
  by this feature.

## Palette

16 fixed, named colors — no free hex input. Each has a light-theme and
dark-theme hex value (Tailwind 600/400 shades), chosen for legible text
contrast against both light and dark backgrounds — the same convention tools
like Linear/GitHub use for colored identity text:

| id | light | dark |
|---|---|---|
| red | #dc2626 | #f87171 |
| orange | #ea580c | #fb923c |
| amber | #d97706 | #fbbf24 |
| yellow | #ca8a04 | #facc15 |
| lime | #65a30d | #a3e635 |
| green | #16a34a | #4ade80 |
| emerald | #059669 | #34d399 |
| teal | #0d9488 | #2dd4bf |
| cyan | #0891b2 | #22d3ee |
| sky | #0284c7 | #38bdf8 |
| blue | #2563eb | #60a5fa |
| indigo | #4f46e5 | #818cf8 |
| violet | #7c3aed | #a78bfa |
| purple | #9333ea | #c084fc |
| fuchsia | #c026d3 | #e879f9 |
| pink | #db2777 | #f472b6 |

Defined as CSS custom properties (`--agent-color-red`, ...) in the global
stylesheet, with `.dark` overrides — the same mechanism the app already uses
for theme tokens (`hsl(var(--primary))`). Consumers never branch on theme in
JS; `var(--agent-color-<id>)` always resolves to the right shade.

## Backend Validation

`create_persona` / `update_persona`
(`desktop/src-tauri/src/commands/personas/{create,update}.rs`) validate
`name_color`, when present, against the fixed list of 16 ids and reject
unknown values with an error — consistent with how these commands already
validate other fields. `save_personas`/`load_personas` require no changes
beyond the new optional struct field.

## Frontend

**Selector**: new control in `AgentCreationPreview.tsx`
(`desktop/src/features/agents/ui/`), next to the existing avatar
emoji/color picker — a 16-swatch grid plus a "no color" (default) option,
mirroring the `AVATAR_COLORS` swatch UI pattern already in
`ProfileAvatarEditor.utils.ts`.

**Shared helper**: one pure function, e.g.
`getAgentNameColorStyle(nameColor?: string | null): CSSProperties`, returning
`{ color: 'var(--agent-color-<id>)' }` for a valid id or `{}` when absent.
Every consumer calls this over the persona object it already has in hand (the
same object it reads `displayName`/`avatarUrl` from today) — no new data
fetching or lookup path.

**Surfaces updated** (13, all identified during design research; each applies
the helper's style to its existing name element without changing structure or
classes):

1. `MessageHeader.tsx` (`MessageAuthorText`) — message author name
2. Mention pill: `markdown.css` (`.mention-chip`) + `mentionHighlightExtension.ts`
   (rendered mention in a sent message) + `MentionAutocomplete.tsx` (dropdown
   row) — chip text uses the color var directly, chip background uses
   `color-mix(in srgb, var(--agent-color-<id>) 15%, transparent)`, mirroring
   the existing `hsl(var(--primary) / 0.15)` treatment
3. `AgentIdentityCard.tsx` — agent settings grid card name
4. `ManagedAgentRow.tsx` — agent management list row name
5. `MembersSidebarMemberCard.tsx` — channel member list name
6. `MessageAgentOwner.tsx` — "managed by" badge name
7. `NewMessageResultRow.tsx` — new-DM directory row name
8. `MembersSidebar.tsx` (`AddMemberSearchResultRow`) — add-member search row name
9. `ParticipantList.tsx` (huddle) — huddle participant name
10. `BotActivityBar.tsx` — "N agents working" popover row name
11. `TypingIndicatorRow.tsx` — typing indicator name
12. `AgentActivityCard.tsx` (Pulse) — activity feed card name
13. `QuickBotBar.tsx` — quick-add bot tooltip name

## Error Handling

- Unknown/invalid `name_color` value from the frontend: rejected at the Rust
  command layer (same pattern as other field validation), never persisted.
- Missing/`null` `name_color`: every consumer's helper call degrades to `{}`,
  i.e. today's exact behavior (theme-derived color). No separate "default
  color" code path to maintain.

## Testing

- Rust: unit test rejecting an out-of-palette `name_color`; unit test
  confirming an agent JSON blob without the field deserializes with
  `name_color: None`.
- Frontend: unit test for `getAgentNameColorStyle` — valid id → style object
  with the right CSS var; `null`/`undefined`/unknown id → `{}`.
- Manual verification: set distinct colors on two agents in a running build,
  confirm the color shows correctly in a message, in a rendered mention, and
  in the agent settings list, in both light and dark theme.

## Rollout

Purely additive optional field — no data migration, no feature flag. Existing
agents are unaffected until a user explicitly picks a color for them.
