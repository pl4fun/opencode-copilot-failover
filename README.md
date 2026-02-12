# opencode-copilot-failover

Automatic provider failover plugin for opencode. It switches a failed request to GitHub Copilot while preserving the original agent, tools, system prompt, and model intent.

## What it does

1. Listens for `session.error` after opencode retries are exhausted.
2. Detects retryable provider failures (for example: `429`, `500`, `502`, `503`, `529`, timeout/capacity style errors).
3. Resolves the best GitHub Copilot model (direct map first, then fallback chain).
4. Re-prompts the same session through `github-copilot`.
5. Shows a TUI toast describing the provider/model switch.

## Requirements

- OpenCode installed and working.
- `github-copilot` provider authenticated in OpenCode.
- At least one non-copilot provider configured (for normal primary execution).

## Installation

No separate `npm install` command is required. OpenCode installs plugins automatically from the `plugin` array in your config.

### Recommended (pin version)

Use a pinned plugin version for predictable upgrades:

```json
{
  "plugin": ["opencode-copilot-failover@0.1.1"]
}
```

### Use latest

If you prefer tracking latest:

```json
{
  "plugin": ["opencode-copilot-failover"]
}
```

### With other plugins

```json
{
  "plugin": ["oh-my-opencode@latest", "opencode-openai-codex-auth", "opencode-copilot-failover@0.1.1"]
}
```

### Config file locations

- Global config: `~/.config/opencode/opencode.json`
- Project config: `<project>/.opencode.json`

Restart OpenCode after editing config so it installs/loads the plugin.

## Local development install

To test local changes without publishing:

```json
{
  "plugin": ["/absolute/path/to/opencode-copilot-failover"]
}
```

## Verify it is working

1. Start a session on a non-copilot model (for example `anthropic/...` or `openai/...`).
2. Trigger a retryable provider failure (rate-limit/server error scenario).
3. Confirm a toast appears indicating switch to `github-copilot/<model>`.
4. Confirm the request continues in the same session.

## Supported Models

| Source Model | Copilot Model |
| --- | --- |
| `claude-opus-4-6` | `claude-opus-4.6` |
| `claude-opus-4-5` | `claude-opus-4.5` |
| `claude-sonnet-4-5` | `claude-sonnet-4.5` |
| `claude-sonnet-4` | `claude-sonnet-4` |
| `claude-haiku-4-5` | `claude-haiku-4.5` |
| `gpt-5.3-codex` | `gpt-5.3-codex` |
| `gpt-5.2-codex` | `gpt-5.2-codex` |
| `gpt-5.2` | `gpt-5.2` |
| `gpt-5.1-codex-max` | `gpt-5.1-codex-max` |
| `gpt-5.1-codex` | `gpt-5.1-codex` |
| `gpt-5.1-codex-mini` | `gpt-5.1-codex-mini` |
| `gpt-5.1` | `gpt-5.1` |
| `gpt-4.1` | `gpt-4.1` |
| `gpt-5` | `gpt-5` |
| `gpt-5-mini` | `gpt-5-mini` |
| `gemini-2.5-pro` | `gemini-2.5-pro` |
| `gemini-3-flash` | `gemini-3-flash-preview` |
| `gemini-3-pro` | `gemini-3-pro-preview` |

## Behavior

- **Zero config runtime**: no extra setup beyond plugin entry.
- **Per-request failover**: primary provider always gets first attempt.
- **No infinite loops**: it does not re-failover if already on copilot.
- **Deduplicated retries**: same failed parent message is only failovered once.
- **Ordered fallback**: enforced prefix is `claude-opus-4.6 -> gpt-5.3-codex -> claude-opus-4.5`.
- **Free model normalization**: source model IDs ending in `-free` are normalized first (for example `kimi-k2.5-free` -> `kimi-k2.5`) before fallback chain resolution.

## Strict benchmark-ranked fallback (1 month freshness)

This plugin uses a strict fallback list derived from Terminal-Bench 2.0 leaderboard data with freshness window `<= 1 month` (snapshot date: `2026-02-11`, cutoff: `2026-01-11`) and filtered to models that are relevant to current GitHub Copilot routing:

1. `claude-opus-4.6` (enforced)
2. `gpt-5.3-codex` (enforced)
3. `claude-opus-4.5` (enforced)
4. `gemini-3-pro-preview` (fresh benchmark-backed tail)
5. `gpt-5.2` (fresh benchmark-backed tail)

## Limitations

- GitHub Copilot must be authenticated in OpenCode.
- Not all source models exist on Copilot (fallback chain is used when possible).
- If Copilot also fails, no further failover provider is attempted.
