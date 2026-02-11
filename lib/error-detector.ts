import type {
  ApiError,
  EventSessionError,
  MessageAbortedError,
  MessageOutputLengthError,
  ProviderAuthError,
  UnknownError,
} from "@opencode-ai/sdk";

import { RETRYABLE_STATUS_CODES } from "./constants.js";

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

const RETRYABLE_TEXT_SIGNALS = [
  "rate limit",
  "too many requests",
  "quota",
  "usage limit",
  "billing limit",
  "capacity",
  "overloaded",
  "service unavailable",
  "temporarily unavailable",
  "timeout",
  "timed out",
  "deadline exceeded",
] as const;

const USER_ABORT_TEXT_SIGNALS = [
  "user cancelled",
  "user canceled",
  "cancelled by user",
  "canceled by user",
  "aborted by user",
  "ctrl+c",
  "ctrl-c",
] as const;

export function isRetryableProviderError(error: SessionError): boolean {
  switch (error.name) {
    case "APIError": {
      if (error.data.isRetryable) return true;
      if (error.data.statusCode === 408) return true;
      if (
        error.data.statusCode !== undefined &&
        (RETRYABLE_STATUS_CODES as readonly number[]).includes(
          error.data.statusCode,
        )
      ) {
        return true;
      }
      if (hasRetryableTextSignal(error.data.message, error.data.responseBody)) {
        return true;
      }
      return false;
    }

    case "ProviderAuthError":
      return false;

    case "MessageAbortedError":
      return !isLikelyUserAbort(error.data.message);

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

function hasRetryableTextSignal(message: string, responseBody?: string): boolean {
  const haystack = `${message}\n${responseBody ?? ""}`.toLowerCase();
  return RETRYABLE_TEXT_SIGNALS.some((signal) => haystack.includes(signal));
}

function isLikelyUserAbort(message: string): boolean {
  const normalized = message.toLowerCase();
  return USER_ABORT_TEXT_SIGNALS.some((signal) => normalized.includes(signal));
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
