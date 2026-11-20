import {
  useAgent,
  useRpc,
  useWorkspace,
  type PluginTimelineItemProps,
} from "@getpaseo/plugin/client";
import { Icon, Markdown, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { z } from "zod";
import {
  extractedHtmlTargetSchema,
  extractFileName,
  normalizeHtmlLinkToPath,
  parsedPrototypeFeedbackSchema,
  type ExtractedHtmlTarget,
  type ParsedFeedbackItem,
  type ParsedPrototypeFeedback,
} from "../shared/annotations";
import { getHtmlPrototypeBridge } from "../shared/bridge";
import {
  assembleFullPrototypeHtml,
  loadHtmlPrototypeRpc,
  PROTOTYPE_HTML_CHUNK_CHARS,
  readPrototypeHtmlChunkRpc,
} from "../shared/rpc";
import { saveHtmlStringToDevice } from "./encoding";
import { useProtoI18n } from "./i18n";

export const PROTOTYPE_TIMELINE_KIND = "html-prototype-assistant-message";
export const PROTOTYPE_TIMELINE_VERSION = 1;

export const PROTOTYPE_FEEDBACK_TIMELINE_KIND = "html-prototype-user-feedback";
export const PROTOTYPE_FEEDBACK_TIMELINE_VERSION = 1;

export const prototypeTimelineDataSchema = z.object({
  text: z.string(),
  targets: z.array(extractedHtmlTargetSchema),
});

export type PrototypeTimelineData = z.infer<typeof prototypeTimelineDataSchema>;

export const prototypeFeedbackTimelineDataSchema = z.object({
  feedback: parsedPrototypeFeedbackSchema,
});

export type PrototypeFeedbackTimelineData = z.infer<
  typeof prototypeFeedbackTimelineDataSchema
>;

interface DomElementLike {
  tagName?: string;
  parentElement?: DomElementLike | null;
  href?: string;
  getAttribute?: (name: string) => string | null;
  addEventListener?: (
    type: string,
    listener: (ev: DomClickEventLike) => void,
    useCapture?: boolean,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (ev: DomClickEventLike) => void,
    useCapture?: boolean,
  ) => void;
}

interface DomClickEventLike {
  target?: DomElementLike | null;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

export function AssistantPrototypeMessageRenderer({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<PrototypeTimelineData>) {
  const { t } = useProtoI18n();
  const toast = useToast();
  const loadPrototype = useRpc(loadHtmlPrototypeRpc);
  const readPrototypeChunk = useRpc(readPrototypeHtmlChunkRpc);

  const agentMeta = useAgent(agentId, (a) => ({
    cwd: a.cwd,
    workspaceId: a.workspaceId,
    title: a.title,
  }));
  const workspaceDir = useWorkspace(
    agentMeta?.workspaceId ?? "",
    (w) => w.directory,
  );
  const effectiveCwd = agentMeta?.cwd || workspaceDir || null;

  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);

  const containerRef = useRef<View | null>(null);
  const latestOpenRef = useRef((_cleanPath: string, _title: string) => {});

  const openInStudio = (cleanPath: string, title: string) => {
    getHtmlPrototypeBridge()?.open({
      path: cleanPath,
      title,
      cwd: effectiveCwd,
      agentId,
      agentTitle: agentMeta?.title ?? null,
    });
  };

  latestOpenRef.current = openInStudio;

  useEffect(() => {
    if (layout.platform !== "web") return;
    const node = containerRef.current as unknown as DomElementLike | null;
    if (!node || typeof node.addEventListener !== "function") return;

    const handleCaptureClick = (ev: DomClickEventLike) => {
      if (
        (typeof ev.button === "number" && ev.button !== 0) ||
        ev.metaKey ||
        ev.ctrlKey ||
        ev.shiftKey ||
        ev.altKey
      ) {
        return;
      }

      let cur: DomElementLike | null | undefined = ev.target;
      let anchor: DomElementLike | null = null;
      let depth = 0;
      while (cur && cur !== node && depth < 12) {
        if (cur.tagName?.toLowerCase() === "a") {
          anchor = cur;
          break;
        }
        cur = cur.parentElement;
        depth += 1;
      }
      if (!anchor) return;

      const rawHref =
        (typeof anchor.getAttribute === "function"
          ? anchor.getAttribute("href")
          : null) ??
        anchor.href ??
        "";
      if (!rawHref) return;

      const cleanPath = normalizeHtmlLinkToPath(rawHref, {
        requirePathPrefixForPlain: false,
      });
      if (!cleanPath) return;

      ev.preventDefault?.();
      ev.stopPropagation?.();
      latestOpenRef.current(cleanPath, extractFileName(cleanPath));
    };

    node.addEventListener("click", handleCaptureClick, true);
    return () => {
      node.removeEventListener?.("click", handleCaptureClick, true);
    };
  }, [layout.platform]);

  const handleDownloadHtml = async (cleanPath: string) => {
    if (downloadingPath) return;
    setDownloadingPath(cleanPath);
    try {
      const loaded = await loadPrototype({
        rawPath: cleanPath,
        cwd: effectiveCwd,
        maxInlineChars: PROTOTYPE_HTML_CHUNK_CHARS,
      });
      const fullHtml = await assembleFullPrototypeHtml(
        loaded,
        readPrototypeChunk,
      );
      const msg = await saveHtmlStringToDevice(
        fullHtml,
        loaded.fileName,
        {
          startedDownload: (name, size) =>
            t("save.startedDownload", { name, size }),
          openedShare: (name) => t("save.openedShare", { name }),
        },
      );
      toast.show(msg, { variant: "success" });
    } catch (err) {
      toast.error(
        t("card.downloadFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setDownloadingPath(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <View ref={containerRef}>
        <Markdown>{item.data.text}</Markdown>
      </View>

      {item.data.targets.length > 0 ? (
        <View style={{ gap: 8, paddingTop: 2 }}>
          {item.data.targets.map((target: ExtractedHtmlTarget) => {
            const isDl = downloadingPath === target.cleanPath;
            return (
              <View
                key={target.cleanPath}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  maxWidth: 460,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("card.openA11y", {
                    name: target.fileName,
                  })}
                  onPress={() =>
                    openInStudio(
                      target.cleanPath,
                      target.label || target.fileName,
                    )
                  }
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    opacity: pressed ? 0.78 : 1,
                  })}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      backgroundColor: "rgba(249, 115, 22, 0.13)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="Layers" size={17} color="#F97316" />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: theme.colors.foreground,
                      }}
                    >
                      {target.label || target.fileName}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 11.5,
                        color: theme.colors.foregroundMuted,
                      }}
                    >
                      {t("card.subtitle")}
                    </Text>
                  </View>
                </Pressable>

                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      openInStudio(
                        target.cleanPath,
                        target.label || target.fileName,
                      )
                    }
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      height: 30,
                      paddingHorizontal: 11,
                      borderRadius: 8,
                      backgroundColor: "#10B981",
                      opacity: pressed ? 0.84 : 1,
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: "700",
                        color: "#FFFFFF",
                      }}
                    >
                      {t("card.openBtn")}
                    </Text>
                    <Icon name="ChevronRight" size={13} color="#FFFFFF" />
                  </Pressable>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("card.downloadA11y", {
                      name: target.fileName,
                    })}
                    disabled={isDl}
                    onPress={() => void handleDownloadHtml(target.cleanPath)}
                    style={({ pressed }) => ({
                      width: 30,
                      height: 30,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: isDl ? 0.5 : pressed ? 0.72 : 1,
                    })}
                  >
                    {isDl ? (
                      <ActivityIndicator
                        size="small"
                        color={theme.colors.accent}
                      />
                    ) : (
                      <Icon
                        name="Download"
                        size={13.5}
                        color={theme.colors.foregroundMuted}
                      />
                    )}
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const INITIAL_VISIBLE_FEEDBACK_ITEMS = 4;

export function UserPrototypeFeedbackRenderer({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<PrototypeFeedbackTimelineData>) {
  const { t } = useProtoI18n();
  const [expanded, setExpanded] = useState(false);

  const agentMeta = useAgent(agentId, (a) => ({
    cwd: a.cwd,
    workspaceId: a.workspaceId,
    title: a.title,
  }));
  const workspaceDir = useWorkspace(
    agentMeta?.workspaceId ?? "",
    (w) => w.directory,
  );
  const effectiveCwd = agentMeta?.cwd || workspaceDir || null;

  const { feedback } = item.data;
  const isApproved = feedback.status === "approved";
  const accentColor = isApproved ? "#10B981" : "#F97316";
  const borderTint = isApproved
    ? "rgba(16, 185, 129, 0.34)"
    : "rgba(249, 115, 22, 0.32)";
  const badgeBg = isApproved
    ? "rgba(16, 185, 129, 0.14)"
    : "rgba(249, 115, 22, 0.14)";

  const distinctScreens = new Set(
    feedback.items.map((it) => it.screen?.trim()).filter(Boolean),
  ).size;

  const subtitleText = isApproved
    ? t("feedback.approvedSubtitle")
    : distinctScreens > 1
      ? t("feedback.changesWithScreens", {
          count: feedback.items.length,
          screens: distinctScreens,
        })
      : t("feedback.changesSubtitle", { count: feedback.items.length });

  const hasOverflow = feedback.items.length > INITIAL_VISIBLE_FEEDBACK_ITEMS;
  const visibleItems: ParsedFeedbackItem[] =
    expanded || !hasOverflow
      ? feedback.items
      : feedback.items.slice(0, 3);
  const hiddenCount = Math.max(0, feedback.items.length - visibleItems.length);

  const handleReopen = () => {
    const targetPath = feedback.prototypePath;
    if (!targetPath) return;
    getHtmlPrototypeBridge()?.open({
      path: targetPath,
      title: feedback.fileName,
      cwd: effectiveCwd,
      agentId,
      agentTitle: agentMeta?.title ?? null,
    });
  };

  return (
    <View
      style={{
        alignSelf: "stretch",
        maxWidth: 640,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: borderTint,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden",
      }}
    >
      {/* Card Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          paddingHorizontal: 13,
          paddingVertical: 10,
          borderBottomWidth:
            feedback.items.length > 0 || Boolean(feedback.overallNote) ? 1 : 0,
          borderBottomColor: theme.colors.border,
        }}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              backgroundColor: badgeBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon
              name={isApproved ? "Check" : "MapPin"}
              size={16}
              color={accentColor}
            />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 13,
                fontWeight: "700",
                color: theme.colors.foreground,
              }}
            >
              {isApproved
                ? t("feedback.approvedTitle", { name: feedback.fileName })
                : t("feedback.changesTitle", { name: feedback.fileName })}
            </Text>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11.5,
                fontWeight: "600",
                color: accentColor,
              }}
            >
              {subtitleText}
            </Text>
          </View>
        </View>

        {feedback.prototypePath ? (
          <Pressable
            accessibilityRole="button"
            onPress={handleReopen}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              height: 28,
              paddingHorizontal: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              opacity: pressed ? 0.76 : 1,
            })}
          >
            <Icon name="Layers" size={12.5} color={accentColor} />
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "600",
                color: theme.colors.foreground,
              }}
            >
              {t("feedback.reopenBtn")}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Structured Annotation Rows */}
      {visibleItems.length > 0 ? (
        <View style={{ padding: 10, gap: 7 }}>
          {visibleItems.map((entry) => (
            <View
              key={`${entry.index}-${entry.part}`}
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.surface0,
                paddingHorizontal: 10,
                paddingVertical: 8,
                gap: 5,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                <View
                  style={{
                    minWidth: 22,
                    height: 19,
                    paddingHorizontal: 5.5,
                    borderRadius: 999,
                    backgroundColor: "#F97316",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 10.5,
                      fontWeight: "800",
                      color: "#FFFFFF",
                    }}
                  >
                    #{entry.index}
                  </Text>
                </View>

                {entry.screen ? (
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 1.5,
                      borderRadius: 5,
                      backgroundColor: theme.colors.surface2,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        fontSize: 10.5,
                        fontWeight: "600",
                        color: theme.colors.foregroundMuted,
                        maxWidth: 180,
                      }}
                    >
                      {entry.screen}
                    </Text>
                  </View>
                ) : null}

                <Text
                  numberOfLines={layout.compact ? 2 : 1}
                  style={{
                    fontSize: 12.5,
                    fontWeight: "700",
                    color: theme.colors.foreground,
                    ...(layout.compact ? { width: "100%" } : { flexShrink: 1 }),
                  }}
                >
                  {entry.part}
                </Text>

                {entry.selector ? (
                  <Text
                    numberOfLines={1}
                    style={{
                      fontSize: 10.5,
                      color: theme.colors.foregroundMuted,
                    }}
                  >
                    · {entry.selector}
                  </Text>
                ) : null}
              </View>

              {entry.note ? (
                <View
                  style={{
                    borderLeftWidth: 2.5,
                    borderLeftColor: "#F97316",
                    paddingLeft: 8,
                    marginTop: 1,
                  }}
                >
                  <Text
                    selectable
                    style={{
                      fontSize: 12.5,
                      lineHeight: 18,
                      color: theme.colors.foreground,
                    }}
                  >
                    {entry.note}
                  </Text>
                </View>
              ) : null}
            </View>
          ))}

          {hasOverflow ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setExpanded((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 5,
                paddingVertical: 6,
                borderRadius: 8,
                backgroundColor: theme.colors.surface0,
                borderWidth: 1,
                borderColor: theme.colors.border,
                opacity: pressed ? 0.78 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: "600",
                  color: theme.colors.foregroundMuted,
                }}
              >
                {expanded
                  ? t("feedback.collapseList")
                  : t("feedback.expandMore", { count: hiddenCount })}
              </Text>
              <Icon
                name={expanded ? "ChevronUp" : "ChevronDown"}
                size={13}
                color={theme.colors.foregroundMuted}
              />
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Overall Note Footer */}
      {feedback.overallNote ? (
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderTopWidth: visibleItems.length > 0 ? 1 : 0,
            borderTopColor: theme.colors.border,
            backgroundColor: theme.colors.surface0,
            gap: 3,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: "700",
              color: theme.colors.foregroundMuted,
            }}
          >
            {t("feedback.overallLabel")}
          </Text>
          <Text
            selectable
            style={{
              fontSize: 12.5,
              lineHeight: 18,
              color: theme.colors.foreground,
            }}
          >
            {feedback.overallNote}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
