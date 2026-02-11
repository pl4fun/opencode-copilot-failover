/**
 * Model Mapper — maps source provider model IDs to github-copilot model IDs
 * and provides a ranked fallback chain when the exact model isn't available.
 *
 * GitHub Copilot uses DOTS in version numbers where Anthropic uses DASHES.
 * e.g. anthropic: "claude-opus-4-6" -> copilot: "claude-opus-4.6"
 *
 * Verified against `opencode models github-copilot` output (2026-02-10).
 */

/**
 * Maps source provider model IDs to their github-copilot equivalents.
 *
 * Key:   model ID as used by the source provider (anthropic, openai, google, etc.)
 * Value: model ID as accepted by the github-copilot API
 */
export const COPILOT_MODEL_MAP: Record<string, string> = {
	// Anthropic
	"claude-opus-4-6": "claude-opus-4.6",
	"claude-opus-4.6": "claude-opus-4.6",
	"claude-opus-4-5": "claude-opus-4.5",
	"claude-opus-4.5": "claude-opus-4.5",
	"claude-opus-4-1": "claude-opus-41",
	"claude-opus-4.1": "claude-opus-41",
	"claude-opus-41": "claude-opus-41",
	"claude-sonnet-4-5": "claude-sonnet-4.5",
	"claude-sonnet-4.5": "claude-sonnet-4.5",
	"claude-sonnet-4": "claude-sonnet-4",
	"claude-haiku-4-5": "claude-haiku-4.5",
	"claude-haiku-4.5": "claude-haiku-4.5",

	// OpenAI
	"gpt-5.2-codex": "gpt-5.2-codex",
	"gpt-5.2": "gpt-5.2",
	"gpt-5.1-codex-max": "gpt-5.1-codex-max",
	"gpt-5.1-codex": "gpt-5.1-codex",
	"gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
	"gpt-5.1": "gpt-5.1",
	"gpt-5": "gpt-5",
	"gpt-5-mini": "gpt-5-mini",
	"gpt-4.1": "gpt-4.1",
	"gpt-4o": "gpt-4o",

	// Google
	"gemini-2.5-pro": "gemini-2.5-pro",
	"gemini-3-flash": "gemini-3-flash-preview",
	"gemini-3-flash-preview": "gemini-3-flash-preview",
	"gemini-3-pro": "gemini-3-pro-preview",
	"gemini-3-pro-preview": "gemini-3-pro-preview",

	// xAI
	"grok-code-fast-1": "grok-code-fast-1",
};

/**
 * Fallback chain — ordered list of model IDs to try when the original
 * model isn't available in copilot. Walked top-to-bottom, first match wins.
 *
 * Order per user spec:
 *   1. claude-opus (latest)
 *   2. openai codex (latest)
 *   3. claude-sonnet (latest)
 *   4. kimi-2.5
 *   5. any remaining
 */
export const FALLBACK_CHAIN: readonly string[] = [
	"claude-opus-4.6",
	"claude-opus-4.5",
	"gpt-5.3-codex",
	"gpt-5.2-codex",
	"claude-sonnet-4.5",
	"kimi-2.5",
	"gpt-5.2",
	"gpt-5-mini",
	"gemini-3-pro-preview",
	"gemini-3-flash-preview",
	"grok-code-fast-1",
	"claude-haiku-4.5",
];

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
 * Returns `null` if no direct mapping exists (use `resolveWithFallback` for chain).
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
 * Resolve a model to a copilot equivalent, falling back through the
 * ranked chain if no direct mapping exists.
 *
 * @param modelID - The original model ID (bare or fully-qualified)
 * @param availableModels - Set of model IDs currently available in copilot.
 *   If provided, both direct mapping and fallback are validated against it.
 *   If null/undefined, the hardcoded map and chain are trusted as-is.
 */
export function resolveWithFallback(
	modelID: string,
	availableModels?: ReadonlySet<string> | null,
): string | null {
	const { modelID: bare } = parseModelString(modelID);

	// 1. Try the original model ID as-is against copilot's available models
	if (isAvailable(bare, availableModels)) {
		return bare;
	}

	// 2. Try the mapped name (e.g. claude-opus-4-6 -> claude-opus-4.6)
	const mappedMatch = mapModelToCopilot(modelID);
	if (mappedMatch && mappedMatch !== bare && isAvailable(mappedMatch, availableModels)) {
		return mappedMatch;
	}

	// 3. Walk the fallback chain
	for (const candidate of FALLBACK_CHAIN) {
		if (candidate === bare || candidate === mappedMatch) continue;
		if (isAvailable(candidate, availableModels)) {
			return candidate;
		}
	}

	return null;
}

function isAvailable(
	modelID: string,
	availableModels?: ReadonlySet<string> | null,
): boolean {
	if (!availableModels) return true;
	return availableModels.has(modelID);
}

export function isModelCopilotAvailable(modelID: string): boolean {
	return mapModelToCopilot(modelID) !== null;
}
