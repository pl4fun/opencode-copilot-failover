# opencode-copilot-failover

Automatic provider failover plugin for opencode — switches to GitHub Copilot when primary providers fail.

## How it works

1. Listens for `session.error` events after all built-in retries are exhausted
2. Detects retryable errors (429, 500, 502, 503, 529, unknown errors)
3. Maps the failed model to its GitHub Copilot equivalent
4. Re-prompts the session via the copilot provider
5. Shows a toast notification in the TUI

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-copilot-failover"]
}
```

Or alongside other plugins:

```json
{
  "plugin": ["oh-my-opencode@latest", "opencode-openai-codex-auth", "opencode-copilot-failover"]
}
```

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
| `gemini-3-flash` | `gemini-3-flash` |
| `gemini-3-pro` | `gemini-3-pro` |

## Behavior

- **Zero-config** — works out of the box
- **Per-request failover** — always tries the primary provider first
- **Prevents infinite loops** — won't failover if already on copilot
- **Prevents duplicate failovers** — won't retry the same message twice

## Limitations

- GitHub Copilot must be authenticated in opencode
- Not all models are available on copilot (unmapped models are skipped)
- If copilot also fails, no further failover occurs
