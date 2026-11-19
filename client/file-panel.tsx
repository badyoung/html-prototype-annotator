import {
  usePaseo,
  useWorkspace,
  type PluginFilePanelProps,
} from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import {
  PrototypeAnnotatorWorkspace,
  type AgentTargetOption,
} from "./annotator-workspace";

export function HtmlPrototypeFilePanel({
  workspaceId,
  params,
  theme,
  layout,
}: PluginFilePanelProps) {
  const paseo = usePaseo();
  const { height: winHeight } = useWindowDimensions();
  const workspaceDir = useWorkspace(workspaceId, (w) => w.directory);

  const [agents, setAgents] = useState<AgentTargetOption[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await paseo.agents.list({ page: { limit: 50 } });
        if (cancelled) return;
        const candidates = res.entries
          .filter(
            (e) =>
              e.agent.workspaceId === workspaceId &&
              !e.agent.archivedAt &&
              !e.agent.labels?.["paseo.parent-agent-id"],
          )
          .map((e) => ({
            id: e.agent.id,
            title: e.agent.title || e.agent.provider,
          }));
        setAgents(candidates);
        if (candidates.length > 0) {
          setSelectedAgentId((prev) =>
            prev && candidates.some((c) => c.id === prev)
              ? prev
              : candidates[0].id,
          );
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paseo, workspaceId]);

  const activeChoice = agents.find((a) => a.id === selectedAgentId) ?? null;
  const stageHeight = Math.max(360, winHeight - 138);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <PrototypeAnnotatorWorkspace
        rawPath={params.path}
        cwd={workspaceDir}
        agentId={selectedAgentId}
        agentLabel={activeChoice?.title ?? null}
        agentOptions={agents}
        onSelectAgent={(id) => setSelectedAgentId(id)}
        theme={theme}
        platform={layout.platform}
        compact={layout.compact}
        stageHeight={stageHeight}
      />
    </View>
  );
}
