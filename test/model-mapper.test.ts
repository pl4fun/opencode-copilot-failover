import { describe, it, expect } from "vitest";
import {
	mapModelToCopilot,
	isModelCopilotAvailable,
	parseModelString,
	COPILOT_MODEL_MAP,
} from "../lib/model-mapper.js";

describe("parseModelString", () => {
	it("splits fully-qualified model string into provider and model", () => {
		expect(parseModelString("anthropic/claude-opus-4-6")).toEqual({
			providerID: "anthropic",
			modelID: "claude-opus-4-6",
		});
	});

	it("returns empty providerID when no slash is present", () => {
		expect(parseModelString("claude-opus-4-6")).toEqual({
			providerID: "",
			modelID: "claude-opus-4-6",
		});
	});

	it("handles multiple slashes by splitting on first one only", () => {
		expect(parseModelString("org/sub/model-id")).toEqual({
			providerID: "org",
			modelID: "sub/model-id",
		});
	});
});

describe("mapModelToCopilot", () => {
	it("maps claude-opus-4-6 to claude-opus-4.6 (Anthropic dot conversion)", () => {
		expect(mapModelToCopilot("claude-opus-4-6")).toBe("claude-opus-4.6");
	});

	it("maps gpt-5.3-codex to gpt-5.3-codex (OpenAI 1:1 mapping)", () => {
		expect(mapModelToCopilot("gpt-5.3-codex")).toBe("gpt-5.3-codex");
	});

	it("maps claude-sonnet-4-5 to claude-sonnet-4.5", () => {
		expect(mapModelToCopilot("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
	});

	it("returns null for nonexistent model", () => {
		expect(mapModelToCopilot("nonexistent-model")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(mapModelToCopilot("")).toBeNull();
	});

	it("accepts fully-qualified model string (anthropic/claude-opus-4-6)", () => {
		expect(mapModelToCopilot("anthropic/claude-opus-4-6")).toBe("claude-opus-4.6");
	});

	it("maps all entries in COPILOT_MODEL_MAP correctly", () => {
		for (const [source, expected] of Object.entries(COPILOT_MODEL_MAP)) {
			expect(mapModelToCopilot(source)).toBe(expected);
		}
	});
});

describe("isModelCopilotAvailable", () => {
	it("returns true for known model", () => {
		expect(isModelCopilotAvailable("claude-opus-4-6")).toBe(true);
	});

	it("returns false for unknown model", () => {
		expect(isModelCopilotAvailable("fake-model")).toBe(false);
	});

	it("returns true for fully-qualified known model", () => {
		expect(isModelCopilotAvailable("openai/gpt-5.3-codex")).toBe(true);
	});
});
