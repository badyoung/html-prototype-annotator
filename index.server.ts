import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PluginServerContext,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import {
  getBundledSkillsStatusRpc,
  loadHtmlPrototypeRpc,
  manageBundledSkillsRpc,
  PROTOTYPE_HTML_CHUNK_CHARS,
  readPrototypeHtmlChunkRpc,
  renderMobilePrototypeRpc,
  submitPrototypeAnnotationsRpc,
} from "./shared/rpc";
import { prototypeAnnotatorSettings } from "./shared/settings";
import {
  disposeMobileRenderer,
  renderMobilePrototypeSnapshot,
  setCustomBrowserExecutablePath,
} from "./server/mobile-renderer";
import {
  applyPrototypeCreatePrompt,
  applyPrototypeOpenPrompt,
  ensurePrototypePromptFile,
} from "./server/prompt-injection";
import {
  loadHtmlPrototype,
  readPrototypeHtmlChunk,
  submitPrototypeAnnotations,
} from "./server/prototype-service";
import {
  getBundledSkillsStatus,
  manageBundledSkills,
} from "./server/skill-manager";

function isExternallyManagedPromptHub(): boolean {
  if (process.env.PASEO_PROMPT_HUB_MANAGED === "1") return true;
  const paseoHome =
    process.env.PASEO_HOME?.trim() || join(homedir(), ".paseo");
  return existsSync(join(paseoHome, "prompt-hub-managed"));
}

export default function contribute(server: PluginServerContext) {
  const promptFilePath = ensurePrototypePromptFile();
  const disposers: Array<() => void> = [];

  let injectAgentPrompt = true;
  const settings = server.registerSettings(prototypeAnnotatorSettings);
  const applySettings = (
    state: PluginSettingsState<typeof prototypeAnnotatorSettings.schema>,
  ) => {
    if (state.status !== "ready") return;
    injectAgentPrompt = state.values.injectAgentPrompt;
    setCustomBrowserExecutablePath(state.values.browserExecutablePath);
  };
  void settings.read().then(applySettings, () => undefined);
  disposers.push(settings.subscribe(applySettings));

  server.handle(loadHtmlPrototypeRpc, async (input) => {
    return loadHtmlPrototype({
      rawPath: input.rawPath,
      cwd: input.cwd ?? null,
      omitHtml: input.omitHtml,
      maxInlineChars: input.maxInlineChars ?? PROTOTYPE_HTML_CHUNK_CHARS,
    });
  });

  server.handle(readPrototypeHtmlChunkRpc, async (input) => {
    return readPrototypeHtmlChunk({
      resolvedPath: input.resolvedPath,
      offset: input.offset,
      maxChars: input.maxChars,
    });
  });

  server.handle(renderMobilePrototypeRpc, async (input) => {
    return renderMobilePrototypeSnapshot({
      resolvedPath: input.resolvedPath,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      cleanChrome: input.cleanChrome,
      clickXPct: input.clickXPct,
      clickYPct: input.clickYPct,
      scrollDeltaY: input.scrollDeltaY,
      scrollXPct: input.scrollXPct,
      scrollYPct: input.scrollYPct,
      resetSession: input.resetSession,
    });
  });

  server.handle(submitPrototypeAnnotationsRpc, async (input, context) => {
    return submitPrototypeAnnotations({
      resolvedPath: input.resolvedPath,
      fileName: input.fileName,
      agentId: input.agentId ?? null,
      pins: input.pins,
      overallNote: input.overallNote,
      approvedAsIs: input.approvedAsIs,
      sendToAgent: input.sendToAgent,
      locale: input.locale ?? null,
      paseo: context.paseo,
    });
  });

  server.handle(getBundledSkillsStatusRpc, async () => {
    return getBundledSkillsStatus();
  });

  server.handle(manageBundledSkillsRpc, async (input) => {
    return manageBundledSkills({
      action: input.action,
      skillIds: input.skillIds,
    });
  });

  // Standalone registry installations automatically guide top-level agents when enabled
  // in Settings; hosts running a centralized prompt hub skip duplicate hook registration.
  if (!isExternallyManagedPromptHub()) {
    disposers.push(
      server.addHook("agent.open.before", async ({ request }) => {
        if (!injectAgentPrompt) return undefined;
        const resolvedPath = promptFilePath ?? ensurePrototypePromptFile();
        return applyPrototypeOpenPrompt({ ...request }, resolvedPath);
      }),
    );

    disposers.push(
      server.addHook("agent.create.before", async ({ request }) => {
        if (!injectAgentPrompt) return undefined;
        return applyPrototypeCreatePrompt({
          ...request,
          config: { ...request.config },
        });
      }),
    );
  }

  return () => {
    disposeMobileRenderer();
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
