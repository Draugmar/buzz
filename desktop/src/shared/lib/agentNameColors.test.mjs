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
