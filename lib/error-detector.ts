import type {
  ApiError,
  EventSessionError,
  MessageAbortedError,
  MessageOutputLengthError,
  ProviderAuthError,
  UnknownError,
} from "@opencode-ai/sdk";

export type FailoverTrigger = {
  reason: string;
  statusCode?: number;
  provider: string;
  model: string;
};

type SessionError =
  | ProviderAuthError
  | UnknownError
  | MessageOutputLengthError
  | MessageAbortedError
  | ApiError;

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 529] as const;

export function isRetryableProviderError(error: SessionError): boolean {
  switch (error.name) {
    case "APIError": {
      if (error.data.isRetryable) return true;
      if (
        error.data.statusCode !== undefined &&
        (RETRYABLE_STATUS_CODES as readonly number[]).includes(
          error.data.statusCode,
        )
      ) {
        return true;
      }
      return false;
    }

    case "ProviderAuthError":
      return false;

    case "MessageAbortedError":
      return false;

    case "MessageOutputLengthError":
      return false;

    case "UnknownError":
      return true;

    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}

export function extractFailoverTrigger(
  event: EventSessionError,
): FailoverTrigger | null {
  const error = event.properties.error;
  if (!error) return null;

  if (!isRetryableProviderError(error)) return null;

  const trigger: FailoverTrigger = {
    reason: buildReason(error),
    provider: "",
    model: "",
  };

  if (error.name === "APIError" && error.data.statusCode !== undefined) {
    trigger.statusCode = error.data.statusCode;
  }

  return trigger;
}

function buildReason(error: SessionError): string {
  switch (error.name) {
    case "APIError":
      return error.data.statusCode
        ? `API error ${error.data.statusCode}: ${error.data.message}`
        : `API error: ${error.data.message}`;

    case "UnknownError":
      return `Unknown error: ${error.data.message}`;

    case "ProviderAuthError":
    case "MessageAbortedError":
    case "MessageOutputLengthError":
      return error.name;

    default: {
      const _exhaustive: never = error;
      return _exhaustive;
    }
  }
}
