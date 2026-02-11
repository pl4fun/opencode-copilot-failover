import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventSessionError, OpencodeClient } from "@opencode-ai/sdk";
import { CopilotFailoverEngine } from "../lib/failover-engine.js";

const COPILOT_MODELS: Record<string, object> = {
	"claude-opus-4.6": {},
	"claude-opus-4.5": {},
	"claude-opus-41": {},
	"claude-sonnet-4.5": {},
	"claude-sonnet-4": {},
	"claude-haiku-4.5": {},
	"gpt-5.2-codex": {},
	"gpt-5.1-codex-max": {},
	"gpt-5.1-codex": {},
	"gpt-5.1-codex-mini": {},
	"gpt-5.2": {},
	"gpt-5.1": {},
	"gpt-5": {},
	"gpt-5-mini": {},
	"gpt-4.1": {},
	"gpt-4o": {},
	"gemini-2.5-pro": {},
	"gemini-3-flash-preview": {},
	"gemini-3-pro-preview": {},
	"grok-code-fast-1": {},
};

function createMockMessages(overrides?: {
	providerID?: string;
	modelID?: string;
	errorName?: string;
	agent?: string;
	system?: string;
	tools?: Record<string, boolean>;
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
				agent: overrides?.agent ?? "sisyphus",
				model: { providerID, modelID },
				system: overrides?.system,
				tools: overrides?.tools,
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

function createMockClient(
	messagesData?: unknown,
	copilotModels?: Record<string, object> | null,
) {
	return {
		session: {
			messages: vi.fn().mockResolvedValue({ data: messagesData ?? createMockMessages() }),
			promptAsync: vi.fn().mockResolvedValue({ data: undefined }),
		},
		tui: {
			publish: vi.fn().mockResolvedValue({ data: true }),
			showToast: vi.fn().mockResolvedValue({ data: true }),
		},
		config: {
			providers: vi.fn().mockResolvedValue({
				data: {
					providers: [
						{
							id: "github-copilot",
							name: "GitHub Copilot",
							source: "config",
							env: [],
							options: {},
							models: copilotModels ?? COPILOT_MODELS,
						},
						{
							id: "anthropic",
							name: "Anthropic",
							source: "env",
							env: [],
							options: {},
							models: { "claude-opus-4-6": {} },
						},
					],
				},
			}),
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

function getPublishCalls(client: ReturnType<typeof createMockClient>) {
	return (client.tui.publish as ReturnType<typeof vi.fn>).mock.calls;
}

function getProvidersCallCount(client: ReturnType<typeof createMockClient>) {
	return (client.config.providers as ReturnType<typeof vi.fn>).mock.calls.length;
}

describe("CopilotFailoverEngine", () => {
	let client: ReturnType<typeof createMockClient>;
	let engine: CopilotFailoverEngine;

	beforeEach(() => {
		client = createMockClient();
		engine = new CopilotFailoverEngine(client as unknown as OpencodeClient);
	});

	it("emits error toast when provider is already github-copilot", async () => {
		const copilotClient = createMockClient(
			createMockMessages({ providerID: "github-copilot", modelID: "claude-opus-4.6" }),
		);
		const copilotEngine = new CopilotFailoverEngine(copilotClient as unknown as OpencodeClient);

		await copilotEngine.handleSessionError(createErrorEvent());

		expect(copilotClient.session.promptAsync).not.toHaveBeenCalled();
		const calls = getPublishCalls(copilotClient);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].body.properties.variant).toBe("error");
		expect(calls[0][0].body.properties.title).toBe("Copilot Failover Failed");
	});

	it("emits error toast when model has no copilot mapping and no fallback available", async () => {
		const unknownClient = createMockClient(
			createMockMessages({ providerID: "anthropic", modelID: "some-unknown-model" }),
			{},
		);
		const unknownEngine = new CopilotFailoverEngine(unknownClient as unknown as OpencodeClient);

		await unknownEngine.handleSessionError(createErrorEvent());

		expect(unknownClient.session.promptAsync).not.toHaveBeenCalled();
		const calls = getPublishCalls(unknownClient);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].body.properties.variant).toBe("error");
		expect(calls[0][0].body.properties.title).toBe("Copilot Failover Unavailable");
	});

	it("prevents duplicate failover on same parentID", async () => {
		await engine.handleSessionError(createErrorEvent());
		await engine.handleSessionError(createErrorEvent());

		expect(client.session.promptAsync).toHaveBeenCalledTimes(1);
	});

	it("fails over to github-copilot with direct model match", async () => {
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

		const calls = getPublishCalls(client);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].body.properties.variant).toBe("warning");
		expect(calls[0][0].body.properties.duration).toBeUndefined();
	});

	it("preserves agent, system prompt, and tools from original user message", async () => {
		const customMessages = createMockMessages({
			agent: "explore",
			system: "You are a code explorer",
			tools: { grep: true, read: true, write: false },
		});
		const customClient = createMockClient(customMessages);
		const customEngine = new CopilotFailoverEngine(customClient as unknown as OpencodeClient);

		await customEngine.handleSessionError(createErrorEvent());

		const promptAsync = customClient.session.promptAsync as ReturnType<typeof vi.fn>;
		expect(promptAsync).toHaveBeenCalledTimes(1);
		const promptCall = promptAsync.mock.calls[0][0] as {
			body: {
				agent: string;
				system: string;
				tools: Record<string, boolean>;
				model: { providerID: string; modelID: string };
			};
		};
		expect(promptCall.body.agent).toBe("explore");
		expect(promptCall.body.system).toBe("You are a code explorer");
		expect(promptCall.body.tools).toEqual({ grep: true, read: true, write: false });
		expect(promptCall.body.model.providerID).toBe("github-copilot");
	});

	it("uses fallback when direct mapping not available in copilot", async () => {
		const limitedClient = createMockClient(
			createMockMessages({ providerID: "anthropic", modelID: "claude-opus-4-6" }),
			{ "gpt-5.2-codex": {} },
		);
		const limitedEngine = new CopilotFailoverEngine(limitedClient as unknown as OpencodeClient);

		await limitedEngine.handleSessionError(createErrorEvent());

		const promptAsync = limitedClient.session.promptAsync as ReturnType<typeof vi.fn>;
		expect(promptAsync).toHaveBeenCalledTimes(1);
		const promptCall = promptAsync.mock.calls[0][0] as {
			body: { model: { providerID: string; modelID: string } };
		};
		expect(promptCall.body.model.modelID).toBe("gpt-5.2-codex");
	});

	it("caches providers result (only calls providers API once)", async () => {
		await engine.handleSessionError(createErrorEvent());

		const event2 = createErrorEvent("test-session-2");
		const messages2 = createMockMessages();
		messages2[0].info.sessionID = "test-session-2";
		messages2[1].info.sessionID = "test-session-2";
		(client.session.messages as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: messages2 });
		await engine.handleSessionError(event2);

		expect(getProvidersCallCount(client)).toBe(1);
	});

	it("proceeds without filtering when providers API fails", async () => {
		const failingClient = createMockClient();
		(failingClient.config.providers as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("providers API down"),
		);
		const failingEngine = new CopilotFailoverEngine(failingClient as unknown as OpencodeClient);

		await failingEngine.handleSessionError(createErrorEvent());

		const promptAsync = failingClient.session.promptAsync as ReturnType<typeof vi.fn>;
		expect(promptAsync).toHaveBeenCalledTimes(1);
		const promptCall = promptAsync.mock.calls[0][0] as {
			body: { model: { providerID: string; modelID: string } };
		};
		expect(promptCall.body.model.modelID).toBe("claude-opus-4-6");
	});

	it("falls back to showToast when publish fails", async () => {
		const fallbackClient = createMockClient();
		(fallbackClient.tui.publish as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("publish unsupported"),
		);
		const fallbackEngine = new CopilotFailoverEngine(
			fallbackClient as unknown as OpencodeClient,
		);

		await fallbackEngine.handleSessionError(createErrorEvent());

		expect(fallbackClient.tui.publish).toHaveBeenCalledTimes(1);
		expect(fallbackClient.tui.showToast).toHaveBeenCalledTimes(1);
	});

	it("emits error toast when engine crashes internally", async () => {
		const crashClient = createMockClient();
		(crashClient.session.messages as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("network failure"),
		);
		const crashEngine = new CopilotFailoverEngine(
			crashClient as unknown as OpencodeClient,
		);

		await expect(
			crashEngine.handleSessionError(createErrorEvent()),
		).resolves.toBeUndefined();

		const calls = getPublishCalls(crashClient);
		expect(calls).toHaveLength(1);
		expect(calls[0][0].body.properties.variant).toBe("error");
		expect(calls[0][0].body.properties.title).toBe("Copilot Failover Error");
		expect(calls[0][0].body.properties.message).toBe("network failure");
	});

	it("does not throw even when both toast methods fail", async () => {
		const totalFailClient = createMockClient();
		(totalFailClient.session.messages as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("network failure"),
		);
		(totalFailClient.tui.publish as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("publish broken"),
		);
		(totalFailClient.tui.showToast as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("toast broken"),
		);
		const totalFailEngine = new CopilotFailoverEngine(
			totalFailClient as unknown as OpencodeClient,
		);

		await expect(
			totalFailEngine.handleSessionError(createErrorEvent()),
		).resolves.toBeUndefined();
	});
});
