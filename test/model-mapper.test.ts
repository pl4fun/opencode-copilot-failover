import { describe, it, expect } from "vitest";
import {
	mapModelToCopilot,
	isModelCopilotAvailable,
	parseModelString,
	resolveWithFallback,
	COPILOT_MODEL_MAP,
	FALLBACK_CHAIN,
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
	it("maps claude-opus-4-6 (dash) to claude-opus-4.6 (dot)", () => {
		expect(mapModelToCopilot("claude-opus-4-6")).toBe("claude-opus-4.6");
	});

	it("maps claude-opus-4.6 (dot) to claude-opus-4.6 (identity)", () => {
		expect(mapModelToCopilot("claude-opus-4.6")).toBe("claude-opus-4.6");
	});

	it("maps claude-opus-4-1 to claude-opus-41 (no dot)", () => {
		expect(mapModelToCopilot("claude-opus-4-1")).toBe("claude-opus-41");
	});

	it("maps claude-sonnet-4-5 to claude-sonnet-4.5", () => {
		expect(mapModelToCopilot("claude-sonnet-4-5")).toBe("claude-sonnet-4.5");
	});

	it("maps gemini-3-flash to gemini-3-flash-preview", () => {
		expect(mapModelToCopilot("gemini-3-flash")).toBe("gemini-3-flash-preview");
	});

	it("maps gemini-3-pro to gemini-3-pro-preview", () => {
		expect(mapModelToCopilot("gemini-3-pro")).toBe("gemini-3-pro-preview");
	});

	it("maps gpt-4o 1:1", () => {
		expect(mapModelToCopilot("gpt-4o")).toBe("gpt-4o");
	});

	it("maps gpt-5-mini 1:1", () => {
		expect(mapModelToCopilot("gpt-5-mini")).toBe("gpt-5-mini");
	});

	it("returns null for nonexistent model", () => {
		expect(mapModelToCopilot("nonexistent-model")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(mapModelToCopilot("")).toBeNull();
	});

	it("returns null for gpt-5.3-codex (not in copilot)", () => {
		expect(mapModelToCopilot("gpt-5.3-codex")).toBeNull();
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
		expect(isModelCopilotAvailable("openai/gpt-5.2-codex")).toBe(true);
	});

	it("returns false for gpt-5.3-codex (removed phantom)", () => {
		expect(isModelCopilotAvailable("gpt-5.3-codex")).toBe(false);
	});
});

describe("resolveWithFallback", () => {
	it("returns direct mapping when available models not provided", () => {
		expect(resolveWithFallback("claude-opus-4-6")).toBe("claude-opus-4-6");
	});

	it("returns direct mapping when model is in available set", () => {
		const available = new Set(["claude-opus-4.6", "gpt-5.2-codex"]);
		expect(resolveWithFallback("claude-opus-4-6", available)).toBe("claude-opus-4.6");
	});

	it("falls back when direct mapping exists but is not available", () => {
		const available = new Set(["gpt-5.2-codex"]);
		expect(resolveWithFallback("claude-opus-4-6", available)).toBe("gpt-5.2-codex");
	});

	it("walks fallback chain in order (opus → codex → sonnet → ...)", () => {
		const available = new Set(["claude-sonnet-4.5"]);
		expect(resolveWithFallback("claude-opus-4-6", available)).toBe("claude-sonnet-4.5");
	});

	it("returns null when no models available at all", () => {
		const available = new Set<string>();
		expect(resolveWithFallback("claude-opus-4-6", available)).toBeNull();
	});

	it("returns null for unknown model with empty available set", () => {
		const available = new Set<string>();
		expect(resolveWithFallback("totally-unknown", available)).toBeNull();
	});

	it("finds fallback for unknown model without available set", () => {
		const result = resolveWithFallback("totally-unknown");
		expect(result).toBe("totally-unknown");
	});

	it("direct match identity when model already in copilot format", () => {
		const available = new Set(["claude-opus-4.6"]);
		expect(resolveWithFallback("claude-opus-4.6", available)).toBe("claude-opus-4.6");
	});

	it("respects fallback priority order", () => {
		const available = new Set(["grok-code-fast-1", "claude-opus-4.5", "gpt-5"]);
		expect(resolveWithFallback("totally-unknown", available)).toBe("claude-opus-4.5");
	});

	it("treats null availableModels same as undefined (no filtering)", () => {
		expect(resolveWithFallback("claude-opus-4-6", null)).toBe("claude-opus-4-6");
	});

	it("prefers bare model ID when directly available in copilot", () => {
		const available = new Set(["claude-opus-4-6", "claude-opus-4.6"]);
		expect(resolveWithFallback("claude-opus-4-6", available)).toBe("claude-opus-4-6");
	});

	it("returns bare model ID for unmapped model when available in copilot", () => {
		const available = new Set(["some-new-model", "claude-opus-4.6"]);
		expect(resolveWithFallback("some-new-model", available)).toBe("some-new-model");
	});
});

describe("FALLBACK_CHAIN", () => {
	it("starts with claude-opus models", () => {
		expect(FALLBACK_CHAIN[0]).toBe("claude-opus-4.6");
		expect(FALLBACK_CHAIN[1]).toBe("claude-opus-4.5");
	});

	it("has codex models after opus", () => {
		const lastOpus = FALLBACK_CHAIN.indexOf("claude-opus-4.5");
		const firstCodex = FALLBACK_CHAIN.indexOf("gpt-5.3-codex");
		expect(firstCodex).toBeGreaterThan(lastOpus);
	});

	it("has sonnet after codex", () => {
		const lastCodex = FALLBACK_CHAIN.indexOf("gpt-5.2-codex");
		const firstSonnet = FALLBACK_CHAIN.indexOf("claude-sonnet-4.5");
		expect(firstSonnet).toBeGreaterThan(lastCodex);
	});

	it("has kimi after sonnet", () => {
		const sonnet = FALLBACK_CHAIN.indexOf("claude-sonnet-4.5");
		const kimi = FALLBACK_CHAIN.indexOf("kimi-2.5");
		expect(kimi).toBeGreaterThan(sonnet);
	});

	it("contains no duplicates", () => {
		const unique = new Set(FALLBACK_CHAIN);
		expect(unique.size).toBe(FALLBACK_CHAIN.length);
	});
});
