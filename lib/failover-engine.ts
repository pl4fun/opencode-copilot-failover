import type {
	EventSessionError,
	EventTuiToastShow,
	AssistantMessage,
	UserMessage,
	Part,
	TextPartInput,
	FilePartInput,
	AgentPartInput,
	SubtaskPartInput,
	OpencodeClient,
} from "@opencode-ai/sdk";

import { COPILOT_PROVIDER_ID } from "./constants.js";
import { extractFailoverTrigger } from "./error-detector.js";
import { resolveWithFallback } from "./model-mapper.js";

type PromptPartInput =
	| TextPartInput
	| FilePartInput
	| AgentPartInput
	| SubtaskPartInput;
type ToastVariant = "info" | "success" | "warning" | "error";
type ToastPayload = {
	title?: string;
	message: string;
	variant: ToastVariant;
	duration?: number;
};

/**
 * Detects provider errors, maps models to github-copilot equivalents,
 * and re-prompts sessions via the SDK client. Must NEVER throw.
 */
export class CopilotFailoverEngine {
	private readonly dedup = new Map<string, Set<string>>();
	private cachedCopilotModels: Set<string> | null = null;

	constructor(private readonly client: OpencodeClient) {}

	/**
	 * Discover which models are available in the github-copilot provider.
	 * Result is cached for the lifetime of the engine instance.
	 */
	private async discoverCopilotModels(): Promise<Set<string> | null> {
		if (this.cachedCopilotModels) return this.cachedCopilotModels;

		try {
			const result = await this.client.config.providers();
			const providers = result.data?.providers;
			if (!providers) return null;

			const copilotProvider = providers.find(
				(p) => p.id === COPILOT_PROVIDER_ID,
			);
			if (!copilotProvider?.models) return null;

			this.cachedCopilotModels = new Set(
				Object.keys(copilotProvider.models),
			);
			return this.cachedCopilotModels;
		} catch {
			// If the providers API fails, proceed without availability filtering
			return null;
		}
	}

	async handleSessionError(event: EventSessionError): Promise<void> {
		try {
			await this.processError(event);
		} catch (err) {
			await this.emitToast({
				title: "Copilot Failover Error",
				message: err instanceof Error ? err.message : String(err),
				variant: "error",
			}).catch(() => {});
		}
	}

	private async processError(event: EventSessionError): Promise<void> {
		const error = event.properties.error;
		if (!error) return;
		const sessionID = event.properties.sessionID;
		if (!sessionID) return;

		const trigger = extractFailoverTrigger(event);
		if (!trigger) return;

		const messagesResult = await this.client.session.messages({
			path: { id: sessionID },
		});
		const messages = messagesResult.data;
		if (!messages || messages.length === 0) return;

		const failedEntry = [...messages]
			.reverse()
			.find(
				(m) => m.info.role === "assistant" && (m.info as AssistantMessage).error,
			);
		if (!failedEntry) return;

		const failedAssistant = failedEntry.info as AssistantMessage;
		const originalProvider = failedAssistant.providerID;
		const originalModel = failedAssistant.modelID;

		if (originalProvider === COPILOT_PROVIDER_ID) {
			await this.emitToast({
				title: "Copilot Failover Failed",
				message: `${COPILOT_PROVIDER_ID}/${originalModel} also errored — no further fallback available`,
				variant: "error",
			});
			return;
		}

		const parentID = failedAssistant.parentID;
		if (this.isDuplicate(sessionID, parentID)) return;

		const availableModels = await this.discoverCopilotModels();
		const copilotModelID = resolveWithFallback(originalModel, availableModels);
		if (!copilotModelID) {
			await this.emitToast({
				title: "Copilot Failover Unavailable",
				message: `No copilot mapping for ${originalProvider}/${originalModel}`,
				variant: "error",
			});
			return;
		}

		const userEntry = messages.find((m) => m.info.id === parentID);
		if (!userEntry) return;

		const inputParts = this.convertPartsToInput(userEntry.parts);
		if (inputParts.length === 0) return;

		const userInfo = userEntry.info as UserMessage;
		const failoverAgent =
			this.readOptionalStringField(failedAssistant, "agent") || userInfo.agent;
		const promptBody: {
			parts: PromptPartInput[];
			model: {
				providerID: string;
				modelID: string;
			};
			agent: string;
			system: UserMessage["system"];
			tools: UserMessage["tools"];
		} = {
			parts: inputParts,
			model: {
				providerID: COPILOT_PROVIDER_ID,
				modelID: copilotModelID,
			},
			agent: failoverAgent,
			system: userInfo.system,
			tools: userInfo.tools,
		};

		await this.client.session.promptAsync({
			path: { id: sessionID },
			body: promptBody,
		});

		await this.emitFailoverToast(
			originalProvider,
			originalModel,
			copilotModelID,
			trigger.reason,
		);

		this.recordDedup(sessionID, parentID);
	}

	private async emitFailoverToast(
		fromProvider: string,
		fromModel: string,
		toModel: string,
		reason: string,
	): Promise<void> {
		await this.emitToast({
			title: "Provider switched to GitHub Copilot",
			message: `${fromProvider}/${fromModel} → ${COPILOT_PROVIDER_ID}/${toModel} (${reason})`,
			variant: "warning",
		});
	}

	private async emitToast(payload: ToastPayload): Promise<void> {
		const toastEvent: EventTuiToastShow = {
			type: "tui.toast.show",
			properties: {
				title: payload.title,
				message: payload.message,
				variant: payload.variant,
				duration: payload.duration,
			},
		};

		try {
			await this.client.tui.publish({ body: toastEvent });
			return;
		} catch {
			// publish unavailable, fall through to showToast
		}

		try {
			await this.client.tui.showToast({
				body: {
					title: payload.title,
					message: payload.message,
					variant: payload.variant,
					duration: payload.duration,
				},
			});
		} catch {
			// both toast methods failed — nothing we can do without polluting TUI
		}
	}

	/**
	 * Convert output Part[] (session.messages response) to input PartInput[]
	 * (session.prompt request). Only TextPart and FilePart map to user-input
	 * equivalents; assistant-side parts (tool, reasoning, step, etc.) are skipped.
	 */
	private convertPartsToInput(parts: Part[]): PromptPartInput[] {
		const result: PromptPartInput[] = [];

		for (const part of parts) {
			switch (part.type) {
				case "text": {
					result.push({
						type: "text",
						text: part.text,
					});
					break;
				}
				case "agent": {
					result.push({
						type: "agent",
						name: part.name,
						...(part.source ? { source: part.source } : {}),
					});
					break;
				}
				case "subtask": {
					result.push({
						type: "subtask",
						prompt: part.prompt,
						description: part.description,
						agent: part.agent,
					});
					break;
				}
				case "file": {
					result.push({
						type: "file",
						mime: part.mime,
						url: part.url,
						...(part.filename ? { filename: part.filename } : {}),
						...(part.source ? { source: part.source } : {}),
					});
					break;
				}
			}
		}

		return result;
	}

	private readOptionalStringField(data: unknown, field: string): string | undefined {
		if (!data || typeof data !== "object") return undefined;
		const record = data as Record<string, unknown>;
		const value = record[field];
		return typeof value === "string" ? value : undefined;
	}

	private isDuplicate(sessionID: string, parentID: string): boolean {
		const sessionSet = this.dedup.get(sessionID);
		return sessionSet !== undefined && sessionSet.has(parentID);
	}

	private recordDedup(sessionID: string, parentID: string): void {
		let sessionSet = this.dedup.get(sessionID);
		if (!sessionSet) {
			sessionSet = new Set();
			this.dedup.set(sessionID, sessionSet);
		}
		sessionSet.add(parentID);
	}
}
