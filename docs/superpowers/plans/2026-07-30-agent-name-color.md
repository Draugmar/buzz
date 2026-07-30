# Agent Name Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick one of 16 fixed colors per agent (in the create/edit-agent dialog) that colors that agent's name text in the message header, the @-mention pill (composer + rendered), and the agent management surfaces (identity card, management row, channel member list, bot-activity bar).

**Architecture:** A new optional `nameColor: string | null` field travels end-to-end through the existing local-JSON persona/agent-record pipeline (`AgentDefinition` → `ManagedAgentRecord` → `ManagedAgentSummary` → frontend `AgentPersona`/`ManagedAgent`), validated against a fixed 16-id palette on the Rust side. The palette itself is defined once as CSS custom properties (`--agent-color-<id>`, with `.dark` overrides) so every consumer applies `color: var(--agent-color-<id>)` without any theme-detection logic. `nameColor: null` (every existing agent, today) is a pure no-op — current behavior is unchanged.

**Tech Stack:** Rust/Tauri backend (`desktop/src-tauri`), React/TypeScript frontend (`desktop/src`), TipTap/ProseMirror for the mention decorations, Node's built-in `node:test` for frontend unit tests, Rust's built-in `#[test]` for backend unit tests.

## Global Constraints

- Palette is exactly these 16 ids, in this order, each with a light and dark hex (Tailwind 600/400 shades) — copied verbatim from the approved design spec (`docs/superpowers/specs/2026-07-30-agent-name-color-design.md`):

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

- `nameColor`/`name_color` is `null`/absent by default. No data migration, no feature flag.
- Scope is the 8 surfaces confirmed with the user (message author name, mention autocomplete row, rendered mention chip, `AgentIdentityCard`, `ManagedAgentRow`, `MembersSidebarMemberCard` bot rows, `BotActivityBar`). Explicitly OUT of scope: `MessageAgentOwner` (renders the human owner, not the agent), `QuickBotBar` (no name text to color), huddle participants, typing indicator, `NewMessageResultRow`/`MembersSidebar` add-member rows (all three need new pubkey→color lookup infrastructure the persona model doesn't provide today — a separate follow-up).
- `name_color` is NOT part of the Nostr kind:30175 persona-catalog wire event (`persona_event_content`/`persona_from_event`) — it's a local-only display preference. A persona copied from another owner's shared catalog, or a team member imported from a snapshot, starts with `name_color: None` regardless of what the original owner had chosen.
- `name_color` on a `ManagedAgentRecord` is a create-time snapshot from its linked persona (same semantics as `system_prompt`/`model`/`provider`), NOT live-propagated on persona edit (unlike `avatar_url`/`display_name`, which the codebase already special-cases as relay-published identity fields). This is a deliberate simplification: `name_color` is a local UI-only value, so there is no relay-consistency reason to force a sync.
- Backend crate is `buzz-desktop` (`desktop/src-tauri/Cargo.toml`). Run backend tests with `cargo test -p buzz-desktop <filter>` from the repo root. Run frontend tests with `pnpm --filter buzz-desktop test` or (from `desktop/`) `pnpm test` (uses `node --import ./test-loader.mjs --experimental-strip-types --test "src/**/*.test.mjs"`).

---

## Task 1: Backend — palette module, core struct fields, commands

**Files:**
- Create: `desktop/src-tauri/src/managed_agents/name_color.rs`
- Modify: `desktop/src-tauri/src/managed_agents/mod.rs` (register the new module — grep for how sibling modules like `mod personas;` are declared/re-exported and mirror it)
- Modify: `desktop/src-tauri/src/managed_agents/types.rs` (add field to `AgentDefinition`, `ManagedAgentRecord`, `ManagedAgentSummary`; update `into_agent_record`/`to_definition_view`)
- Modify: `desktop/src-tauri/src/managed_agents/types/requests.rs` (add field to `CreatePersonaRequest`, `UpdatePersonaRequest`)
- Modify: `desktop/src-tauri/src/commands/personas/create.rs`
- Modify: `desktop/src-tauri/src/commands/personas/update.rs`
- Modify: `desktop/src-tauri/src/managed_agents/types/tests.rs` (`sample_persona()` fixture + one round-trip test)

**Interfaces:**
- Produces: `pub const AGENT_NAME_COLORS: [&str; 16]` and `pub fn validate_agent_name_color(value: Option<String>) -> Result<Option<String>, String>` in `managed_agents::name_color`, re-exported as `crate::managed_agents::{validate_agent_name_color, AGENT_NAME_COLORS}`. `AgentDefinition.name_color: Option<String>`, `ManagedAgentRecord.name_color: Option<String>`, `ManagedAgentSummary.name_color: Option<String>`. `CreatePersonaRequest.name_color: Option<String>`, `UpdatePersonaRequest.name_color: Option<String>`.
- Consumes: nothing new from other tasks (this is the foundation task).

- [ ] **Step 1: Write the failing test for the validator**

Create `desktop/src-tauri/src/managed_agents/name_color.rs`:

```rust
//! Fixed 16-color palette a user can assign to an agent's display name.
//! Purely a local display preference — never published to a relay.

pub const AGENT_NAME_COLORS: [&str; 16] = [
    "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
    "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink",
];

/// Validate a candidate `name_color`. `None` (no color chosen) is always
/// valid. `Some(id)` must be one of the 16 fixed palette ids — an unknown id
/// is rejected rather than silently dropped, so a typo'd frontend payload
/// fails loudly instead of the agent silently losing its chosen color.
pub fn validate_agent_name_color(value: Option<String>) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(id) if AGENT_NAME_COLORS.contains(&id.as_str()) => Ok(Some(id)),
        Some(id) => Err(format!(
            "name_color '{id}' is not a recognized color (expected one of: {})",
            AGENT_NAME_COLORS.join(", ")
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_none() {
        assert_eq!(validate_agent_name_color(None), Ok(None));
    }

    #[test]
    fn accepts_a_palette_id() {
        assert_eq!(
            validate_agent_name_color(Some("blue".to_string())),
            Ok(Some("blue".to_string()))
        );
    }

    #[test]
    fn rejects_an_unknown_id() {
        let result = validate_agent_name_color(Some("burnt-sienna".to_string()));
        assert!(result.is_err());
    }
}
```

- [ ] **Step 2: Run the new tests to verify they pass (this module has no callers yet, so nothing else can fail)**

Run: `cargo test -p buzz-desktop name_color::tests`
Expected: PASS (3 tests)

- [ ] **Step 3: Register the module**

Open `desktop/src-tauri/src/managed_agents/mod.rs`, find the existing `mod personas;` (or equivalent) declaration and its `pub use` re-export line, and add a matching pair:

```rust
mod name_color;
pub use name_color::{validate_agent_name_color, AGENT_NAME_COLORS};
```

- [ ] **Step 4: Add `name_color` to the three core structs**

In `desktop/src-tauri/src/managed_agents/types.rs`:

Add right after `pub avatar_url: Option<String>,` in `AgentDefinition` (currently line 19):
```rust
    /// One of the 16 fixed palette ids (see `managed_agents::name_color`),
    /// or `None` if the user hasn't chosen a color. Purely local display
    /// state — never published to a relay.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color: Option<String>,
```

Add right after `pub avatar_url: Option<String>,` in `ManagedAgentRecord` (currently line 245, inside the doc-commented block ending `#[serde(default)]\n    pub avatar_url: Option<String>,`):
```rust
    /// Snapshot of the linked persona's `name_color` at creation time (same
    /// snapshot semantics as `system_prompt`/`model`/`provider` — NOT
    /// live-propagated on persona edit, since this is a local-only display
    /// preference with no relay-consistency requirement).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_color: Option<String>,
```

Add right after `pub avatar_url: Option<String>,` in `ManagedAgentSummary` (currently line 523):
```rust
    pub name_color: Option<String>,
```
(No `skip_serializing_if` here — every other plain-optional field on `ManagedAgentSummary`, e.g. `runtime`, `team_id`, serializes unconditionally; match that convention so the frontend always receives the key.)

Update `AgentDefinition::into_agent_record` (the `ManagedAgentRecord { ... }` literal inside `impl AgentDefinition`, currently around line 101): add `name_color: self.name_color,` (place it next to `avatar_url: self.avatar_url,` at line 108).

Update `ManagedAgentRecord::to_definition_view` (the `AgentDefinition { ... }` literal, currently around line 167): add `name_color: self.name_color.clone(),` next to `avatar_url: self.avatar_url.clone(),` at line 173.

- [ ] **Step 5: Add `name_color` to the request structs**

In `desktop/src-tauri/src/managed_agents/types/requests.rs`, add to both `CreatePersonaRequest` and `UpdatePersonaRequest` (both already `#[serde(rename_all = "camelCase")]`), next to `pub avatar_url: Option<String>,`:
```rust
    #[serde(default)]
    pub name_color: Option<String>,
```
(`#[serde(default)]` — matching `runtime`/`model`/`provider` on both structs — so the field is optional on the wire, absent = `None`, not "must be present but nullable" like `avatar_url` is today.)

Also update the `record_without_quad` test fixture in this same file (an `AgentDefinition` literal at line ~271) by adding `name_color: None,` next to its `avatar_url` field.

- [ ] **Step 6: Wire validation + assignment into `create_persona`**

In `desktop/src-tauri/src/commands/personas/create.rs`, add the import:
```rust
use crate::managed_agents::validate_agent_name_color;
```
(add it into the existing `managed_agents::{...}` import group at the top of the file)

Add, right after the existing `let provider = trim_optional(input.provider);` line (line 32):
```rust
        let name_color = validate_agent_name_color(input.name_color)?;
```

Add `name_color,` to the `AgentDefinition { ... }` literal (currently lines 54-75), next to `provider,` at line 61.

- [ ] **Step 7: Wire validation + assignment into `update_persona`**

In `desktop/src-tauri/src/commands/personas/update.rs`, add the same import as Step 6.

Add, right after the existing `let provider = trim_optional(input.provider);` line (line 97):
```rust
            let name_color = validate_agent_name_color(input.name_color)?;
```

Add, right after the existing `persona.provider = provider;` line (line 120):
```rust
            persona.name_color = name_color;
```
(Unconditional replace on every update — matching `display_name`/`avatar_url`/`provider`, since the edit dialog always sends the field, using `null` for "no color".)

- [ ] **Step 8: Add the round-trip test**

In `desktop/src-tauri/src/managed_agents/types/tests.rs`:

Add `name_color: None,` to `sample_persona()` (the literal shown in Global Constraints research — insert next to `avatar_url: Some(...)`).

Add a new test near `persona_catalog_source_survives_the_agent_store_fold`:
```rust
#[test]
fn persona_name_color_survives_the_agent_store_fold() {
    // A local display preference is only useful if it's still there on the
    // next launch, and `save_personas` funnels every definition through
    // `into_agent_record`.
    let mut persona = sample_persona();
    persona.name_color = Some("blue".to_string());

    let view = persona
        .clone()
        .into_agent_record()
        .to_definition_view()
        .expect("slugged record must present a persona view");

    assert_eq!(view.name_color, persona.name_color);
}
```

- [ ] **Step 9: Attempt to build — expect (and note) compile errors from other struct literals**

Run: `cargo check -p buzz-desktop --all-targets 2>&1 | grep -B2 "missing field \`name_color\`"`
Expected: a list of file:line locations with "missing structure field name_color" — this is expected at this point; Task 2 and Task 3 fix them. Do not fix any file outside this task's file list yet — just confirm the error list matches (a superset of) what's described in Tasks 2 and 3.

- [ ] **Step 10: Run this task's own tests**

Run: `cargo test -p buzz-desktop name_color:: types::tests::persona_name_color`
Expected: PASS (the crate as a whole will not yet build cleanly with `--all-targets` until Tasks 2–3 land — that's fine; `cargo test` without `--all-targets` on just the touched modules is enough to confirm this task's own logic).

- [ ] **Step 11: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/name_color.rs desktop/src-tauri/src/managed_agents/mod.rs desktop/src-tauri/src/managed_agents/types.rs desktop/src-tauri/src/managed_agents/types/requests.rs desktop/src-tauri/src/managed_agents/types/tests.rs desktop/src-tauri/src/commands/personas/create.rs desktop/src-tauri/src/commands/personas/update.rs
git commit -m "feat(backend): add validated name_color field to agent persona model"
```

---

## Task 2: Backend — wire `name_color` through the remaining production construction sites

**Files:**
- Modify: `desktop/src-tauri/src/managed_agents/personas.rs` (`built_in_persona_records`)
- Modify: `desktop/src-tauri/src/managed_agents/persona_events.rs` (`persona_from_event`)
- Modify: `desktop/src-tauri/src/commands/team_snapshot.rs` (`definition_from_snapshot`, and the `ManagedAgentRecord` mint-time literal)
- Modify: `desktop/src-tauri/src/commands/agents.rs` (`create_managed_agent`)
- Modify: `desktop/src-tauri/src/commands/personas/snapshot/import.rs` (correction found via live `cargo check` — this file is production code, not a test fixture as originally assumed; it has an `AgentDefinition` literal at line ~447 and a `ManagedAgentRecord` literal at line ~482)
- Modify: `desktop/src-tauri/src/managed_agents/runtime.rs` (the `ManagedAgentSummary` construction)

**Interfaces:**
- Consumes: `AgentDefinition.name_color`, `ManagedAgentRecord.name_color`, `ManagedAgentSummary.name_color` from Task 1.
- Produces: a crate that compiles for every non-test path (test fixtures are Task 3).

- [ ] **Step 1: `built_in_persona_records` — built-in agents start with no color**

In `desktop/src-tauri/src/managed_agents/personas.rs:113` area, inside the `.map(|persona| AgentDefinition { ... })` literal, add right after `avatar_url: persona.avatar_url.map(|s| s.to_string()),`:
```rust
            name_color: None,
```

- [ ] **Step 2: `persona_from_event` — imported/published personas never carry a color over the wire**

In `desktop/src-tauri/src/managed_agents/persona_events.rs:184` area, inside `Ok(AgentDefinition { ... })`, add right after `avatar_url: content.avatar_url,`:
```rust
            name_color: None,
```
Add a one-line comment above it: `// name_color is a local-only display preference — never part of the published event content.`

- [ ] **Step 3: `definition_from_snapshot` — imported team members start with no color**

In `desktop/src-tauri/src/commands/team_snapshot.rs:121` area, inside `Ok(AgentDefinition { ... })`, add right after `avatar_url: effective_avatar(member),`:
```rust
        name_color: None,
```

- [ ] **Step 4: Team-snapshot mint — newly-minted `ManagedAgentRecord` starts with no color**

In `desktop/src-tauri/src/commands/team_snapshot.rs:552` area, inside the `let record = ManagedAgentRecord { ... };` literal, add right after `display_name: None,`:
```rust
            name_color: None,
```

- [ ] **Step 5: `create_managed_agent` — snapshot `name_color` from the linked persona at creation time**

Open `desktop/src-tauri/src/commands/agents.rs` around line 832. First read the ~30 lines above the `let record = crate::managed_agents::ManagedAgentRecord { ... };` literal to find how `avatar_url`/`system_prompt`/`model` are resolved from the linked persona for this new record (there is a persona lookup earlier in the same function, since this record's `system_prompt`/`model` are already persona-snapshotted per the `ManagedAgentRecord` doc comments). Add a `name_color` line to the literal that mirrors whatever resolution pattern is used for `system_prompt` (persona snapshot, not live-derived) — i.e. `name_color: linked_persona.and_then(|p| p.name_color.clone()),` if the variable holding the resolved persona is named `linked_persona` (adjust the identifier to whatever the actual local variable is named), falling back to `None` when there is no linked persona.

- [ ] **Step 6: `ManagedAgentSummary` construction — plain passthrough from the record**

In `desktop/src-tauri/src/managed_agents/runtime.rs`, inside the `Ok(ManagedAgentSummary { ... })` literal (the one shown constructing `avatar_url: record.avatar_url.clone(),`), add right after that line:
```rust
        name_color: record.name_color.clone(),
```

- [ ] **Step 6b: `commands/personas/snapshot/import.rs` — two more production sites (found via live `cargo check`, not in the original plan research)**

This file was miscategorized during planning as a test-only fixture; a real `cargo check -p buzz-desktop --lib` run showed it is actual production code (persona/team snapshot import) and must be fixed here, not in Task 3. Open `desktop/src-tauri/src/commands/personas/snapshot/import.rs`:
- At the `AgentDefinition { ... }` literal around line 447, add `name_color: None,` next to `avatar_url:` (imported snapshots start with no color, matching Step 3's treatment).
- At the `ManagedAgentRecord { ... }` literal around line 482, add `name_color: None,` next to `avatar_url:` or `display_name:` (matching Step 4's treatment).

- [ ] **Step 7: Verify these 6 files are the only remaining non-test compile errors**

Run: `cargo check -p buzz-desktop --lib 2>&1 | grep "missing field \`name_color\`"`
Expected: no output (the non-test crate now compiles clean). Note: use `--lib` (not the bare `cargo check -p buzz-desktop`, which fails with "package ID specification did not match any packages" in this workspace layout — run it from `desktop/src-tauri/` or use `-p buzz-desktop --lib` from the repo root once the workspace resolves it).

- [ ] **Step 8: Commit**

```bash
git add desktop/src-tauri/src/managed_agents/personas.rs desktop/src-tauri/src/managed_agents/persona_events.rs desktop/src-tauri/src/commands/team_snapshot.rs desktop/src-tauri/src/commands/agents.rs desktop/src-tauri/src/commands/personas/snapshot/import.rs desktop/src-tauri/src/managed_agents/runtime.rs
git commit -m "feat(backend): propagate name_color through built-ins, catalog events, team snapshots, and agent creation"
```

---

## Task 3: Backend — compiler-driven fixup of test fixtures

**Files:** every file below, each getting exactly one new line added to an existing struct literal.

**Interfaces:**
- Consumes: the now-required `name_color` field on `AgentDefinition`/`ManagedAgentRecord` from Tasks 1–2.
- Produces: `cargo check -p buzz-desktop --all-targets` passing with zero errors.

- [ ] **Step 1: Get the authoritative, current error list**

Run: `cargo check -p buzz-desktop --all-targets 2>&1 | grep -A1 "missing field \`name_color\`" | grep "\-\->"`
Expected: a list of `file:line:col` locations. Use this list as the source of truth — it supersedes the file list below if the two differ (the codebase may have changed since this plan was written).

- [ ] **Step 2: For each reported location, add `name_color: None,`**

For an `AgentDefinition` literal, add the line next to `avatar_url:`. For a `ManagedAgentRecord` literal, add it next to `avatar_url:` (or `display_name:` if that's easier to find in the literal). Known locations as of plan-writing time (verify against Step 1's live list):

```
desktop/src-tauri/src/mesh_llm/recovery.rs:424
desktop/src-tauri/src/commands/agent_models_tests.rs:386
desktop/src-tauri/src/commands/agents_tests.rs:69
desktop/src-tauri/src/commands/team_snapshot/tests.rs:57
desktop/src-tauri/src/commands/team_snapshot/tests.rs:79
desktop/src-tauri/src/commands/team_snapshot/tests.rs:142
desktop/src-tauri/src/commands/agent_config.rs:644
desktop/src-tauri/src/commands/agent_config.rs:702
desktop/src-tauri/src/commands/personas/sharing.rs:145
desktop/src-tauri/src/commands/personas/snapshot/import.rs:447
desktop/src-tauri/src/commands/personas/snapshot/import.rs:482
desktop/src-tauri/src/commands/personas/inbound/inbound_tests.rs:12
desktop/src-tauri/src/commands/personas/inbound/inbound_tests.rs:39
desktop/src-tauri/src/commands/personas/inbound/inbound_tests.rs:161
desktop/src-tauri/src/commands/personas/pending.rs:256
desktop/src-tauri/src/commands/personas/update/name_propagation_tests.rs:7
desktop/src-tauri/src/commands/personas/snapshot/tests.rs:22
desktop/src-tauri/src/commands/personas/snapshot/tests.rs:82
desktop/src-tauri/src/commands/personas/snapshot/fidelity_tests.rs:13
desktop/src-tauri/src/commands/personas/delete_cascade_tests.rs:19
desktop/src-tauri/src/managed_agents/runtime/tests.rs:130
desktop/src-tauri/src/managed_agents/runtime/tests.rs:286
desktop/src-tauri/src/managed_agents/runtime/tests.rs:336
desktop/src-tauri/src/managed_agents/runtime/tests.rs:1225
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:7
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:143
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:370
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:401
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:498
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:542
desktop/src-tauri/src/managed_agents/persona_events/tests.rs:638
desktop/src-tauri/src/managed_agents/nest/tests.rs:426
desktop/src-tauri/src/managed_agents/nest/tests.rs:451
desktop/src-tauri/src/managed_agents/effective_config/tests.rs:10
desktop/src-tauri/src/managed_agents/effective_config/tests.rs:41
desktop/src-tauri/src/managed_agents/global_config/tests.rs:301
desktop/src-tauri/src/managed_agents/global_config/tests.rs:359
desktop/src-tauri/src/managed_agents/global_config/tests.rs:620
desktop/src-tauri/src/managed_agents/personas/tests.rs:10
desktop/src-tauri/src/managed_agents/personas/tests.rs:278
desktop/src-tauri/src/managed_agents/personas/tests.rs:313
desktop/src-tauri/src/managed_agents/personas/tests.rs:347
desktop/src-tauri/src/managed_agents/personas/tests.rs:363
desktop/src-tauri/src/managed_agents/discovery/tests.rs:275
desktop/src-tauri/src/managed_agents/discovery/tests.rs:316
desktop/src-tauri/src/managed_agents/spawn_hash/tests.rs:6
desktop/src-tauri/src/managed_agents/spawn_hash/tests.rs:64
desktop/src-tauri/src/managed_agents/agent_events.rs:160
desktop/src-tauri/src/managed_agents/team_snapshot.rs:254
desktop/src-tauri/src/managed_agents/config_bridge/reader_tests.rs:66
desktop/src-tauri/src/managed_agents/teams_tests.rs:165
desktop/src-tauri/src/managed_agents/agent_snapshot.rs:484
desktop/src-tauri/src/managed_agents/reconcile/tests.rs:6
desktop/src-tauri/src/managed_agents/readiness.rs:1481
desktop/src-tauri/src/managed_agents/runtime_commands.rs:589
desktop/src-tauri/src/migration_avatar_tests.rs:27
desktop/src-tauri/src/managed_agents/types/tests.rs:590
```
(`desktop/src-tauri/src/managed_agents/types/tests.rs:474` / `sample_persona` and `requests.rs:271` / `record_without_quad` were already handled in Task 1, Steps 5 and 8 — skip them here if still flagged, it means they're already fixed.)

- [ ] **Step 3: Confirm zero remaining errors**

Run: `cargo check -p buzz-desktop --all-targets 2>&1 | grep -c "missing field \`name_color\`"`
Expected: `0`

- [ ] **Step 4: Run the full backend test suite**

Run: `cargo test -p buzz-desktop`
Expected: PASS, same pass count as the pre-change baseline plus the 4 new tests from Task 1.

- [ ] **Step 5: Commit**

```bash
git add -A desktop/src-tauri/src
git commit -m "test(backend): add name_color: None to existing test fixtures"
```

---

## Task 4: Frontend — TS types, CSS palette, shared style helper

**Files:**
- Modify: `desktop/src/shared/api/types.ts` (`AgentPersona`, `CreatePersonaInput`, `UpdatePersonaInput`, `ManagedAgent`)
- Modify: `desktop/src/shared/styles/globals/theme.css` (palette CSS custom properties)
- Create: `desktop/src/shared/lib/agentNameColors.ts`
- Create: `desktop/src/shared/lib/agentNameColors.test.mjs`

**Interfaces:**
- Produces: `AGENT_NAME_COLOR_IDS: readonly string[]`, `type AgentNameColorId`, `getAgentNameColorStyle(nameColor?: string | null): React.CSSProperties` from `@/shared/lib/agentNameColors`.
- Consumes: nothing (foundation for Tasks 5–8).

- [ ] **Step 1: Write the failing test**

Create `desktop/src/shared/lib/agentNameColors.test.mjs`:
```mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AGENT_NAME_COLOR_IDS,
  getAgentNameColorStyle,
} from "./agentNameColors.ts";

describe("getAgentNameColorStyle", () => {
  it("returns a CSS var color for a valid palette id", () => {
    assert.deepEqual(getAgentNameColorStyle("blue"), {
      color: "var(--agent-color-blue)",
    });
  });

  it("returns an empty style for null", () => {
    assert.deepEqual(getAgentNameColorStyle(null), {});
  });

  it("returns an empty style for undefined", () => {
    assert.deepEqual(getAgentNameColorStyle(undefined), {});
  });

  it("returns an empty style for an unknown id", () => {
    assert.deepEqual(getAgentNameColorStyle("burnt-sienna"), {});
  });

  it("has exactly 16 palette ids", () => {
    assert.equal(AGENT_NAME_COLOR_IDS.length, 16);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `desktop/`): `pnpm test -- --test-name-pattern getAgentNameColorStyle` (or `node --import ./test-loader.mjs --experimental-strip-types --test "src/shared/lib/agentNameColors.test.mjs"` if the package script doesn't support filtering)
Expected: FAIL — `agentNameColors.ts` does not exist yet.

- [ ] **Step 3: Implement the palette module**

Create `desktop/src/shared/lib/agentNameColors.ts`:
```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: same command as Step 2.
Expected: PASS (5 tests).

- [ ] **Step 5: Add the CSS custom properties**

In `desktop/src/shared/styles/globals/theme.css`, add right before the closing `}` of the `:root {` block (currently ending at line 66, just after `--buzz-hosted-community-identity-bg: 255 255 255;`):
```css
    /* Agent name-color palette — fixed 16 ids, Tailwind 600 shades for
       legible text on the light background. */
    --agent-color-red: #dc2626;
    --agent-color-orange: #ea580c;
    --agent-color-amber: #d97706;
    --agent-color-yellow: #ca8a04;
    --agent-color-lime: #65a30d;
    --agent-color-green: #16a34a;
    --agent-color-emerald: #059669;
    --agent-color-teal: #0d9488;
    --agent-color-cyan: #0891b2;
    --agent-color-sky: #0284c7;
    --agent-color-blue: #2563eb;
    --agent-color-indigo: #4f46e5;
    --agent-color-violet: #7c3aed;
    --agent-color-purple: #9333ea;
    --agent-color-fuchsia: #c026d3;
    --agent-color-pink: #db2777;
```

Add right before the closing `}` of the `.dark {` block (currently ending at line 116, just after `--sidebar-ring: 231 15.61% 33.92%;`):
```css
    /* Agent name-color palette — Tailwind 400 shades for legible text on
       the dark background. */
    --agent-color-red: #f87171;
    --agent-color-orange: #fb923c;
    --agent-color-amber: #fbbf24;
    --agent-color-yellow: #facc15;
    --agent-color-lime: #a3e635;
    --agent-color-green: #4ade80;
    --agent-color-emerald: #34d399;
    --agent-color-teal: #2dd4bf;
    --agent-color-cyan: #22d3ee;
    --agent-color-sky: #38bdf8;
    --agent-color-blue: #60a5fa;
    --agent-color-indigo: #818cf8;
    --agent-color-violet: #a78bfa;
    --agent-color-purple: #c084fc;
    --agent-color-fuchsia: #e879f9;
    --agent-color-pink: #f472b6;
```

- [ ] **Step 6: Add `nameColor` to the TS types**

In `desktop/src/shared/api/types.ts`, add `nameColor: string | null;` right after `avatarUrl: string | null;` in `AgentPersona` (line 745) and in `ManagedAgent` (line ~347, right after `avatarUrl: string | null;`).

Add `nameColor?: string;` right after `avatarUrl?: string;` in `CreatePersonaInput` (line 798) and `UpdatePersonaInput` (line 816).

- [ ] **Step 7: Verify the frontend type-checks**

Run (from `desktop/`): `pnpm typecheck` (or `pnpm tsc --noEmit` if that script doesn't exist — check `desktop/package.json` `scripts` first)
Expected: PASS, no new errors (existing callers that build `CreatePersonaInput`/`UpdatePersonaInput` object literals don't need every optional field, so this alone shouldn't break anything yet).

- [ ] **Step 8: Commit**

```bash
git add desktop/src/shared/api/types.ts desktop/src/shared/styles/globals/theme.css desktop/src/shared/lib/agentNameColors.ts desktop/src/shared/lib/agentNameColors.test.mjs
git commit -m "feat(frontend): add name-color palette, CSS vars, and TS types"
```

---

## Task 5: Frontend — color picker component + wire into the edit-agent dialog

**Files:**
- Create: `desktop/src/features/agents/ui/AgentNameColorPicker.tsx`
- Modify: `desktop/src/features/agents/ui/AgentDefinitionDialog.tsx`

**Interfaces:**
- Consumes: `AGENT_NAME_COLOR_IDS`, `AgentNameColorId` from `@/shared/lib/agentNameColors` (Task 4).
- Produces: `<AgentNameColorPicker value={string | null} onChange={(next: string | null) => void} disabled?: boolean />`, and `AgentDefinitionDialog`'s submit payload now includes `nameColor`.

- [ ] **Step 1: Implement the picker component**

Create `desktop/src/features/agents/ui/AgentNameColorPicker.tsx`, following the swatch-button visual pattern already used for avatar colors (`AgentCreationPreview.tsx`'s swatch grid) but simpler — no custom/gradient swatch:

```tsx
import {
  AGENT_NAME_COLOR_IDS,
  getAgentNameColorStyle,
} from "@/shared/lib/agentNameColors";
import { cn } from "@/shared/lib/cn";

type AgentNameColorPickerProps = {
  disabled?: boolean;
  onChange: (nameColor: string | null) => void;
  value: string | null;
};

export function AgentNameColorPicker({
  disabled = false,
  onChange,
  value,
}: AgentNameColorPickerProps) {
  return (
    <div className="space-y-1.5">
      <label
        className="text-sm font-medium text-foreground"
        htmlFor="persona-name-color"
      >
        Name color
      </label>
      <div
        className="grid grid-cols-9 justify-items-center gap-1.5 rounded-lg bg-muted p-3"
        id="persona-name-color"
        role="radiogroup"
      >
        <button
          aria-checked={value === null}
          aria-label="No color"
          className={cn(
            "relative flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground transition-transform duration-150 ease-out hover:scale-[1.15] focus-visible:scale-[1.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
          disabled={disabled}
          onClick={() => onChange(null)}
          role="radio"
          type="button"
        >
          {value === null ? (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          ) : null}
        </button>
        {AGENT_NAME_COLOR_IDS.map((id) => {
          const isSelected = value === id;
          return (
            <button
              aria-checked={isSelected}
              aria-label={`Use ${id}`}
              className={cn(
                "relative h-6 w-6 rounded-full border border-border transition-transform duration-150 ease-out hover:scale-[1.15] focus-visible:scale-[1.15] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
              disabled={disabled}
              key={id}
              onClick={() => onChange(id)}
              role="radio"
              style={{ background: getAgentNameColorStyle(id).color }}
              type="button"
            >
              {isSelected ? (
                <span className="absolute inset-0.5 rounded-full border-2 border-background" />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire state into `AgentDefinitionDialog`**

In `desktop/src/features/agents/ui/AgentDefinitionDialog.tsx`:

Add the import: `import { AgentNameColorPicker } from "./AgentNameColorPicker";`

Add state right after `const [avatarUrl, setAvatarUrl] = React.useState("");` (line 144):
```tsx
  const [nameColor, setNameColor] = React.useState<string | null>(null);
```

Add hydration right after `setAvatarUrl(initialValues.avatarUrl ?? "");` (line 204):
```tsx
    setNameColor(initialValues.nameColor ?? null);
```

Add to the submit payload's `baseInput` object (line ~353-367), right after `avatarUrl: avatarUrl.trim() || undefined,`:
```tsx
      nameColor: nameColor ?? undefined,
```

- [ ] **Step 3: Render the picker next to the avatar preview**

In the same file, wrap the existing `<AgentCreationPreview ... />` (lines 770-783) in a column container and add the picker as its sibling, so it renders directly under the avatar preview while keeping the form's 2-column grid intact (the grid's first two direct children become its two columns — wrapping keeps it a single first child):

```tsx
          <div className="flex flex-col gap-3">
            <AgentCreationPreview
              avatarUrl={previewAvatarUrl}
              disabled={isPending || isAvatarUploadPending}
              label={previewLabel}
              onClearAvatar={() => {
                setHasUserChanges(true);
                setAvatarUrl("");
              }}
              onUploadPendingChange={setIsAvatarUploadPending}
              onSelectAvatar={(nextAvatarUrl) => {
                setHasUserChanges(true);
                setAvatarUrl(nextAvatarUrl);
              }}
            />
            <AgentNameColorPicker
              disabled={isPending}
              onChange={(next) => {
                setHasUserChanges(true);
                setNameColor(next);
              }}
              value={nameColor}
            />
          </div>
```

- [ ] **Step 4: Verify it builds and type-checks**

Run (from `desktop/`): `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Manual check**

Run the app (see Task 9 for the full manual-verification pass) — for now just confirm the dialog opens, the new swatch row renders under the avatar preview, and clicking a swatch shows a selection ring without throwing.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/agents/ui/AgentNameColorPicker.tsx desktop/src/features/agents/ui/AgentDefinitionDialog.tsx
git commit -m "feat(frontend): add name-color picker to the agent edit dialog"
```

---

## Task 6: Frontend — color the message author name

**CORRECTION (found by the Task 6 implementer, confirmed by follow-up research):** the plan originally assumed `MessageRow.tsx` already has the message author's resolved `ManagedAgent`/`AgentPersona` object in scope (since it renders the author's avatar). That's wrong — a message's `avatarUrl`/`displayName` come from `TimelineMessage` (`desktop/src/features/messages/types.ts`), built by `formatTimelineMessages()` (`desktop/src/features/messages/lib/formatTimelineMessages.ts`) purely from a generic `profiles: UserProfileLookup` map keyed by pubkey — `nameColor` never reaches this pipeline. This task is now scoped wider to thread it through, following the exact template the codebase already uses for `personaLookup`/`respondToLookup` (both built the same way, one level up, from `managedAgentsQuery.data`).

**Files:**
- Modify: `desktop/src/features/channels/ui/ChannelScreen.tsx` (extend the existing `personaLookup`/`respondToLookup`-building `useMemo` around line 373-387)
- Modify: `desktop/src/features/messages/lib/formatTimelineMessages.ts` (new optional parameter, one new field on the returned object)
- Modify: `desktop/src/features/messages/types.ts` (`TimelineMessage` gains `nameColor?: string | null`)
- Modify: `desktop/src/features/messages/ui/MessageHeader.tsx`
- Modify: `desktop/src/features/messages/ui/MessageRow.tsx` (the call site(s) that render `<MessageAuthorText>`, around line 471-475, plus the row's memo-comparison list around line 840/857)
- Modify: `desktop/src/features/messages/lib/useHomeInboxContextMessages.ts` and `desktop/src/features/messages/lib/independentThreadPanel.ts` (the other two callers of `formatTimelineMessages` — each already has an equivalent persona-lookup map in scope; thread `nameColorLookup` through the same way, so message author color also works in the home inbox and thread panel, not only the main channel view)

**Interfaces:**
- Consumes: `getAgentNameColorStyle` from `@/shared/lib/agentNameColors` (Task 4), `ManagedAgent.nameColor` (Task 4).
- Produces: `MessageAuthorText` accepts an optional `style` prop. `formatTimelineMessages` accepts a new optional `nameColorLookup?: Map<string, string>` parameter. `TimelineMessage.nameColor?: string | null`.

- [ ] **Step 1: Add a `style` prop to `MessageAuthorText`**

In `desktop/src/features/messages/ui/MessageHeader.tsx`, change:
```tsx
type MessageAuthorTextProps = {
  as?: "div" | "h3" | "span";
  children: React.ReactNode;
  className?: string;
  hoverUnderline?: boolean;
};

export function MessageAuthorText({
  as: Component = "span",
  children,
  className,
  hoverUnderline = false,
}: MessageAuthorTextProps) {
  return (
    <Component
      className={cn(
        "truncate text-sm font-semibold leading-4 tracking-tight",
        hoverUnderline && "hover:underline",
        className,
      )}
      data-testid="message-author"
    >
      {children}
    </Component>
  );
}
```
to:
```tsx
type MessageAuthorTextProps = {
  as?: "div" | "h3" | "span";
  children: React.ReactNode;
  className?: string;
  hoverUnderline?: boolean;
  style?: React.CSSProperties;
};

export function MessageAuthorText({
  as: Component = "span",
  children,
  className,
  hoverUnderline = false,
  style,
}: MessageAuthorTextProps) {
  return (
    <Component
      className={cn(
        "truncate text-sm font-semibold leading-4 tracking-tight",
        hoverUnderline && "hover:underline",
        className,
      )}
      data-testid="message-author"
      style={style}
    >
      {children}
    </Component>
  );
}
```

- [ ] **Step 2: Add `nameColor` to `TimelineMessage`**

In `desktop/src/features/messages/types.ts`, add `nameColor?: string | null;` to the `TimelineMessage` type, next to the existing `avatarUrl?`/`personaDisplayName?` fields.

- [ ] **Step 3: Build the `pubkey -> nameColor` lookup in `ChannelScreen.tsx`**

In `desktop/src/features/channels/ui/ChannelScreen.tsx`, find the existing `useMemo` around line 373-387 that loops `managedAgentsQuery.data` to build `personaLookup`/`respondToLookup` (both `Map`s keyed by `agent.pubkey.toLowerCase()`). Extend it to also build:
```ts
const nameColorLookup = new Map<string, string>();
for (const agent of managedAgentsQuery.data ?? []) {
  if (agent.nameColor) {
    nameColorLookup.set(agent.pubkey.toLowerCase(), agent.nameColor);
  }
}
```
(adapt to fit the existing memo's actual loop structure — don't duplicate the iteration if it can be folded into the same loop as `personaLookup`). Pass `nameColorLookup` as a new positional argument into the `formatTimelineMessages(...)` call at line ~397-398, in the same relative position you add it to the function's parameter list in Step 4.

- [ ] **Step 4: Thread `nameColorLookup` through `formatTimelineMessages`**

In `desktop/src/features/messages/lib/formatTimelineMessages.ts`, add a new optional parameter `nameColorLookup?: Map<string, string>` to `formatTimelineMessages`'s signature (after `personaLookup`). Inside the per-event `.map`/loop that builds each `TimelineMessage`, add:
```ts
nameColor: nameColorLookup?.get(authorPubkey.toLowerCase()) ?? null,
```
(mirror exactly how `personaDisplayName` is derived a few lines away — same `authorPubkey` variable, same lowercase-keyed lookup pattern).

- [ ] **Step 5: Thread the same parameter through the other two callers**

In `desktop/src/features/messages/lib/useHomeInboxContextMessages.ts` and `desktop/src/features/messages/lib/independentThreadPanel.ts`: each already builds an equivalent persona/agent lookup map to pass into its own `formatTimelineMessages` call (or into `useIndependentThreadPanel`, per the research). Add the same `nameColorLookup` construction (same pattern as Step 3) and pass it through. If either file doesn't have a `managedAgentsQuery`/agent list readily in scope, report that specifically rather than fabricating a new data-fetch — a missing agent list at one of these two secondary call sites is an acceptable gap to flag and skip (leaving that surface uncolored for now), since the primary channel view (`ChannelScreen.tsx`) is the requirement that must not be skipped.

- [ ] **Step 6: Add the `style` prop to `MessageAuthorText`**

In `desktop/src/features/messages/ui/MessageHeader.tsx`, change:
```tsx
type MessageAuthorTextProps = {
  as?: "div" | "h3" | "span";
  children: React.ReactNode;
  className?: string;
  hoverUnderline?: boolean;
};

export function MessageAuthorText({
  as: Component = "span",
  children,
  className,
  hoverUnderline = false,
}: MessageAuthorTextProps) {
  return (
    <Component
      className={cn(
        "truncate text-sm font-semibold leading-4 tracking-tight",
        hoverUnderline && "hover:underline",
        className,
      )}
      data-testid="message-author"
    >
      {children}
    </Component>
  );
}
```
to:
```tsx
type MessageAuthorTextProps = {
  as?: "div" | "h3" | "span";
  children: React.ReactNode;
  className?: string;
  hoverUnderline?: boolean;
  style?: React.CSSProperties;
};

export function MessageAuthorText({
  as: Component = "span",
  children,
  className,
  hoverUnderline = false,
  style,
}: MessageAuthorTextProps) {
  return (
    <Component
      className={cn(
        "truncate text-sm font-semibold leading-4 tracking-tight",
        hoverUnderline && "hover:underline",
        className,
      )}
      data-testid="message-author"
      style={style}
    >
      {children}
    </Component>
  );
}
```

- [ ] **Step 7: Pass the resolved color at the `MessageRow.tsx` call site(s)**

Open `desktop/src/features/messages/ui/MessageRow.tsx` around lines 471-475 where `<MessageAuthorText>` renders `message.author`. Add:
```tsx
import { getAgentNameColorStyle } from "@/shared/lib/agentNameColors";
```
and pass `style={getAgentNameColorStyle(message.nameColor)}`. Also add `message.nameColor` to the row's memo-comparison dependency list around line 840/857 (wherever the component memoizes on message fields) so a color change is reflected without requiring an unrelated re-render trigger.

- [ ] **Step 8: Manual check**

Set a color on a test agent (via Task 5's picker), send a message as that agent, confirm the name renders in that color in both light and dark theme, in the main channel view. Check the home inbox and a thread panel too if Step 5 wired those.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/features/channels/ui/ChannelScreen.tsx desktop/src/features/messages/lib/formatTimelineMessages.ts desktop/src/features/messages/types.ts desktop/src/features/messages/ui/MessageHeader.tsx desktop/src/features/messages/ui/MessageRow.tsx desktop/src/features/messages/lib/useHomeInboxContextMessages.ts desktop/src/features/messages/lib/independentThreadPanel.ts
git commit -m "feat(frontend): color the message author name by agent name-color"
```

---

## Task 7: Frontend — color the @-mention (autocomplete row + rendered chip)

**Files:**
- Modify: `desktop/src/features/messages/ui/MentionAutocomplete.tsx`
- Modify: `desktop/src/features/messages/lib/mentionHighlightExtension.ts`
- Modify: `desktop/src/features/messages/lib/useRichTextEditor.ts`
- Modify: callers of `useRichTextEditor` that pass `agentMentionNames` (discover via `grep -rn "agentMentionNames" desktop/src/features/messages` — thread a parallel color map from the same source that already supplies the names)

**Interfaces:**
- Consumes: `getAgentNameColorStyle` (Task 4).
- Produces: `MentionHighlightExtension`'s storage gains `agentNameColors: Record<string, string>` (key: lowercased trimmed agent name, value: a palette id); `useRichTextEditor` accepts an optional `agentMentionColors?: Record<string, string>` prop; `MentionSuggestion` gains `nameColor: string | null`.

- [ ] **Step 1: Autocomplete dropdown row**

In `desktop/src/features/messages/ui/MentionAutocomplete.tsx`, add `nameColor: string | null;` to the `MentionSuggestion` type (lines 16-28, next to `personaId`).

Change the name span (lines 140-146):
```tsx
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="min-w-0 break-words font-medium leading-snug"
                  title={suggestion.displayName}
                >
                  {suggestion.displayName}
                </span>
```
to:
```tsx
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                  className="min-w-0 break-words font-medium leading-snug"
                  style={getAgentNameColorStyle(suggestion.nameColor)}
                  title={suggestion.displayName}
                >
                  {suggestion.displayName}
                </span>
```
Add the import: `import { getAgentNameColorStyle } from "@/shared/lib/agentNameColors";`

Find where `MentionSuggestion[]` values are constructed (grep `displayName:` near `personaId:` in the same feature folder) and add `nameColor: agent.nameColor ?? null,` there, sourcing it from whatever `ManagedAgent`/`AgentPersona` object already supplies `personaId`/`avatarUrl` for that suggestion.

- [ ] **Step 2: Extend the highlight extension's storage and decoration builder**

In `desktop/src/features/messages/lib/mentionHighlightExtension.ts`:

Change `addStorage()`:
```ts
  addStorage() {
    return {
      names: [] as string[],
      agentNames: [] as string[],
      agentNameColors: {} as Record<string, string>,
      channelNames: [] as string[],
    };
  },
```

Update every `buildDecorations(...)` call inside `addProseMirrorPlugins` (there are 4: `init`, and 3 inside `apply`) to pass the new storage field as an additional argument, e.g.:
```ts
            return buildDecorations(
              state.doc,
              extension.storage.names,
              extension.storage.agentNames,
              extension.storage.agentNameColors,
              extension.storage.channelNames,
            );
```
(apply this same extra argument to all 4 call sites, in the same position — right after `agentNames`.)

Update `buildDecorations`'s signature and its call into `addMatchesForPatterns` for the agent-mention branch:
```ts
function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  names: string[],
  agentNames: string[],
  agentNameColors: Record<string, string>,
  channelNames: string[],
): DecorationSet {
  if (
    names.length === 0 &&
    agentNames.length === 0 &&
    channelNames.length === 0
  )
    return DecorationSet.empty;

  const decorations: Decoration[] = [];
  const agentNameSet = new Set(
    agentNames.map((name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const nonAgentNames = names.filter(
    (name) => !agentNameSet.has(name.trim().toLowerCase()),
  );
  const mentionPatterns = buildHighlightPatterns(nonAgentNames, []);
  const agentMentionPatterns = buildHighlightPatterns(agentNames, []);
  const channelPatterns = buildHighlightPatterns([], channelNames);

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    addMatchesForPatterns(
      decorations,
      node.text,
      pos,
      mentionPatterns,
      "mention-chip",
    );
    addMatchesForPatterns(
      decorations,
      node.text,
      pos,
      agentMentionPatterns,
      "mention-chip agent-mention-highlight",
      { hideMentionPrefix: true, nameColors: agentNameColors },
    );
    addMatchesForPatterns(
      decorations,
      node.text,
      pos,
      channelPatterns,
      "mention-chip",
    );
  });

  return DecorationSet.create(doc, decorations);
}
```

Update `addMatchesForPatterns` to accept the color map and stamp a `style` attr on the agent-mention decorations:
```ts
function addMatchesForPatterns(
  decorations: Decoration[],
  text: string,
  position: number,
  patterns: RegExp[],
  className: string,
  options?: { hideMentionPrefix?: boolean; nameColors?: Record<string, string> },
) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(text);
    while (match !== null) {
      const from = position + match.index;
      const to = from + match[0].length;
      const matchedName = match[1] ?? match[0].replace(/^[@#]/, "");
      const colorId = options?.nameColors?.[matchedName.trim().toLowerCase()];
      const style = colorId ? `color: var(--agent-color-${colorId})` : undefined;
      if (options?.hideMentionPrefix && match[0].startsWith("@")) {
        decorations.push(
          Decoration.inline(from, from + 1, {
            class: "agent-mention-at-hidden",
            spellcheck: "false",
          }),
        );
        decorations.push(
          Decoration.inline(from + 1, to, {
            class: className,
            spellcheck: "false",
            ...(style ? { style } : {}),
          }),
        );
      } else {
        decorations.push(
          Decoration.inline(from, to, {
            class: className,
            spellcheck: "false",
            ...(style ? { style } : {}),
          }),
        );
      }
      match = pattern.exec(text);
    }
  }
}
```
(`match[1]` is the captured group from `buildHighlightPatterns`'s `(${escapedNames.join("|")})` — this already exists in the current regex construction, so the matched name is directly available without new capturing logic.)

Update the two `desktop/src/features/messages/lib/mentionHighlightExtension.test.mjs`-style existing unit tests if present (grep for a sibling test file for this extension; if `buildHighlightPatterns`/`findHighlightMatches`/`buildDecorations` are exported and tested, their call signatures haven't changed except `buildDecorations`'s new parameter — update any direct calls to it in tests to pass an empty `{}` for `agentNameColors`).

- [ ] **Step 3: Thread the color map through `useRichTextEditor`**

In `desktop/src/features/messages/lib/useRichTextEditor.ts`, add a new hook parameter `agentMentionColors?: Record<string, string>` alongside the existing `agentMentionNames` parameter (find its destructuring in the hook's params and add the sibling), and update the storage-sync effect (lines 643-657):
```ts
  React.useEffect(() => {
    if (!editor) return;
    // biome-ignore lint/suspicious/noExplicitAny: TipTap's Storage type doesn't include dynamic extension keys
    const storage = (editor.storage as any).mentionHighlight as
      | {
          names: string[];
          agentNames: string[];
          agentNameColors: Record<string, string>;
          channelNames: string[];
        }
      | undefined;
    if (storage) {
      storage.names = mentionNames ?? [];
      storage.agentNames = agentMentionNames ?? [];
      storage.agentNameColors = agentMentionColors ?? {};
      storage.channelNames = channelNames ?? [];
      // Force the plugin to re-decorate by dispatching a metadata transaction.
      const { tr } = editor.state;
      editor.view.dispatch(tr.setMeta(mentionHighlightKey, true));
    }
  }, [editor, mentionNames, agentMentionNames, agentMentionColors, channelNames]);
```

- [ ] **Step 4: Wire callers**

Run `grep -rn "agentMentionNames=" desktop/src/features/messages` to find every call site that passes `agentMentionNames` into this hook. For each, build a parallel `Record<string, string>` (lowercased trimmed name → `nameColor`) from the same agent-list source already used to build the `agentMentionNames` array, and pass it as `agentMentionColors={...}`.

- [ ] **Step 5: Manual check**

In the running app, send a message that @-mentions a colored agent, confirm both the composer's live decoration and the rendered (sent) message's chip pick up the color, in both themes. Confirm a mention of an uncolored agent is unchanged from today.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/messages/ui/MentionAutocomplete.tsx desktop/src/features/messages/lib/mentionHighlightExtension.ts desktop/src/features/messages/lib/useRichTextEditor.ts
git commit -m "feat(frontend): color @-mention autocomplete rows and rendered chips by agent name-color"
```
(If Step 4 touches additional caller files, add them to this `git add` before committing.)

---

## Task 8: Frontend — agent management surfaces

**Files:**
- Modify: `desktop/src/features/agents/ui/AgentIdentityCard.tsx`
- Modify: `desktop/src/features/agents/ui/AgentIdentityCard.tsx` callers (wherever it's used in `AgentsView.tsx`/`UnifiedAgentsSection.tsx`, to pass the new prop)
- Modify: `desktop/src/features/agents/ui/ManagedAgentRow.tsx`
- Modify: `desktop/src/features/channels/ui/MembersSidebarMemberCard.tsx`
- Modify: `desktop/src/features/channels/ui/BotActivityBar.tsx`

**Interfaces:**
- Consumes: `getAgentNameColorStyle` (Task 4), `ManagedAgent.nameColor` (Task 4).
- Produces: no new exports — this task only applies styling.

- [ ] **Step 1: `AgentIdentityCard` — widen props, apply style**

`AgentIdentityCard` only receives `label`/`avatarUrl` today (no full agent object), so add a new prop rather than threading the whole object:
```tsx
type AgentIdentityCardProps = {
  actions?: ReactNode;
  ariaLabel: string;
  avatar?: ReactNode;
  avatarUrl?: string | null;
  dataTestId: string;
  label: string;
  modelLabel?: string | null;
  nameColor?: string | null;
  onClick: () => void;
  /** Optional badge rendered below the label (e.g. "Restart required"). */
  statusBadge?: ReactNode;
};
```
Destructure `nameColor` in the function signature, import `getAgentNameColorStyle` from `@/shared/lib/agentNameColors`, and apply it to the name span:
```tsx
        <span
          className="min-w-0 truncate font-semibold text-foreground tracking-normal"
          style={getAgentNameColorStyle(nameColor)}
        >
          {label}
        </span>
```
Then find every JSX usage of `<AgentIdentityCard ... />` (grep `<AgentIdentityCard` in `desktop/src/features/agents/ui/`) and pass `nameColor={agent.nameColor}` from whatever `ManagedAgent`/`AgentPersona` object is already supplying that call site's `avatarUrl`/`label`.

- [ ] **Step 2: `ManagedAgentRow` — apply style directly (agent object already in scope)**

Change:
```tsx
            <p className="truncate font-medium text-foreground">{agent.name}</p>
```
to:
```tsx
            <p
              className="truncate font-medium text-foreground"
              style={getAgentNameColorStyle(agent.nameColor)}
            >
              {agent.name}
            </p>
```
Add the import: `import { getAgentNameColorStyle } from "@/shared/lib/agentNameColors";`

- [ ] **Step 3: `MembersSidebarMemberCard` — apply style only on the bot branch**

The `managedAgent?: ManagedAgent` prop is already in scope; the name text itself is the pre-formatted `memberLabel` string, rendered only inside the `memberIsBot` branch. Change the bot-branch span:
```tsx
              <span className="truncate text-sm font-medium tracking-tight">
                {memberLabel}
              </span>
```
(the one inside the `memberIsBot ? (...) : (...)` true-branch, at the location shown rendering `<Bot>` + `roleLabel` right after it) to:
```tsx
              <span
                className="truncate text-sm font-medium tracking-tight"
                style={getAgentNameColorStyle(managedAgent?.nameColor)}
              >
                {memberLabel}
              </span>
```
Do NOT change the non-bot branch's identical-looking span (human members have no `nameColor`). Add the import.

- [ ] **Step 4: `BotActivityBar` — widen the `Pick` type, apply style**

Change:
```tsx
export type BotActivityAgent = Pick<ManagedAgent, "pubkey" | "name">;
```
to:
```tsx
export type BotActivityAgent = Pick<ManagedAgent, "pubkey" | "name" | "nameColor">;
```
Change:
```tsx
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
```
to:
```tsx
                <span
                  className="min-w-0 flex-1 truncate"
                  style={getAgentNameColorStyle(agent.nameColor)}
                >
                  {agent.name}
                </span>
```
Add the import. Then find every place that constructs a `BotActivityAgent` value (grep `BotActivityAgent` and `agents={` near this component's usages) and add `nameColor: agent.nameColor,` to those object literals/`.map()` projections, since TypeScript will now require it.

- [ ] **Step 5: Type-check**

Run (from `desktop/`): `pnpm typecheck`
Expected: PASS — this step will surface any `BotActivityAgent`/`AgentIdentityCard` caller that still needs `nameColor` threaded in; fix each until clean.

- [ ] **Step 6: Manual check**

Set a color on an agent, confirm it shows in: the Agents settings grid card, the agent management list row, the channel members sidebar (for that agent, if it's a channel member), and the "N agents working" composer popover. Confirm human members and uncolored agents are unaffected.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/agents/ui/AgentIdentityCard.tsx desktop/src/features/agents/ui/ManagedAgentRow.tsx desktop/src/features/channels/ui/MembersSidebarMemberCard.tsx desktop/src/features/channels/ui/BotActivityBar.tsx
git commit -m "feat(frontend): color agent names in identity card, management row, member list, and bot-activity bar"
```
(Add any additional caller files touched in Steps 1/4 before committing.)

---

## Task 9: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Full backend test suite**

Run: `cargo test -p buzz-desktop`
Expected: PASS, no failures.

- [ ] **Step 2: Full frontend test suite**

Run (from `desktop/`): `pnpm test`
Expected: PASS, no failures.

- [ ] **Step 3: Type-check and lint**

Run (from `desktop/`): `pnpm typecheck && pnpm lint` (check `desktop/package.json` scripts for the exact lint command name, e.g. `biome check`)
Expected: PASS.

- [ ] **Step 4: Launch the desktop app in dev mode**

Run: `cd desktop && pnpm tauri dev` (or whatever the existing dev script is — check `desktop/package.json`)

- [ ] **Step 5: Manual walkthrough**

1. Open the edit dialog for an existing agent (e.g. one of the built-ins) — confirm it shows "no color" selected and the app looks unchanged everywhere for this agent.
2. Create or edit two different agents, assign each a distinct color (e.g. orange and blue) via the new picker.
3. Confirm color shows correctly in: the message author name when that agent sends a message; the @-mention autocomplete dropdown; the rendered mention chip in a sent message; the Agents settings grid card; the agent management list row; the channel members sidebar row (if the agent is a channel member); the "N agents working" composer popover.
4. Toggle the app's theme to dark and repeat step 3 — confirm every surface still reads clearly (no low-contrast text).
5. Confirm `MessageAgentOwner`'s "managed by you" badge, the huddle participant list, the typing indicator, `QuickBotBar`, and the new-DM/add-member search rows are all unchanged (out of scope, per the Global Constraints).

- [ ] **Step 6: Report results**

Summarize pass/fail for each of the 9 items in Step 5 back to the user before considering the feature done.
