import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  copyText,
  Icon,
  ScrollView,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { createElement, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import {
  formatAnnotationsMarkdown,
  formatByteSize,
  type AnnotationPin,
} from "../shared/annotations";
import { instrumentHtmlForWebAnnotator } from "../shared/html-instrumenter";
import {
  loadHtmlPrototypeRpc,
  renderMobilePrototypeRpc,
  submitPrototypeAnnotationsRpc,
  type DomHitBox,
  type LoadHtmlPrototypeOutput,
  type RenderMobilePrototypeOutput,
} from "../shared/rpc";
import { prototypeAnnotatorSettings } from "../shared/settings";
import { saveHtmlStringToDevice } from "./encoding";
import { useProtoI18n } from "./i18n";

export type AnnotatorMode = "pin" | "box" | "interact";
export type StageViewportPreset = "responsive" | "tablet" | "mobile";

const INTERACT_SVG_ICON = {
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7.07 17 2.51-7.39L21 11.07z"/><path d="M13.5 13.5L19 19"/></svg>`,
};

interface IframeDomNode {
  contentWindow?: {
    postMessage?: (message: unknown, targetOrigin: string) => void;
  } | null;
}

interface WindowMessageBridge {
  addEventListener?: (
    type: string,
    listener: (ev: { data?: unknown }) => void,
  ) => void;
  removeEventListener?: (
    type: string,
    listener: (ev: { data?: unknown }) => void,
  ) => void;
}

function makePinId(): string {
  return `pin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
}

function isDarkSurface(hexOrRgb: string): boolean {
  const clean = hexOrRgb.trim().replace("#", "");
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    const r = Number.parseInt(clean.slice(0, 2), 16);
    const g = Number.parseInt(clean.slice(2, 4), 16);
    const b = Number.parseInt(clean.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }
  return false;
}

function matchBestHitBox(
  hitBoxes: readonly DomHitBox[],
  xPct: number,
  yPct: number,
): DomHitBox | null {
  let best: DomHitBox | null = null;
  for (const b of hitBoxes) {
    if (
      xPct >= b.xPct &&
      xPct <= b.xPct + b.wPct &&
      yPct >= b.yPct &&
      yPct <= b.yPct + b.hPct
    ) {
      if (!best || b.area <= best.area) {
        best = b;
      }
    }
  }
  return best;
}

function matchEnclosedHitParts(
  hitBoxes: readonly DomHitBox[],
  left: number,
  top: number,
  width: number,
  height: number,
): { screen: string | null; part: string | null } {
  const names: string[] = [];
  let screen: string | null = null;
  for (const b of hitBoxes) {
    const cx = b.xPct + b.wPct / 2;
    const cy = b.yPct + b.hPct / 2;
    if (cx >= left && cx <= left + width && cy >= top && cy <= top + height) {
      if (!screen && b.screen) screen = b.screen;
      if (b.part && !names.includes(b.part)) {
        names.push(b.part);
        if (names.length >= 3) break;
      }
    }
  }
  return {
    screen,
    part: names.length > 0 ? names.join(" + ") : null,
  };
}

export interface AgentTargetOption {
  id: string;
  title: string;
}

export interface PrototypeAnnotatorWorkspaceProps {
  rawPath: string;
  cwd?: string | null;
  agentId?: string | null;
  agentLabel?: string | null;
  agentOptions?: readonly AgentTargetOption[];
  onSelectAgent?: (agentId: string) => void;
  onBackToChat?: () => void;
  onChangePath?: (newPath: string) => void;
  theme: PluginTheme;
  platform: "ios" | "android" | "web";
  compact: boolean;
  stageHeight?: number;
  onSubmitted?: (sentToAgent: boolean) => void;
}

export function PrototypeAnnotatorWorkspace({
  rawPath,
  cwd,
  agentId,
  agentLabel,
  agentOptions,
  onSelectAgent,
  onBackToChat,
  onChangePath,
  theme,
  platform,
  compact,
  stageHeight,
  onSubmitted,
}: PrototypeAnnotatorWorkspaceProps) {
  const { t, locale } = useProtoI18n();
  const prefState = useSettings(prototypeAnnotatorSettings);
  const toast = useToast();
  const { width: winWidth } = useWindowDimensions();
  const loadPrototype = useRpc(loadHtmlPrototypeRpc);
  const renderMobilePrototype = useRpc(renderMobilePrototypeRpc);
  const submitAnnotations = useRpc(submitPrototypeAnnotationsRpc);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proto, setProto] = useState<LoadHtmlPrototypeOutput | null>(null);

  // Zero-port headless pipe snapshot for iOS / Android Native App
  const [mobileShot, setMobileShot] =
    useState<RenderMobilePrototypeOutput | null>(null);
  const [mobileRendering, setMobileRendering] = useState(false);
  const [mobileInteracting, setMobileInteracting] = useState(false);
  const [mobileCanvasWidth, setMobileCanvasWidth] = useState(0);

  const [mode, setMode] = useState<AnnotatorMode>("interact");
  const modeSeededRef = useRef(false);
  useEffect(() => {
    if (!modeSeededRef.current && prefState.status === "ready") {
      modeSeededRef.current = true;
      setMode(prefState.values.defaultMode);
    }
  }, [prefState]);
  const [cleanChrome, setCleanChrome] = useState(true);
  const [viewportPreset, setViewportPreset] =
    useState<StageViewportPreset>("responsive");
  const [pins, setPins] = useState<AnnotationPin[]>([]);
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [overallNote, setOverallNote] = useState("");
  const [showGlobalNote, setShowGlobalNote] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!compact);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [draftPathInput, setDraftPathInput] = useState(rawPath);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [frameReadyCount, setFrameReadyCount] = useState(0);

  const [nativeDragRect, setNativeDragRect] = useState<{
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const tapStartRef = useRef<{
    pageX: number;
    pageY: number;
    locX: number;
    locY: number;
    ts: number;
  } | null>(null);

  const bridgeToken = useMemo(
    () => `tok-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    [rawPath],
  );
  const iframeRef = useRef<IframeDomNode | null>(null);

  const isNarrowLayout = compact || winWidth < 900;
  const darkTheme = isDarkSurface(theme.colors.surface0);
  const canvasBackdrop = darkTheme ? "#0D1017" : "#EEF1F4";

  useEffect(() => {
    setSidebarOpen(!isNarrowLayout);
  }, [isNarrowLayout]);

  useEffect(() => {
    setDraftPathInput(rawPath);
    const trimmed = rawPath.trim();
    if (!trimmed) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProto(null);
    setMobileShot(null);

    void (async () => {
      try {
        const loaded = await loadPrototype({
          rawPath: trimmed,
          cwd: cwd ?? null,
        });
        if (cancelled) return;
        setProto(loaded);
        setPins(loaded.savedPins ?? []);
        setOverallNote(loaded.savedOverallNote ?? "");
        setShowGlobalNote(Boolean(loaded.savedOverallNote?.trim()));
        setActivePinId(loaded.savedPins?.[0]?.id ?? null);

        if (platform !== "web") {
          setMobileRendering(true);
          try {
            const snap = await renderMobilePrototype({
              resolvedPath: loaded.resolvedPath,
              viewportWidth: 414,
              cleanChrome: true,
              resetSession: true,
            });
            if (!cancelled) setMobileShot(snap);
          } catch (renderErr) {
            if (!cancelled) {
              setError(
                renderErr instanceof Error
                  ? renderErr.message
                  : String(renderErr),
              );
            }
          } finally {
            if (!cancelled) setMobileRendering(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawPath, cwd, platform]);

  const instrumentedHtml = useMemo(() => {
    if (!proto?.bundledHtml || platform !== "web") return "";
    return instrumentHtmlForWebAnnotator(proto.bundledHtml, bridgeToken, locale);
  }, [proto?.bundledHtml, platform, bridgeToken, locale]);

  // Web/Desktop postMessage listener
  useEffect(() => {
    if (platform !== "web") return;
    const win = globalThis as unknown as WindowMessageBridge;
    if (typeof win.addEventListener !== "function") return;

    const handleMessage = (ev: { data?: unknown }) => {
      const d = ev?.data as Record<string, unknown> | undefined;
      if (!d || d.source !== "paseo-proto-frame" || d.token !== bridgeToken) {
        return;
      }
      if (d.type === "ready") {
        setFrameReadyCount((c) => c + 1);
        return;
      }
      if (
        d.type === "set-mode" &&
        (d.mode === "interact" || d.mode === "pin" || d.mode === "box")
      ) {
        setMode(d.mode);
        return;
      }
      if (d.type === "select-pin" && typeof d.id === "string") {
        setActivePinId(d.id);
        return;
      }
      if (
        d.type === "update-pin-note" &&
        typeof d.id === "string" &&
        typeof d.note === "string"
      ) {
        const targetId = d.id;
        const nextNote = d.note;
        setPins((prev) =>
          prev.map((p) => (p.id === targetId ? { ...p, note: nextNote } : p)),
        );
        return;
      }
      if (d.type === "delete-pin" && typeof d.id === "string") {
        const targetId = d.id;
        setPins((prev) => {
          const next = prev.filter((p) => p.id !== targetId);
          setActivePinId((cur) =>
            cur === targetId ? (next[next.length - 1]?.id ?? null) : cur,
          );
          return next;
        });
        return;
      }
      if (d.type === "add-pin" && d.draft && typeof d.draft === "object") {
        const rawDraft = d.draft as Partial<AnnotationPin>;
        const newPin: AnnotationPin = {
          id: makePinId(),
          kind: rawDraft.kind === "box" ? "box" : "pin",
          screen: String(
            rawDraft.screen || proto?.title || t("studio.defaultScreen"),
          ),
          part: String(rawDraft.part || t("studio.defaultElement")),
          selector: rawDraft.selector ? String(rawDraft.selector) : undefined,
          xPct: clampPct(Number(rawDraft.xPct ?? 50)),
          yPct: clampPct(Number(rawDraft.yPct ?? 50)),
          wPct:
            rawDraft.kind === "box" && rawDraft.wPct !== undefined
              ? clampPct(Number(rawDraft.wPct))
              : undefined,
          hPct:
            rawDraft.kind === "box" && rawDraft.hPct !== undefined
              ? clampPct(Number(rawDraft.hPct))
              : undefined,
          note: "",
        };
        setPins((prev) => [...prev, newPin]);
        setActivePinId(newPin.id);
      }
    };

    win.addEventListener("message", handleMessage);
    return () => {
      win.removeEventListener?.("message", handleMessage);
    };
  }, [platform, bridgeToken, proto?.title]);

  useEffect(() => {
    if (platform !== "web") return;
    const contentWin = iframeRef.current?.contentWindow;
    if (contentWin && typeof contentWin.postMessage === "function") {
      contentWin.postMessage(
        {
          source: "paseo-proto-host",
          token: bridgeToken,
          type: "sync-state",
          mode,
          cleanChrome,
          pins,
          activePinId,
        },
        "*",
      );
    }
  }, [platform, bridgeToken, mode, cleanChrome, pins, activePinId, frameReadyCount]);

  const activePinIndex = useMemo(
    () => pins.findIndex((p) => p.id === activePinId),
    [pins, activePinId],
  );
  const activePin = activePinIndex >= 0 ? pins[activePinIndex] : null;

  const updatePin = (id: string, patch: Partial<AnnotationPin>) => {
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const removePin = (id: string) => {
    setPins((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (activePinId === id) {
        setActivePinId(next[next.length - 1]?.id ?? null);
      }
      return next;
    });
  };

  const handleSaveOrSubmit = async (sendToAgent: boolean) => {
    if (!proto || submitting) return;
    setSubmitting(true);
    try {
      const approvedAsIs = pins.length === 0 && !overallNote.trim();
      const res = await submitAnnotations({
        resolvedPath: proto.resolvedPath,
        fileName: proto.fileName,
        agentId: agentId ?? null,
        pins,
        overallNote,
        approvedAsIs,
        sendToAgent,
        locale,
      });

      if (sendToAgent) {
        if (res.sentToAgent) {
          toast.show(
            pins.length > 0
              ? t("studio.toastSentPins", { count: pins.length })
              : t("studio.toastSentApproved"),
            { variant: "success" },
          );
        } else {
          await copyText(res.markdown).catch(() => {});
          toast.show(t("studio.toastSavedCopied"), {
            variant: "info",
          });
        }
        onSubmitted?.(res.sentToAgent);
      } else {
        toast.show(t("studio.toastDraftSaved"), { variant: "success" });
      }
    } catch (err) {
      toast.error(
        t("studio.toastSubmitFailed", {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyMarkdown = async () => {
    if (!proto) return;
    const md = formatAnnotationsMarkdown({
      fileName: proto.fileName,
      resolvedPath: proto.resolvedPath,
      pins,
      overallNote,
      approvedAsIs: pins.length === 0 && !overallNote.trim(),
      locale,
    });
    try {
      await copyText(md);
      toast.show(t("studio.toastCopied"), { variant: "success" });
    } catch {
      toast.error(t("studio.toastCopyFailed"));
    }
  };

  // Computed scaled image dimensions on Mobile Native
  const effectiveMobileW = Math.max(
    1,
    mobileCanvasWidth || Math.min(winWidth, 540),
  );
  const effectiveMobileH = useMemo(() => {
    if (!mobileShot) return 640;
    return Math.max(
      200,
      Math.round(effectiveMobileW * (mobileShot.docHeight / mobileShot.docWidth)),
    );
  }, [mobileShot, effectiveMobileW]);

  const handleMobileTapAt = async (canvasXPct: number, canvasYPct: number) => {
    if (!proto || !mobileShot) return;

    if (mode === "interact") {
      if (mobileInteracting) return;
      setMobileInteracting(true);
      try {
        const updated = await renderMobilePrototype({
          resolvedPath: proto.resolvedPath,
          viewportWidth: 414,
          cleanChrome,
          clickXPct: canvasXPct,
          clickYPct: canvasYPct,
        });
        setMobileShot(updated);
      } catch (err) {
        toast.error(
          t("studio.toastInteractFailed", {
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } finally {
        setMobileInteracting(false);
      }
      return;
    }

    const hit = matchBestHitBox(mobileShot.hitBoxes, canvasXPct, canvasYPct);
    const newPin: AnnotationPin = {
      id: makePinId(),
      kind: "pin",
      screen:
        hit?.screen ||
        proto.semanticScreens?.[0] ||
        proto.title ||
        t("studio.defaultScreen"),
      part: hit?.part || t("studio.defaultElement"),
      selector: hit?.selector,
      xPct: hit ? hit.screenXPct : canvasXPct,
      yPct: hit ? hit.screenYPct : canvasYPct,
      canvasXPct,
      canvasYPct,
      note: "",
    };
    setPins((prev) => [...prev, newPin]);
    setActivePinId(newPin.id);
  };

  const onMobileImageTouchStart = (ev: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = ev.nativeEvent;
    if (mode === "box") {
      const xPct = clampPct((locationX / effectiveMobileW) * 100);
      const yPct = clampPct((locationY / effectiveMobileH) * 100);
      setNativeDragRect({ startX: xPct, startY: yPct, curX: xPct, curY: yPct });
      return;
    }
    tapStartRef.current = {
      pageX,
      pageY,
      locX: locationX,
      locY: locationY,
      ts: Date.now(),
    };
  };

  const onMobileImageTouchMove = (ev: GestureResponderEvent) => {
    if (mode === "box" && nativeDragRect) {
      const { locationX, locationY } = ev.nativeEvent;
      const xPct = clampPct((locationX / effectiveMobileW) * 100);
      const yPct = clampPct((locationY / effectiveMobileH) * 100);
      setNativeDragRect((prev) =>
        prev ? { ...prev, curX: xPct, curY: yPct } : null,
      );
      return;
    }
    if (tapStartRef.current) {
      const dx = ev.nativeEvent.pageX - tapStartRef.current.pageX;
      const dy = ev.nativeEvent.pageY - tapStartRef.current.pageY;
      if (Math.hypot(dx, dy) > 10) {
        // User is scrolling vertically; cancel tap!
        tapStartRef.current = null;
      }
    }
  };

  const onMobileImageTouchEnd = () => {
    if (mode === "box" && nativeDragRect && proto && mobileShot) {
      const rect = nativeDragRect;
      setNativeDragRect(null);
      const left = clampPct(Math.min(rect.startX, rect.curX));
      const top = clampPct(Math.min(rect.startY, rect.curY));
      const w = clampPct(Math.abs(rect.curX - rect.startX));
      const h = clampPct(Math.abs(rect.curY - rect.startY));
      if (w < 2 && h < 2) {
        void handleMobileTapAt(rect.startX, rect.startY);
        return;
      }
      const enclosed = matchEnclosedHitParts(
        mobileShot.hitBoxes,
        left,
        top,
        w,
        h,
      );
      const newPin: AnnotationPin = {
        id: makePinId(),
        kind: "box",
        screen:
          enclosed.screen ||
          proto.semanticScreens?.[0] ||
          proto.title ||
          t("studio.defaultScreen"),
        part: enclosed.part || t("studio.defaultRegion"),
        xPct: left,
        yPct: top,
        wPct: w,
        hPct: h,
        canvasXPct: left,
        canvasYPct: top,
        canvasWPct: w,
        canvasHPct: h,
        note: "",
      };
      setPins((prev) => [...prev, newPin]);
      setActivePinId(newPin.id);
      return;
    }

    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!start || Date.now() - start.ts > 1500) return;
    const xPct = clampPct((start.locX / effectiveMobileW) * 100);
    const yPct = clampPct((start.locY / effectiveMobileH) * 100);
    void handleMobileTapAt(xPct, yPct);
  };

  const stageTargetMaxWidth =
    viewportPreset === "mobile"
      ? 414
      : viewportPreset === "tablet"
        ? 840
        : undefined;

  const renderSegmentItem = (
    id: AnnotatorMode,
    iconName: string,
    label: string,
    shortLabel: string,
  ) => {
    const active = mode === id;
    const activeBg = id === "interact" ? "#10B981" : "#F97316";
    const iconColor = active ? "#FFFFFF" : theme.colors.foregroundMuted;
    return (
      <Pressable
        key={id}
        accessibilityRole="button"
        onPress={() => setMode(id)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 4.5,
          paddingHorizontal: compact ? 9 : 11,
          height: 28,
          borderRadius: 7,
          backgroundColor: active ? activeBg : "transparent",
          opacity: pressed ? 0.8 : 1,
        })}
      >
        {id === "interact" ? (
          <Icon icon={INTERACT_SVG_ICON} size={13} color={iconColor} />
        ) : (
          <Icon name={iconName} size={13} color={iconColor} />
        )}
        <Text
          style={{
            fontSize: 12,
            fontWeight: active ? "700" : "500",
            color: active ? "#FFFFFF" : theme.colors.foregroundMuted,
          }}
        >
          {compact ? shortLabel : label}
        </Text>
      </Pressable>
    );
  };

  const renderIconButton = (
    iconName: string,
    label: string,
    onPress: () => void,
    active = false,
    badgeCount?: number,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        height: 32,
        paddingHorizontal: badgeCount !== undefined ? 8 : 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? theme.colors.accent : theme.colors.border,
        backgroundColor: active ? theme.colors.surface2 : theme.colors.surface0,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Icon
        name={iconName}
        size={13.5}
        color={active ? theme.colors.accent : theme.colors.foreground}
      />
      {badgeCount !== undefined ? (
        <Text
          style={{
            fontSize: 11.5,
            fontWeight: "700",
            color: active ? theme.colors.accent : theme.colors.foreground,
          }}
        >
          {badgeCount}
        </Text>
      ) : null}
    </Pressable>
  );

  const hasFeedback = pins.length > 0 || Boolean(overallNote.trim());
  const isBusyLoading = loading || (platform !== "web" && mobileRendering);

  return (
    <View
      style={{
        flex: 1,
        ...(stageHeight ? { height: stageHeight } : {}),
        backgroundColor: theme.colors.surface0,
      }}
    >
      {/* Single-Row Sleek Top Header (No 3-row wrapping on Mobile!) */}
      <View
        style={{
          flexDirection: "row",
          flexWrap: compact ? "nowrap" : "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: compact ? 6 : 8,
          paddingHorizontal: compact ? 10 : 14,
          paddingVertical: 7,
          backgroundColor: theme.colors.surface1,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        }}
      >
        {/* Desktop-only Left Cluster (Paseo's native nav bar already renders Back + Filename on Mobile!) */}
        {!compact ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              flexShrink: 1,
            }}
          >
            {onBackToChat ? (
              <Pressable
                accessibilityRole="button"
                onPress={onBackToChat}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  height: 30,
                  paddingHorizontal: 9,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface0,
                  opacity: pressed ? 0.72 : 1,
                })}
              >
                <Icon
                  name="ArrowLeft"
                  size={13.5}
                  color={theme.colors.foreground}
                />
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: theme.colors.foreground,
                  }}
                >
                  {t("studio.backToChat")}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!onChangePath}
              onPress={() => {
                if (onChangePath) setPathPickerOpen((v) => !v);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                maxWidth: 260,
                opacity: pressed && onChangePath ? 0.72 : 1,
              })}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  backgroundColor: "rgba(249, 115, 22, 0.14)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="Layers" size={13} color="#F97316" />
              </View>
              <Text
                numberOfLines={1}
                style={{
                  fontSize: 13,
                  fontWeight: "700",
                  color: theme.colors.foreground,
                  flexShrink: 1,
                }}
              >
                {proto?.fileName || t("studio.canvasFallback")}
              </Text>
            </Pressable>

            {agentId ? (
              <Pressable
                accessibilityRole="button"
                disabled={!agentOptions || agentOptions.length <= 1}
                onPress={() => setAgentPickerOpen((v) => !v)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingHorizontal: 8,
                  height: 24,
                  borderRadius: 999,
                  backgroundColor: "rgba(16, 185, 129, 0.12)",
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#10B981",
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    maxWidth: 130,
                    fontSize: 11,
                    fontWeight: "600",
                    color: "#10B981",
                  }}
                >
                  {agentLabel || t("studio.connectedAgent")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* Mode Segmented Capsule */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              padding: 2.5,
              borderRadius: 10,
              backgroundColor: theme.colors.surface0,
              borderWidth: 1,
              borderColor: theme.colors.border,
              gap: 1,
            }}
          >
            {renderSegmentItem(
              "interact",
              "MousePointerClick",
              t("studio.modeInteract"),
              t("studio.modeInteractShort"),
            )}
            {renderSegmentItem(
              "pin",
              "MapPin",
              t("studio.modePin"),
              t("studio.modePinShort"),
            )}
            {renderSegmentItem(
              "box",
              "Scan",
              t("studio.modeBox"),
              t("studio.modeBoxShort"),
            )}
          </View>

          {!isNarrowLayout ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                padding: 2.5,
                borderRadius: 10,
                backgroundColor: theme.colors.surface0,
                borderWidth: 1,
                borderColor: theme.colors.border,
                gap: 2,
              }}
            >
              {(
                [
                  ["responsive", "Monitor", t("studio.vpResponsive")],
                  ["tablet", "Tablet", t("studio.vpTablet")],
                  ["mobile", "Smartphone", t("studio.vpMobile")],
                ] as const
              ).map(([preset, ic, tip]) => {
                const active = viewportPreset === preset;
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    accessibilityLabel={tip}
                    onPress={() => setViewportPreset(preset)}
                    style={({ pressed }) => ({
                      width: 28,
                      height: 28,
                      borderRadius: 7,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active
                        ? theme.colors.surface2
                        : "transparent",
                      opacity: pressed ? 0.75 : 1,
                    })}
                  >
                    <Icon
                      name={ic}
                      size={13.5}
                      color={
                        active
                          ? theme.colors.foreground
                          : theme.colors.foregroundMuted
                      }
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {platform === "web" && !compact ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("studio.cleanChromeA11y")}
              onPress={() => setCleanChrome((v) => !v)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                height: 32,
                paddingHorizontal: 9,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: cleanChrome
                  ? "rgba(99, 102, 241, 0.45)"
                  : theme.colors.border,
                backgroundColor: cleanChrome
                  ? "rgba(99, 102, 241, 0.1)"
                  : theme.colors.surface0,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Icon
                name="Sparkles"
                size={13}
                color={cleanChrome ? "#6366F1" : theme.colors.foregroundMuted}
              />
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: "600",
                  color: cleanChrome ? "#6366F1" : theme.colors.foregroundMuted,
                }}
              >
                {t("studio.cleanChrome")}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {/* Right Cluster: Compact Drawer Toggle + Primary Submit */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {!compact && proto
            ? renderIconButton("Copy", t("studio.copyMd"), () => {
                void handleCopyMarkdown();
              })
            : null}
          {!compact && proto
            ? renderIconButton(
                "Download",
                t("studio.downloadHtml", { size: formatByteSize(proto.byteSize) }),
                () => {
                  void saveHtmlStringToDevice(
                    proto.bundledHtml,
                    proto.fileName,
                    {
                      startedDownload: (name, size) =>
                        t("save.startedDownload", { name, size }),
                      openedShare: (name) => t("save.openedShare", { name }),
                    },
                  )
                    .then((msg) => toast.show(msg, { variant: "success" }))
                    .catch((e) =>
                      toast.error(e instanceof Error ? e.message : String(e)),
                    );
                },
              )
            : null}

          {renderIconButton(
            "PanelRight",
            t("studio.drawer"),
            () => setSidebarOpen((v) => !v),
            sidebarOpen,
            pins.length,
          )}

          <Pressable
            accessibilityRole="button"
            disabled={!proto || submitting}
            onPress={() => void handleSaveOrSubmit(true)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              height: 32,
              paddingHorizontal: compact ? 10 : 13,
              borderRadius: 8,
              backgroundColor: hasFeedback ? "#10B981" : theme.colors.accent,
              opacity: !proto || submitting ? 0.55 : pressed ? 0.85 : 1,
            })}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Icon
                name={hasFeedback ? "Send" : "Check"}
                size={13}
                color={hasFeedback ? "#FFFFFF" : theme.colors.accentForeground}
              />
            )}
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: hasFeedback ? "#FFFFFF" : theme.colors.accentForeground,
              }}
            >
              {submitting
                ? t("studio.sending")
                : agentId
                  ? hasFeedback
                    ? compact
                      ? t("studio.sendShort")
                      : t("studio.sendToAgent")
                    : compact
                      ? t("studio.approveShort")
                      : t("studio.approveBtn")
                  : t("studio.saveOnly")}
            </Text>
            {pins.length > 0 ? (
              <View
                style={{
                  paddingHorizontal: 5,
                  paddingVertical: 1,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.24)",
                }}
              >
                <Text
                  style={{
                    fontSize: 10.5,
                    fontWeight: "800",
                    color: "#FFFFFF",
                  }}
                >
                  {pins.length}
                </Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {/* Optional Path Switcher (Desktop) */}
      {pathPickerOpen && onChangePath ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
            paddingVertical: 8,
            backgroundColor: theme.colors.surface1,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <Icon
            name="FolderOpen"
            size={14}
            color={theme.colors.foregroundMuted}
          />
          <TextInput
            value={draftPathInput}
            onChangeText={setDraftPathInput}
            onSubmitEditing={() => {
              if (draftPathInput.trim()) {
                onChangePath(draftPathInput.trim());
                setPathPickerOpen(false);
              }
            }}
            placeholder={t("studio.pathPlaceholder")}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              flex: 1,
              height: 32,
              borderRadius: 7,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              paddingHorizontal: 10,
              fontSize: 12.5,
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (draftPathInput.trim()) {
                onChangePath(draftPathInput.trim());
                setPathPickerOpen(false);
              }
            }}
            style={{
              height: 32,
              paddingHorizontal: 12,
              borderRadius: 7,
              backgroundColor: theme.colors.accent,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: theme.colors.accentForeground,
              }}
            >
              {t("studio.switchPath")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Optional Session Selector Strip */}
      {agentPickerOpen && agentOptions && agentOptions.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{
            maxHeight: 40,
            backgroundColor: theme.colors.surface1,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
          contentContainerStyle={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 14,
            gap: 6,
          }}
        >
          <Text style={{ fontSize: 11.5, color: theme.colors.foregroundMuted }}>
            {t("studio.targetSession")}
          </Text>
          {agentOptions.map((opt) => {
            const active = opt.id === agentId;
            return (
              <Pressable
                key={opt.id}
                onPress={() => {
                  onSelectAgent?.(opt.id);
                  setAgentPickerOpen(false);
                }}
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 3.5,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? "#10B981" : theme.colors.border,
                  backgroundColor: active
                    ? "rgba(16,185,129,0.12)"
                    : theme.colors.surface0,
                }}
              >
                <Text
                  style={{
                    fontSize: 11.5,
                    fontWeight: active ? "700" : "500",
                    color: active ? "#10B981" : theme.colors.foreground,
                  }}
                >
                  {opt.title}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Main Studio Body: Flex 1 Canvas + Flush Inspector Drawer */}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: isNarrowLayout ? "column" : "row",
        }}
      >
        {/* Canvas Stage */}
        <View
          onLayout={
            platform !== "web"
              ? (ev: LayoutChangeEvent) => {
                  const w = ev.nativeEvent.layout.width;
                  if (w > 0) setMobileCanvasWidth(w);
                }
              : undefined
          }
          style={{
            flex: 1,
            minHeight: 0,
            backgroundColor: canvasBackdrop,
            alignItems: "center",
            justifyContent: "center",
            padding:
              platform !== "web" || viewportPreset === "responsive"
                ? 0
                : isNarrowLayout
                  ? 6
                  : 16,
          }}
        >
          {isBusyLoading ? (
            <View style={{ alignItems: "center", gap: 10 }}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text
                style={{ fontSize: 12.5, color: theme.colors.foregroundMuted }}
              >
                {platform !== "web"
                  ? t("studio.loadingMobile")
                  : t("studio.loadingWeb")}
              </Text>
            </View>
          ) : error || !proto ? (
            <View
              style={{
                alignItems: "center",
                padding: 24,
                gap: 8,
                maxWidth: 420,
              }}
            >
              <Icon
                name="AlertCircle"
                size={26}
                color={theme.colors.statusDanger}
              />
              <Text
                selectable
                style={{
                  fontSize: 13,
                  color: theme.colors.statusDanger,
                  textAlign: "center",
                }}
              >
                {error || t("studio.selectFile")}
              </Text>
            </View>
          ) : platform === "web" ? (
            <View
              style={{
                width: "100%",
                maxWidth: stageTargetMaxWidth,
                flex: 1,
                backgroundColor: "#FFFFFF",
                borderRadius: viewportPreset === "responsive" ? 0 : 16,
                borderWidth: viewportPreset === "responsive" ? 0 : 1,
                borderColor: theme.colors.border,
                overflow: "hidden",
              }}
            >
              {createElement("iframe", {
                ref: iframeRef,
                title: proto.title || proto.fileName,
                srcDoc: instrumentedHtml,
                sandbox: "allow-scripts",
                referrerPolicy: "no-referrer",
                onLoad: () => setFrameReadyCount((c) => c + 1),
                style: {
                  width: "100%",
                  height: "100%",
                  border: "none",
                  display: "block",
                  backgroundColor: "#FFFFFF",
                },
              })}
            </View>
          ) : mobileShot ? (
            <View style={{ flex: 1, width: "100%" }}>
              <ScrollView
                style={{ flex: 1 }}
                scrollEnabled={mode !== "box"}
                showsVerticalScrollIndicator
              >
                <View
                  onTouchStart={onMobileImageTouchStart}
                  onTouchMove={onMobileImageTouchMove}
                  onTouchEnd={onMobileImageTouchEnd}
                  style={{
                    width: effectiveMobileW,
                    height: effectiveMobileH,
                    position: "relative",
                    backgroundColor: "#FFFFFF",
                  }}
                >
                  <Image
                    source={{ uri: mobileShot.imageDataUri }}
                    resizeMode="stretch"
                    style={{
                      width: effectiveMobileW,
                      height: effectiveMobileH,
                    }}
                  />

                  {/* Live drag box preview on iOS/Android */}
                  {nativeDragRect && mode === "box" ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        left: `${Math.min(nativeDragRect.startX, nativeDragRect.curX)}%`,
                        top: `${Math.min(nativeDragRect.startY, nativeDragRect.curY)}%`,
                        width: `${Math.abs(nativeDragRect.curX - nativeDragRect.startX)}%`,
                        height: `${Math.abs(nativeDragRect.curY - nativeDragRect.startY)}%`,
                        borderWidth: 1.5,
                        borderStyle: "dashed",
                        borderColor: "#F97316",
                        backgroundColor: "rgba(249, 115, 22, 0.14)",
                        borderRadius: 10,
                      }}
                    />
                  ) : null}

                  {/* Anchored Pins & Boxes on full scrollable Mobile Canvas (pointerEvents: none in interact mode) */}
                  <View
                    pointerEvents={mode === "interact" ? "none" : "box-none"}
                    style={{
                      position: "absolute",
                      top: 0,
                      right: 0,
                      bottom: 0,
                      left: 0,
                      opacity: mode === "interact" ? 0.45 : 1,
                    }}
                  >
                  {pins.map((p, idx) => {
                    const isAct = p.id === activePinId;
                    const cx = p.canvasXPct ?? p.xPct;
                    const cy = p.canvasYPct ?? p.yPct;
                    const cw = p.canvasWPct ?? p.wPct;
                    const ch = p.canvasHPct ?? p.hPct;

                    if (p.kind === "box" && cw && ch) {
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => setActivePinId(p.id)}
                          style={{
                            position: "absolute",
                            left: `${cx}%`,
                            top: `${cy}%`,
                            width: `${cw}%`,
                            height: `${ch}%`,
                            borderWidth: 1.5,
                            borderStyle: isAct ? "solid" : "dashed",
                            borderColor: isAct ? "#10B981" : "#F97316",
                            backgroundColor: isAct
                              ? "rgba(16,185,129,0.13)"
                              : "rgba(249,115,22,0.1)",
                            borderRadius: 10,
                          }}
                        >
                          <View
                            style={{
                              position: "absolute",
                              top: -11,
                              left: -2,
                              paddingHorizontal: 6,
                              height: 20,
                              borderRadius: 999,
                              backgroundColor: isAct ? "#10B981" : "#F97316",
                              borderWidth: 2,
                              borderColor: "#FFFFFF",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text
                              style={{
                                color: "#FFFFFF",
                                fontSize: 10.5,
                                fontWeight: "800",
                              }}
                            >
                              #{idx + 1}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    }

                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setActivePinId(p.id)}
                        style={{
                          position: "absolute",
                          left: `${cx}%`,
                          top: `${cy}%`,
                          marginLeft: -13,
                          marginTop: -13,
                          width: 26,
                          height: 26,
                          borderRadius: 13,
                          backgroundColor: isAct ? "#10B981" : "#F97316",
                          borderWidth: 2,
                          borderColor: "#FFFFFF",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 11.5,
                            fontWeight: "800",
                          }}
                        >
                          {idx + 1}
                        </Text>
                      </Pressable>
                    );
                  })}
                  </View>
                </View>
              </ScrollView>

              {mobileInteracting ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    top: 10,
                    alignSelf: "center",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: "rgba(15, 23, 42, 0.84)",
                  }}
                >
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 11.5,
                      fontWeight: "600",
                    }}
                  >
                    {t("studio.respondingInteract")}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Right / Bottom Inspector Drawer */}
        {sidebarOpen && proto ? (
          <View
            style={{
              width: isNarrowLayout ? "100%" : 308,
              ...(isNarrowLayout ? { height: 280 } : {}),
              backgroundColor: theme.colors.surface1,
              borderLeftWidth: isNarrowLayout ? 0 : 1,
              borderTopWidth: isNarrowLayout ? 1 : 0,
              borderColor: theme.colors.border,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 14,
                paddingVertical: 9,
                borderBottomWidth: 1,
                borderBottomColor: theme.colors.border,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: "700",
                    color: theme.colors.foreground,
                  }}
                >
                  {t("studio.listHeader", { count: pins.length })}
                </Text>
              </View>

              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                {compact ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      void saveHtmlStringToDevice(
                        proto.bundledHtml,
                        proto.fileName,
                        {
                          startedDownload: (name, size) =>
                            t("save.startedDownload", { name, size }),
                          openedShare: (name) => t("save.openedShare", { name }),
                        },
                      )
                        .then((msg) => toast.show(msg, { variant: "success" }))
                        .catch((e) =>
                          toast.error(
                            e instanceof Error ? e.message : String(e),
                          ),
                        );
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 11.5,
                        fontWeight: "600",
                        color: theme.colors.foregroundMuted,
                      }}
                    >
                      {t("studio.exportHtml")}
                    </Text>
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowGlobalNote((v) => !v)}
                >
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: "600",
                      color: showGlobalNote
                        ? "#10B981"
                        : theme.colors.foregroundMuted,
                    }}
                  >
                    {t("studio.globalNoteToggle")}
                  </Text>
                </Pressable>

                {pins.length > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("studio.clearAllA11y")}
                    onPress={() => {
                      setPins([]);
                      setActivePinId(null);
                    }}
                  >
                    <Icon
                      name="Trash2"
                      size={13.5}
                      color={theme.colors.foregroundMuted}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: 12, gap: 8 }}
            >
              {showGlobalNote ? (
                <View
                  style={{
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.surface0,
                    padding: 10,
                    gap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11.5,
                      fontWeight: "600",
                      color: theme.colors.foregroundMuted,
                    }}
                  >
                    {t("studio.globalNoteTitle")}
                  </Text>
                  <TextInput
                    value={overallNote}
                    onChangeText={setOverallNote}
                    placeholder={t("studio.globalNotePlaceholder")}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    multiline
                    style={{
                      minHeight: 48,
                      color: theme.colors.foreground,
                      fontSize: 12.5,
                      padding: 0,
                      textAlignVertical: "top",
                    }}
                  />
                </View>
              ) : null}

              {pins.length === 0 ? (
                <View
                  style={{
                    paddingVertical: 28,
                    paddingHorizontal: 16,
                    alignItems: "center",
                    gap: 9,
                  }}
                >
                  {mode === "interact" ? (
                    <Icon icon={INTERACT_SVG_ICON} size={18} color="#10B981" />
                  ) : (
                    <Icon
                      name="MapPin"
                      size={18}
                      color="#F97316"
                    />
                  )}
                  <Text
                    style={{
                      fontSize: 12.5,
                      fontWeight: "600",
                      color: theme.colors.foreground,
                    }}
                  >
                    {mode === "interact"
                      ? t("studio.emptyInteractTitle")
                      : t("studio.emptyPinTitle")}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11.5,
                      color: theme.colors.foregroundMuted,
                      textAlign: "center",
                      lineHeight: 17,
                    }}
                  >
                    {mode === "interact"
                      ? t("studio.emptyInteractHint")
                      : t("studio.emptyPinHint")}
                  </Text>
                  {mode === "interact" ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => setMode("pin")}
                      style={({ pressed }) => ({
                        marginTop: 2,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        height: 30,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: "rgba(249, 115, 22, 0.42)",
                        backgroundColor: "rgba(249, 115, 22, 0.12)",
                        opacity: pressed ? 0.78 : 1,
                      })}
                    >
                      <Icon name="MapPin" size={12.5} color="#F97316" />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: "600",
                          color: "#F97316",
                        }}
                      >
                        {t("studio.switchToPin")}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : (
                pins.map((pin, idx) => {
                  const isAct = pin.id === activePinId;
                  return (
                    <Pressable
                      key={pin.id}
                      onPress={() => setActivePinId(pin.id)}
                      style={{
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: isAct ? "#10B981" : theme.colors.border,
                        backgroundColor: theme.colors.surface0,
                        padding: 10,
                        gap: 6,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6,
                            flex: 1,
                          }}
                        >
                          <View
                            style={{
                              minWidth: 20,
                              height: 20,
                              paddingHorizontal: 5,
                              borderRadius: 999,
                              backgroundColor: isAct ? "#10B981" : "#F97316",
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
                              {idx + 1}
                            </Text>
                          </View>
                          <Text
                            numberOfLines={1}
                            style={{
                              fontSize: 12.5,
                              fontWeight: "600",
                              color: theme.colors.foreground,
                              flex: 1,
                            }}
                          >
                            {pin.part}
                          </Text>
                        </View>

                        <Pressable
                          accessibilityRole="button"
                          onPress={() => removePin(pin.id)}
                          style={{ padding: 2 }}
                        >
                          <Icon
                            name="X"
                            size={13.5}
                            color={theme.colors.foregroundMuted}
                          />
                        </Pressable>
                      </View>

                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 11,
                          color: theme.colors.foregroundMuted,
                        }}
                      >
                        {pin.screen} · {pin.xPct}%, {pin.yPct}%
                      </Text>

                      <TextInput
                        value={pin.note}
                        onChangeText={(txt) => updatePin(pin.id, { note: txt })}
                        placeholder={t("studio.notePlaceholder")}
                        placeholderTextColor={theme.colors.foregroundMuted}
                        multiline
                        style={{
                          minHeight: 40,
                          borderTopWidth: 1,
                          borderTopColor: theme.colors.border,
                          paddingTop: 6,
                          color: theme.colors.foreground,
                          fontSize: 12.5,
                          textAlignVertical: "top",
                        }}
                      />
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                gap: 8,
              }}
            >
              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => void handleSaveOrSubmit(false)}
                style={{
                  paddingHorizontal: 10,
                  height: 32,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: "600",
                    color: theme.colors.foregroundMuted,
                  }}
                >
                  {t("studio.saveDraft")}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => void handleSaveOrSubmit(true)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: hasFeedback ? "#10B981" : theme.colors.accent,
                }}
              >
                <Icon
                  name={hasFeedback ? "Send" : "Check"}
                  size={13}
                  color={hasFeedback ? "#FFFFFF" : theme.colors.accentForeground}
                />
                <Text
                  style={{
                    fontSize: 12.5,
                    fontWeight: "700",
                    color: hasFeedback
                      ? "#FFFFFF"
                      : theme.colors.accentForeground,
                  }}
                >
                  {agentId
                    ? hasFeedback
                      ? t("studio.sendCountToAgent", { count: pins.length })
                      : t("studio.approveNotify")
                    : t("studio.saveAndCopy")}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {/* Mobile Bottom Quick-Note Bar when Drawer is Closed */}
      {isNarrowLayout && !sidebarOpen && activePin ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: theme.colors.surface1,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <View
            style={{
              minWidth: 22,
              height: 22,
              paddingHorizontal: 6,
              borderRadius: 999,
              backgroundColor: "#10B981",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>
              {activePinIndex + 1}
            </Text>
          </View>
          <TextInput
            value={activePin.note}
            onChangeText={(txt) => updatePin(activePin.id, { note: txt })}
            placeholder={t("studio.quickEditPlaceholder", {
              part: activePin.part,
            })}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={{
              flex: 1,
              height: 34,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.surface0,
              color: theme.colors.foreground,
              paddingHorizontal: 10,
              fontSize: 12.5,
            }}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setActivePinId(null)}
            style={{ padding: 5 }}
          >
            <Icon name="Check" size={16} color="#10B981" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => removePin(activePin.id)}
            style={{ padding: 5 }}
          >
            <Icon name="Trash2" size={15} color={theme.colors.statusDanger} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
