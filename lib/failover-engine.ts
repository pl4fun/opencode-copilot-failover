import type {
	EventSessionError,
	AssistantMessage,
	Part,
	TextPartInput,
	FilePartInput,
	OpencodeClient,
} from "@opencode-ai/sdk";

import { COPILOT_PROVIDER_ID, LOG_PREFIX } from "./constants.js";
import { extractFailoverTrigger } from "./error-detector.js";
import { mapModelToCopilot } from "./model-mapper.js";

type PromptPartInput = TextPartInput | FilePartInput;

/**
 * Detects provider errors, maps models to github-copilot equivalents,
 * and re-prompts sessions via the SDK client. Must NEVER throw.
 */
export class CopilotFailoverEngine {
	private readonly dedup = new Map<string, Set<string>>();

	constructor(private readonly client: OpencodeClient) {}

	async handleSessionError(event: EventSessionError): Promise<void> {
		try {
			await this.processError(event);
		} catch (err) {
			console.log(
				LOG_PREFIX,
				"Unexpected error in failover engine:",
				err,
			);
		}
	}

	private async processError(event: EventSessionError): Promise<void> {
		const error = event.properties.error;
		if (!error) return;
		const sessionID = event.properties.sessionID;
		if (!sessionID) return;

		const trigger = extractFailoverTrigger(event);
		if (!trigger) {
			console.log(LOG_PREFIX, `Non-retryable error for session ${sessionID}, skipping`);
			return;
		}

		console.log(LOG_PREFIX, `Failover trigger: ${trigger.reason} (session: ${sessionID})`);

		const messagesResult = await this.client.session.messages({
			path: { id: sessionID },
		});
		const messages = messagesResult.data;
		if (!messages || messages.length === 0) {
			console.log(LOG_PREFIX, "No messages found in session");
			return;
		}

		const failedEntry = [...messages]
			.reverse()
			.find(
				(m) => m.info.role === "assistant" && (m.info as AssistantMessage).error,
			);
		if (!failedEntry) {
			console.log(LOG_PREFIX, "No failed assistant message found");
			return;
		}

		const failedAssistant = failedEntry.info as AssistantMessage;
		const originalProvider = failedAssistant.providerID;
		const originalModel = failedAssistant.modelID;

		// Prevent infinite loop — skip if already on copilot
		if (originalProvider === COPILOT_PROVIDER_ID) {
			console.log(LOG_PREFIX, "Already on copilot, skipping");
			return;
		}

		const parentID = failedAssistant.parentID;
		if (this.isDuplicate(sessionID, parentID)) {
			console.log(LOG_PREFIX, `Already failed over parentID ${parentID}, skipping`);
			return;
		}

		const copilotModelID = mapModelToCopilot(originalModel);
		if (!copilotModelID) {
			console.log(LOG_PREFIX, `No copilot mapping for "${originalModel}", skipping`);
			return;
		}

		const userEntry = messages.find((m) => m.info.id === parentID);
		if (!userEntry) {
			console.log(LOG_PREFIX, `User message ${parentID} not found, skipping`);
			return;
		}

		const inputParts = this.convertPartsToInput(userEntry.parts);
		if (inputParts.length === 0) {
			console.log(LOG_PREFIX, "No convertible parts found, skipping");
			return;
		}

		console.log(
			LOG_PREFIX,
			`Re-prompting ${sessionID} with ${COPILOT_PROVIDER_ID}/${copilotModelID}`,
		);

		await this.client.session.promptAsync({
			path: { id: sessionID },
			body: {
				parts: inputParts,
				model: {
					providerID: COPILOT_PROVIDER_ID,
					modelID: copilotModelID,
				},
			},
		});

		await this.client.tui.showToast({
			body: {
				title: "Provider Failover",
				message: `Switched from ${originalProvider}/${originalModel} to ${COPILOT_PROVIDER_ID}/${copilotModelID}`,
				variant: "warning",
				duration: 5000,
			},
		});

		this.recordDedup(sessionID, parentID);
		console.log(LOG_PREFIX, "Failover complete");
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
