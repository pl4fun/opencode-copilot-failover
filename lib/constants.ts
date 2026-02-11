/** Plugin identifier for logging and toast notifications */
export const PLUGIN_NAME = "opencode-copilot-failover" as const;

/** The target failover provider ID */
export const COPILOT_PROVIDER_ID = "github-copilot" as const;

/** Providers eligible for failover (any non-copilot provider) */
export const FAILOVER_PROVIDERS = ["anthropic", "openai"] as const;

/** HTTP status codes that trigger failover */
export const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 529] as const;

/** Log prefix for console messages */
export const LOG_PREFIX = "[copilot-failover]" as const;
