import type { Plugin } from "@opencode-ai/plugin";
import type { EventSessionError } from "@opencode-ai/sdk";
import { CopilotFailoverEngine } from "./lib/failover-engine.js";

const plugin: Plugin = async (ctx) => {
  const engine = new CopilotFailoverEngine(ctx.client);

  return {
    event: async ({ event }) => {
      if (event.type === "session.error") {
        await engine.handleSessionError(event as EventSessionError);
      }
    },
  };
};

export default plugin;
