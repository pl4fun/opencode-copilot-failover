import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventSessionError, OpencodeClient } from "@opencode-ai/sdk";
import { CopilotFailoverEngine } from "../lib/failover-engine.js";

function createMockMessages(overrides?: {
	providerID?: string;
	modelID?: string;
	errorName?: string;
}) {
	const providerID = overrides?.providerID ?? "anthropic";
	const modelID = overrides?.modelID ?? "claude-opus-4-6";

	return [
		{
			info: {
				id: "user-msg-1",
				sessionID: "test-session-1",
				role: "user" as const,
				time: { created: Date.now() },
				agent: "sisyphus",
				model: { providerID, modelID },
			},
			parts: [
				{
					id: "part-1",
					sessionID: "test-session-1",
					messageID: "user-msg-1",
					type: "text" as const,
					text: "Hello",
				},
			],
		},
		{
			info: {
				id: "assistant-msg-1",
				sessionID: "test-session-1",
				role: "assistant" as const,
				time: { created: Date.now() },
				parentID: "user-msg-1",
				modelID,
				providerID,
				mode: "default",
				path: { cwd: "/tmp", root: "/tmp" },
				cost: 0,
				tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
				error: {
					name: (overrides?.errorName ?? "APIError") as "APIError",
					data: { message: "rate limited", statusCode: 429, isRetryable: true },
				},
			},
			parts: [],
		},
	];
}

function createMockClient(messagesData?: unknown) {
	return {
		session: {
			messages: vi.fn().mockResolvedValue({ data: messagesData ?? createMockMessages() }),
			promptAsync: vi.fn().mockResolvedValue({ data: undefined }),
		},
		tui: {
			showToast: vi.fn().mockResolvedValue({ data: true }),
		},
	} as unknown as OpencodeClient;
}

function createErrorEvent(
	sessionID = "test-session-1",
): EventSessionError {
	return {
		type: "session.error",
		properties: {
			sessionID,
			error: {
				name: "APIError" as const,
				data: { message: "rate limited", statusCode: 429, isRetryable: true },
			},
		},
	};
}

describe("CopilotFailoverEngine", () => {
	let client: ReturnType<typeof createMockClient>;
	let engine: CopilotFailoverEngine;

	beforeEach(() => {
		client = createMockClient();
		engine = new CopilotFailoverEngine(client as unknown as OpencodeClient);
	});

	it("skips when provider is already github-copilot", async () => {
		const copilotClient = createMockClient(
			createMockMessages({ providerID: "github-copilot", modelID: "claude-opus-4.6" }),
		);
		const copilotEngine = new CopilotFailoverEngine(copilotClient as unknown as OpencodeClient);

		await copilotEngine.handleSessionError(createErrorEvent());

		expect(copilotClient.session.promptAsync).not.toHaveBeenCalled();
	});

	it("skips when model has no copilot mapping", async () => {
		const unknownClient = createMockClient(
			createMockMessages({ providerID: "anthropic", modelID: "some-unknown-model" }),
		);
		const unknownEngine = new CopilotFailoverEngine(unknownClient as unknown as OpencodeClient);

		await unknownEngine.handleSessionError(createErrorEvent());

		expect(unknownClient.session.promptAsync).not.toHaveBeenCalled();
	});

	it("prevents duplicate failover on same parentID", async () => {
		await engine.handleSessionError(createErrorEvent());
		await engine.handleSessionError(createErrorEvent());

		expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
	});

	it("successfully fails over to github-copilot with correct model", async () => {
		await engine.handleSessionError(createErrorEvent());

		const promptAsync = client.session.promptAsync as ReturnType<typeof vi.fn>;
		expect(promptAsync).toHaveBeenCalledTimes(1);
		const promptCall = promptAsync.mock.calls[0][0] as {
			body: { model: { providerID: string; modelID: string } };
		};
		expect(promptCall.body.model).toEqual({
			providerID: "github-copilot",
			modelID: "claude-opus-4.6",
		});

		const showToast = client.tui.showToast as ReturnType<typeof vi.fn>;
		expect(showToast).toHaveBeenCalledTimes(1);
		const toastCall = showToast.mock.calls[0][0] as {
			body: { variant: string };
		};
		expect(toastCall.body.variant).toBe("warning");
	});

	it("does not throw on client errors", async () => {
		const failingClient = createMockClient();
		(failingClient.session.messages as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("network failure"),
		);
		const failingEngine = new CopilotFailoverEngine(
			failingClient as unknown as OpencodeClient,
		);

		await expect(
			failingEngine.handleSessionError(createErrorEvent()),
		).resolves.toBeUndefined();
	});
});
