import { describe, it, expect } from "vitest";
import type {
	ApiError,
	ProviderAuthError,
	MessageAbortedError,
	MessageOutputLengthError,
	UnknownError,
	EventSessionError,
} from "@opencode-ai/sdk";
import {
	isRetryableProviderError,
	extractFailoverTrigger,
} from "../lib/error-detector.js";

// ---------------------------------------------------------------------------
// Mock error factories
// ---------------------------------------------------------------------------

function makeAPIError(overrides?: Partial<ApiError["data"]>): ApiError {
	return {
		name: "APIError" as const,
		data: {
			message: "rate limited",
			isRetryable: true,
			statusCode: 429,
			...overrides,
		},
	};
}

function makeProviderAuthError(): ProviderAuthError {
	return {
		name: "ProviderAuthError" as const,
		data: { providerID: "anthropic", message: "invalid key" },
	};
}

function makeMessageAbortedError(message = "The operation was aborted."): MessageAbortedError {
	return {
		name: "MessageAbortedError" as const,
		data: { message },
	};
}

function makeMessageOutputLengthError(): MessageOutputLengthError {
	return {
		name: "MessageOutputLengthError" as const,
		data: {},
	};
}

function makeUnknownError(): UnknownError {
	return {
		name: "UnknownError" as const,
		data: { message: "something went wrong" },
	};
}

function makeSessionErrorEvent(
	error?: EventSessionError["properties"]["error"],
): EventSessionError {
	return {
		type: "session.error",
		properties: {
			sessionID: "test-session-1",
			error,
		},
	};
}

// ---------------------------------------------------------------------------
// isRetryableProviderError
// ---------------------------------------------------------------------------

describe("isRetryableProviderError", () => {
	it("returns true for APIError with isRetryable: true", () => {
		expect(isRetryableProviderError(makeAPIError({ isRetryable: true }))).toBe(
			true,
		);
	});

	it("returns true for APIError with statusCode 429 even if isRetryable is false", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({ statusCode: 429, isRetryable: false }),
			),
		).toBe(true);
	});

	it("returns true for APIError with statusCode 529", () => {
		expect(
			isRetryableProviderError(makeAPIError({ statusCode: 529 })),
		).toBe(true);
	});

	it("returns false for ProviderAuthError", () => {
		expect(isRetryableProviderError(makeProviderAuthError())).toBe(false);
	});

	it("returns true for generic MessageAbortedError", () => {
		expect(isRetryableProviderError(makeMessageAbortedError())).toBe(true);
	});

	it("returns false for user-cancel MessageAbortedError", () => {
		expect(
			isRetryableProviderError(
				makeMessageAbortedError("Operation canceled by user via Ctrl+C"),
			),
		).toBe(false);
	});

	it("returns false for MessageOutputLengthError", () => {
		expect(isRetryableProviderError(makeMessageOutputLengthError())).toBe(
			false,
		);
	});

	it("returns true for UnknownError", () => {
		expect(isRetryableProviderError(makeUnknownError())).toBe(true);
	});

	it("returns true for APIError with statusCode 500 (server error)", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({ statusCode: 500, isRetryable: false }),
			),
		).toBe(true);
	});

	it("returns true for APIError with timeout status 408", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({ statusCode: 408, isRetryable: false }),
			),
		).toBe(true);
	});

	it("returns true for APIError with quota message even without retryable status code", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({
					statusCode: 403,
					isRetryable: false,
					message: "quota exceeded for this account",
				}),
			),
		).toBe(true);
	});

	it("returns true for APIError with timeout text in response body", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({
					statusCode: 400,
					isRetryable: false,
					message: "request failed",
					responseBody: "upstream timed out while waiting",
				}),
			),
		).toBe(true);
	});

	it("returns false for APIError with non-retryable status and isRetryable false", () => {
		expect(
			isRetryableProviderError(
				makeAPIError({
					statusCode: 400,
					isRetryable: false,
					message: "bad request",
					responseBody: "validation error",
				}),
			),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// extractFailoverTrigger
// ---------------------------------------------------------------------------

describe("extractFailoverTrigger", () => {
	it("returns null when event has no error", () => {
		expect(extractFailoverTrigger(makeSessionErrorEvent(undefined))).toBeNull();
	});

	it("returns FailoverTrigger for retryable APIError", () => {
		const trigger = extractFailoverTrigger(
			makeSessionErrorEvent(makeAPIError({ statusCode: 429, isRetryable: true })),
		);
		expect(trigger).not.toBeNull();
		expect(trigger!.statusCode).toBe(429);
		expect(trigger!.reason).toContain("429");
	});

	it("returns null for non-retryable ProviderAuthError", () => {
		expect(
			extractFailoverTrigger(makeSessionErrorEvent(makeProviderAuthError())),
		).toBeNull();
	});

	it("returns FailoverTrigger for UnknownError (always retryable)", () => {
		const trigger = extractFailoverTrigger(
			makeSessionErrorEvent(makeUnknownError()),
		);
		expect(trigger).not.toBeNull();
		expect(trigger!.reason).toContain("Unknown error");
	});

	it("returns FailoverTrigger for generic MessageAbortedError", () => {
		const trigger = extractFailoverTrigger(
			makeSessionErrorEvent(makeMessageAbortedError()),
		);
		expect(trigger).not.toBeNull();
		expect(trigger!.reason).toContain("MessageAbortedError");
	});

	it("returns null for user-cancel MessageAbortedError", () => {
		expect(
			extractFailoverTrigger(
				makeSessionErrorEvent(
					makeMessageAbortedError("Operation cancelled by user"),
				),
			),
		).toBeNull();
	});

	it("returns null for MessageOutputLengthError", () => {
		expect(
			extractFailoverTrigger(
				makeSessionErrorEvent(makeMessageOutputLengthError()),
			),
		).toBeNull();
	});

	it("returns FailoverTrigger when APIError has usage-limit text signal", () => {
		const trigger = extractFailoverTrigger(
			makeSessionErrorEvent(
				makeAPIError({
					statusCode: 403,
					isRetryable: false,
					message: "usage limit reached",
				}),
			),
		);
		expect(trigger).not.toBeNull();
		expect(trigger!.reason).toContain("usage limit reached");
	});
});
