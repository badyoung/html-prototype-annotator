import {
  usePaseo,
  type PluginClientContext,
  type PluginScreenProps,
} from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import {
  extractFileName,
  extractHtmlPrototypeTargets,
  HTML_EXTENSIONS,
} from "./shared/annotations";
import { registerHtmlPrototypeBridge } from "./shared/bridge";
import {
  PrototypeAnnotatorWorkspace,
  type AgentTargetOption,
} from "./client/annotator-workspace";
import { HtmlPrototypeFilePanel } from "./client/file-panel";
import { protoLabel, useProtoI18n } from "./client/i18n";
import { PrototypeAnnotatorSettingsScreen } from "./client/settings-screen";
import {
  AssistantPrototypeMessageRenderer,
  PROTOTYPE_TIMELINE_KIND,
  PROTOTYPE_TIMELINE_VERSION,
  prototypeTimelineDataSchema,
} from "./client/timeline-message";

interface TopAgentRecord extends AgentTargetOption {
  cwd: string;
}

function PrototypeAnnotatorScreen({
  params,
  theme,
  layout,
  navigation,
}: PluginScreenProps) {
  const { t } = useProtoI18n();
  const paseo = usePaseo();
  const { height: winHeight } = useWindowDimensions();

  const [activePath, setActivePath] = useState(params.path ?? "");
  const [emptyDraftPath, setEmptyDraftPath] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    params.agentId ?? null,
  );
  const [agentOptions, setAgentOptions] = useState<TopAgentRecord[]>([]);
  const [directAgentInfo, setDirectAgentInfo] = useState<{
    id: string;
    title: string | null;
    cwd: string | null;
  } | null>(null);

  useEffect(() => {
    if (params.path) setActivePath(params.path);
    if (params.agentId) setSelectedAgentId(params.agentId);
  }, [params.path, params.agentId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await paseo.agents.list({ page: { limit: 40 } });
        if (cancelled) return;
        const tops = res.entries
          .filter(
            (e) =>
              !e.agent.archivedAt &&
              !e.agent.labels?.["paseo.parent-agent-id"],
          )
          .map((e) => ({
            id: e.agent.id,
            title:
              e.agent.title || `${e.agent.provider} (${e.agent.id.slice(0, 6)})`,
            cwd: e.agent.cwd,
          }));
        setAgentOptions(tops);
        if (!params.agentId && tops.length > 0) {
          setSelectedAgentId((prev) => prev ?? tops[0].id);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paseo, params.agentId]);

  useEffect(() => {
    if (!selectedAgentId) {
      setDirectAgentInfo(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await paseo.agents.ref(selectedAgentId).refresh();
        if (!cancelled && snap?.agent) {
          setDirectAgentInfo({
            id: snap.agent.id,
            title: snap.agent.title ?? null,
            cwd: snap.agent.cwd ?? null,
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paseo, selectedAgentId]);

  const matchedOption = agentOptions.find((a) => a.id === selectedAgentId);

  const effectiveCwd =
    params.cwd ||
    (directAgentInfo?.id === selectedAgentId ? directAgentInfo.cwd : null) ||
    matchedOption?.cwd ||
    null;

  const effectiveLabel =
    (selectedAgentId === params.agentId && params.agentTitle
      ? params.agentTitle
      : null) ||
    (directAgentInfo?.id === selectedAgentId ? directAgentInfo.title : null) ||
    matchedOption?.title ||
    null;

  const stageHeight = Math.max(360, winHeight - (layout.compact ? 116 : 96));

  if (!activePath.trim()) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.colors.surface0,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 480,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
            padding: 24,
            gap: 14,
            alignItems: "center",
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: "rgba(249, 115, 22, 0.14)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="Layers" size={22} color="#F97316" />
          </View>
          <Text
            style={{
              fontSize: 16,
              fontWeight: "700",
              color: theme.colors.foreground,
            }}
          >
            {t("empty.title")}
          </Text>
          <Text
            style={{
              fontSize: 12.5,
              color: theme.colors.foregroundMuted,
              textAlign: "center",
              lineHeight: 19,
            }}
          >
            {t("empty.subtitle")}
          </Text>

          <View style={{ width: "100%", flexDirection: "row", gap: 8 }}>
            <TextInput
              value={emptyDraftPath}
              onChangeText={setEmptyDraftPath}
              onSubmitEditing={() => {
                if (emptyDraftPath.trim()) setActivePath(emptyDraftPath.trim());
              }}
              placeholder={t("empty.placeholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={{
                flex: 1,
                height: 36,
                borderRadius: 9,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
                color: theme.colors.foreground,
                paddingHorizontal: 11,
                fontSize: 13,
              }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (emptyDraftPath.trim()) setActivePath(emptyDraftPath.trim());
              }}
              style={({ pressed }) => ({
                height: 36,
                paddingHorizontal: 14,
                borderRadius: 9,
                backgroundColor: theme.colors.accent,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: "600",
                  color: theme.colors.accentForeground,
                }}
              >
                {t("empty.open")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <PrototypeAnnotatorWorkspace
        rawPath={activePath}
        cwd={effectiveCwd}
        agentId={selectedAgentId}
        agentLabel={effectiveLabel}
        agentOptions={agentOptions}
        onSelectAgent={(id) => setSelectedAgentId(id)}
        onBackToChat={
          !layout.compact && selectedAgentId && navigation?.openAgent
            ? () => navigation.openAgent({ agentId: selectedAgentId })
            : undefined
        }
        onChangePath={(next) => setActivePath(next)}
        theme={theme}
        platform={layout.platform}
        compact={layout.compact}
        onSubmitted={(sent) => {
          if (sent && selectedAgentId && navigation?.openAgent) {
            navigation.openAgent({ agentId: selectedAgentId });
          }
        }}
      />
    </View>
  );
}

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void | Promise<void>> = [];

  cleanups.push(
    registerHtmlPrototypeBridge({
      open(req) {
        client.openScreen({
          screenId: "annotator",
          params: {
            path: req.path,
            ...(req.title ? { title: req.title } : {}),
            ...(req.cwd ? { cwd: req.cwd } : {}),
            ...(req.agentId ? { agentId: req.agentId } : {}),
            ...(req.agentTitle ? { agentTitle: req.agentTitle } : {}),
          },
        });
      },
    }),
  );

  cleanups.push(
    client.addTimelineTransformer({
      id: "html-prototype-assistant",
      query: { itemType: "assistant_message" },
      transform({ item, phase }) {
        if (phase !== "complete") return undefined;
        const targets = extractHtmlPrototypeTargets(item.text);
        if (targets.length === 0) return undefined;
        return {
          items: [
            {
              type: "plugin",
              kind: PROTOTYPE_TIMELINE_KIND,
              version: PROTOTYPE_TIMELINE_VERSION,
              data: {
                text: item.text,
                targets,
              },
            },
          ],
        };
      },
    }),
  );

  cleanups.push(
    client.addTimelineRenderer({
      kind: PROTOTYPE_TIMELINE_KIND,
      version: PROTOTYPE_TIMELINE_VERSION,
      schema: prototypeTimelineDataSchema,
      Component: AssistantPrototypeMessageRenderer,
    }),
  );

  if (typeof client.addSettingsScreen === "function") {
    cleanups.push(
      client.addSettingsScreen({
        id: "preferences",
        title: protoLabel("plugin.settingsTitle"),
        icon: "Sliders",
        Component: PrototypeAnnotatorSettingsScreen,
      }),
    );
  }

  if (typeof client.addFilePanel === "function") {
    cleanups.push(
      client.addFilePanel({
        id: "html-prototype-panel",
        title: protoLabel("plugin.filePanelTitle"),
        icon: "Layers",
        files: {
          extensions: HTML_EXTENSIONS,
        },
        Component: HtmlPrototypeFilePanel,
      }),
    );
  }

  cleanups.push(
    client.addScreen({
      id: "annotator",
      title: (p) =>
        p.title ||
        (p.path
          ? protoLabel("plugin.screenTitleWithFile", {
              name: extractFileName(p.path),
            })
          : protoLabel("plugin.screenTitleDefault")),
      Component: PrototypeAnnotatorScreen,
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "open-html-annotator-agent",
      title: protoLabel("plugin.cmdAgent"),
      icon: "Layers",
      keywords: ["html", "prototype", "annotate", "pin", "原型", "标注", "图钉", "预览"],
      context: "agent",
      onSelect(ctx) {
        ctx.openScreen({
          screenId: "annotator",
          params: {
            agentId: ctx.agent.id,
            ...(ctx.agent.title ? { agentTitle: ctx.agent.title } : {}),
            ...(ctx.agent.cwd ? { cwd: ctx.agent.cwd } : {}),
          },
        });
      },
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "open-html-annotator-global",
      title: protoLabel("plugin.cmdGlobal"),
      icon: "Layers",
      keywords: ["html", "prototype", "annotate", "pin", "原型", "标注", "图钉"],
      context: "global",
      onSelect(ctx) {
        ctx.openScreen({ screenId: "annotator" });
      },
    }),
  );

  cleanups.push(
    client.addSlashCommand({
      name: "proto",
      description: protoLabel("plugin.slashDesc"),
      argumentHint: protoLabel("plugin.slashHint"),
      context: "agent",
      onSubmit(ctx) {
        const arg = ctx.args.trim();
        ctx.openScreen({
          screenId: "annotator",
          params: {
            agentId: ctx.agent.id,
            ...(ctx.agent.title ? { agentTitle: ctx.agent.title } : {}),
            ...(ctx.agent.cwd ? { cwd: ctx.agent.cwd } : {}),
            ...(arg ? { path: arg, title: extractFileName(arg) } : {}),
          },
        });
      },
    }),
  );

  return async () => {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
  };
}
