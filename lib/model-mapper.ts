/**
 * Model Mapper — maps source provider model IDs to github-copilot model IDs.
 *
 * GitHub Copilot uses DOTS in version numbers where Anthropic uses DASHES.
 * e.g. anthropic: "claude-opus-4-6" -> copilot: "claude-opus-4.6"
 *
 * OpenAI models already use dots and map 1:1 in most cases.
 *
 * This table is hardcoded — no runtime fetching or regex heuristics.
 * Model availability verified against GitHub Copilot docs (2026-02).
 */

// =============================================================================
// Copilot Model Map
// =============================================================================

/**
 * Maps source provider model IDs to their github-copilot equivalents.
 *
 * Key:   model ID as used by the source provider (anthropic, openai, etc.)
 * Value: model ID as accepted by the github-copilot API
 */
export const COPILOT_MODEL_MAP: Record<string, string> = {
	// =========================================================================
	// Anthropic Models
	// =========================================================================
	"claude-opus-4-6": "claude-opus-4.6",
	"claude-opus-4-5": "claude-opus-4.5",
	"claude-sonnet-4-5": "claude-sonnet-4.5",
	"claude-sonnet-4": "claude-sonnet-4",
	"claude-haiku-4-5": "claude-haiku-4.5",

	// =========================================================================
	// OpenAI Models — GPT-5.x family
	// =========================================================================
	"gpt-5.3-codex": "gpt-5.3-codex",
	"gpt-5.2-codex": "gpt-5.2-codex",
	"gpt-5.2": "gpt-5.2",
	"gpt-5.1-codex-max": "gpt-5.1-codex-max",
	"gpt-5.1-codex": "gpt-5.1-codex",
	"gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5.1": "gpt-5.1",

	// =========================================================================
	// OpenAI Models — GPT-4.x / GPT-5 base
	// =========================================================================
	"gpt-4.1": "gpt-4.1",
	"gpt-5": "gpt-5",
	"gpt-5-mini": "gpt-5-mini",

	// =========================================================================
	// Google Models
	// =========================================================================
	"gemini-2.5-pro": "gemini-2.5-pro",
	"gemini-3-flash": "gemini-3-flash",
	"gemini-3-pro": "gemini-3-pro",
};

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Parse a full model string (e.g. "anthropic/claude-opus-4-6") into provider
 * and model components by splitting on the first "/".
 *
 * If there is no "/" the entire string is treated as the model ID with an
 * empty provider.
 */
export function parseModelString(fullModelID: string): {
	providerID: string;
	modelID: string;
} {
	const slashIndex = fullModelID.indexOf("/");
	if (slashIndex === -1) {
		return { providerID: "", modelID: fullModelID };
	}
	return {
		providerID: fullModelID.slice(0, slashIndex),
		modelID: fullModelID.slice(slashIndex + 1),
	};
}

/**
 * Map a source-provider model ID to its github-copilot equivalent.
 *
 * Accepts either a bare model ID ("claude-opus-4-6") or a fully-qualified
 * string ("anthropic/claude-opus-4-6") — the provider prefix is stripped
 * before lookup.
 *
 * @returns The copilot model ID, or `null` if no mapping exists.
 */
export function mapModelToCopilot(modelID: string): string | null {
	const { modelID: bare } = parseModelString(modelID);

	if (COPILOT_MODEL_MAP[bare] !== undefined) {
		return COPILOT_MODEL_MAP[bare];
	}

	const lower = bare.toLowerCase();
	for (const key of Object.keys(COPILOT_MODEL_MAP)) {
		if (key.toLowerCase() === lower) {
			return COPILOT_MODEL_MAP[key];
		}
	}

	return null;
}

/**
 * Check whether a model has a known github-copilot equivalent.
 *
 * Accepts bare or fully-qualified model IDs (same as `mapModelToCopilot`).
 */
export function isModelCopilotAvailable(modelID: string): boolean {
	return mapModelToCopilot(modelID) !== null;
}
