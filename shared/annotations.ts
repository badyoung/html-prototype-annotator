import { z } from "zod";

export const HTML_EXTENSIONS = ["html", "htm"] as const;
const HTML_EXT_SET = new Set<string>(HTML_EXTENSIONS);

export const annotationPinSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["pin", "box"]).default("pin"),
  screen: z.string().max(160).default("主画板"),
  part: z.string().max(240).default("画面区域"),
  selector: z.string().max(240).optional(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(0).max(100).optional(),
  hPct: z.number().min(0).max(100).optional(),
  canvasXPct: z.number().min(0).max(100).optional(),
  canvasYPct: z.number().min(0).max(100).optional(),
  canvasWPct: z.number().min(0).max(100).optional(),
  canvasHPct: z.number().min(0).max(100).optional(),
  note: z.string().max(4000).default(""),
});

export type AnnotationPin = z.infer<typeof annotationPinSchema>;

export const extractedHtmlTargetSchema = z.object({
  rawHref: z.string(),
  cleanPath: z.string(),
  label: z.string(),
  fileName: z.string(),
  extension: z.string(),
});

export type ExtractedHtmlTarget = z.infer<typeof extractedHtmlTargetSchema>;

export function extractFileName(pathLike: string): string {
  const cleaned = pathLike.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export function extractExtension(pathLike: string): string {
  const base = extractFileName(pathLike);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function isHtmlFilePath(pathLike: string): boolean {
  return HTML_EXT_SET.has(extractExtension(pathLike));
}

export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(2)} MB`;
}

const EXTERNAL_SCHEME_RE =
  /^(?:https?|mailto|tel|javascript|data|blob|conversation|vscode|cursor|jetbrains|about|chrome):/i;

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function normalizeHtmlLinkToPath(
  rawInput: string,
  options: { requirePathPrefixForPlain?: boolean } = {},
): string | null {
  const trimmed = rawInput.trim().replace(/^<|>$/g, "");
  if (!trimmed || trimmed.includes("\0") || /\r|\n/.test(trimmed)) return null;
  if (EXTERNAL_SCHEME_RE.test(trimmed)) return null;

  let pathPart = trimmed;
  if (/^file:\/\//i.test(pathPart)) {
    try {
      const parsed = new URL(pathPart);
      if (parsed.protocol.toLowerCase() !== "file:") return null;
      if (parsed.hostname && parsed.hostname.toLowerCase() !== "localhost") {
        return null;
      }
      pathPart = safeDecodeUri(parsed.pathname);
      if (/^\/[A-Za-z]:\//.test(pathPart)) pathPart = pathPart.slice(1);
    } catch {
      const withoutScheme = pathPart.replace(/^file:\/\/(?:localhost)?/i, "");
      const cutIdx = withoutScheme.search(/[?#]/);
      pathPart = safeDecodeUri(cutIdx >= 0 ? withoutScheme.slice(0, cutIdx) : withoutScheme);
    }
  } else {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(pathPart)) return null;
    const cutIdx = pathPart.search(/[?#]/);
    if (cutIdx >= 0) pathPart = pathPart.slice(0, cutIdx);
    pathPart = safeDecodeUri(pathPart);
  }

  const lineColMatch = /^(.+\.[A-Za-z0-9]{1,12}):\d+(?::\d+)?(?:-\d+(?::\d+)?)?$/.exec(pathPart);
  if (lineColMatch?.[1]) {
    pathPart = lineColMatch[1];
  }

  pathPart = pathPart.trim();
  if (!pathPart || pathPart.endsWith("/")) return null;

  const isExplicitLocalPrefix =
    pathPart.startsWith("/") ||
    pathPart.startsWith("~/") ||
    pathPart.startsWith("./") ||
    pathPart.startsWith("../");

  if (options.requirePathPrefixForPlain && !isExplicitLocalPrefix && !/^file:\/\//i.test(trimmed)) {
    return null;
  }

  if (!isHtmlFilePath(pathPart)) return null;
  return pathPart;
}

function stripFencedCodeBlocks(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n");
}

function parseMarkdownLinks(text: string): Array<{ label: string; href: string }> {
  const results: Array<{ label: string; href: string }> = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const isImg = text[i] === "!" && text[i + 1] === "[";
    if (isImg) {
      i += 2;
      continue;
    }
    if (text[i] !== "[") {
      i += 1;
      continue;
    }
    let closeBracket = i + 1;
    let depth = 1;
    while (closeBracket < len && depth > 0) {
      if (text[closeBracket] === "\\") {
        closeBracket += 2;
        continue;
      }
      if (text[closeBracket] === "\n") break;
      if (text[closeBracket] === "[") depth += 1;
      else if (text[closeBracket] === "]") depth -= 1;
      if (depth > 0) closeBracket += 1;
    }
    if (depth !== 0 || text[closeBracket + 1] !== "(") {
      i += 1;
      continue;
    }
    const label = text.slice(i + 1, closeBracket).trim();
    const openParen = closeBracket + 1;
    let closeParen = openParen + 1;
    let pDepth = 1;
    while (closeParen < len && pDepth > 0) {
      if (text[closeParen] === "\\") {
        closeParen += 2;
        continue;
      }
      if (text[closeParen] === "\n") break;
      if (text[closeParen] === "(") pDepth += 1;
      else if (text[closeParen] === ")") pDepth -= 1;
      if (pDepth > 0) closeParen += 1;
    }
    if (pDepth !== 0) {
      i += 1;
      continue;
    }
    let rawHref = text.slice(openParen + 1, closeParen).trim();
    const titleMatch = /^(\S+)\s+["'][^"']*["']$/.exec(rawHref);
    if (titleMatch?.[1]) rawHref = titleMatch[1];
    if (rawHref) results.push({ label, href: rawHref });
    i = closeParen + 1;
  }
  return results;
}

export function extractHtmlPrototypeTargets(markdown: string): ExtractedHtmlTarget[] {
  if (!markdown || markdown.length < 5) return [];
  const stripped = stripFencedCodeBlocks(markdown);
  const byPath = new Map<string, ExtractedHtmlTarget>();

  const register = (rawHref: string, rawLabel: string | null, requirePrefix: boolean) => {
    const cleanPath = normalizeHtmlLinkToPath(rawHref, {
      requirePathPrefixForPlain: requirePrefix,
    });
    if (!cleanPath) return;
    const fileName = extractFileName(cleanPath);
    const extension = extractExtension(fileName);
    const cleanedLabel = rawLabel?.replace(/`/g, "").trim() || "";
    const label = cleanedLabel && !cleanedLabel.startsWith("file://") ? cleanedLabel : fileName;
    if (!byPath.has(cleanPath)) {
      byPath.set(cleanPath, { rawHref, cleanPath, label, fileName, extension });
    }
  };

  for (const link of parseMarkdownLinks(stripped)) {
    const hasFileScheme = /^file:\/\//i.test(link.href);
    register(link.href, link.label, !hasFileScheme);
  }

  const withoutMdLinks = stripped.replace(/!?\[[^\]\n]*\]\([^)\n]+\)/g, " ");
  const inlineCodeRe = /`([^`\n]{4,400})`/g;
  let m: RegExpExecArray | null;
  while ((m = inlineCodeRe.exec(withoutMdLinks)) !== null) {
    const token = m[1]?.trim() ?? "";
    if (!token || /\s/.test(token)) continue;
    register(token, null, true);
  }

  return Array.from(byPath.values()).slice(0, 16);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ExtractedSemanticTargets {
  title: string;
  screens: string[];
  parts: string[];
}

export function extractSemanticTargetsFromHtml(html: string): ExtractedSemanticTargets {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, "")) : "";

  const screensSet = new Set<string>();
  const screenAttrRe = /\bdata-screen\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let sm: RegExpExecArray | null;
  while ((sm = screenAttrRe.exec(html)) !== null) {
    const val = decodeHtmlEntities(sm[1] ?? sm[2] ?? "");
    if (val) screensSet.add(val);
    if (screensSet.size >= 16) break;
  }

  const partsSet = new Set<string>();
  const partAttrRe = /\bdata-part\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let pm: RegExpExecArray | null;
  while ((pm = partAttrRe.exec(html)) !== null) {
    const val = decodeHtmlEntities(pm[1] ?? pm[2] ?? "");
    if (val) partsSet.add(val);
    if (partsSet.size >= 36) break;
  }

  if (partsSet.size < 12) {
    const btnOrHeadingRe = /<(button|h1|h2|h3)\b[^>]*>([\s\S]{1,120}?)<\/\1>/gi;
    let bm: RegExpExecArray | null;
    while ((bm = btnOrHeadingRe.exec(html)) !== null) {
      const text = decodeHtmlEntities((bm[2] ?? "").replace(/<[^>]+>/g, ""));
      if (text && text.length >= 2 && text.length <= 40) {
        partsSet.add(text);
      }
      if (partsSet.size >= 28) break;
    }
  }

  return {
    title,
    screens: Array.from(screensSet),
    parts: Array.from(partsSet),
  };
}

export function isChineseLocale(locale?: string | null): boolean {
  if (!locale) return false;
  return /^zh(?:\b|[-_])/i.test(locale.trim());
}

export function formatAnnotationsMarkdown(params: {
  fileName: string;
  resolvedPath: string;
  savedMarkdownPath?: string | null;
  pins: readonly AnnotationPin[];
  overallNote?: string;
  approvedAsIs?: boolean;
  locale?: string | null;
}): string {
  const {
    fileName,
    resolvedPath,
    savedMarkdownPath,
    pins,
    overallNote,
    approvedAsIs,
    locale,
  } = params;
  const zh = isChineseLocale(locale);
  const trimmedOverall = overallNote?.trim() ?? "";

  if (pins.length === 0 && (approvedAsIs || !trimmedOverall)) {
    if (zh) {
      const header = [
        `### ✅ HTML 原型确认通过：\`${fileName}\``,
        `- 原型文件：\`${resolvedPath}\``,
        ...(savedMarkdownPath ? [`- 批注存档：\`${savedMarkdownPath}\``] : []),
        "",
        trimmedOverall
          ? `整体说明：${trimmedOverall}`
          : "无额外视觉/交互修改标注，请按此原型继续推进实现。",
      ];
      return header.join("\n");
    }
    const header = [
      `### ✅ HTML Prototype Approved: \`${fileName}\``,
      `- Prototype file: \`${resolvedPath}\``,
      ...(savedMarkdownPath ? [`- Saved feedback: \`${savedMarkdownPath}\``] : []),
      "",
      trimmedOverall
        ? `Overall note: ${trimmedOverall}`
        : "Approved with no visual or interaction changes requested. Please proceed with implementation.",
    ];
    return header.join("\n");
  }

  if (zh) {
    const lines: string[] = [
      `### 📌 HTML 原型视觉批注反馈：\`${fileName}\``,
      `- 原型文件：\`${resolvedPath}\``,
      ...(savedMarkdownPath ? [`- 批注存档：\`${savedMarkdownPath}\``] : []),
      `- 标注数量：共 **${pins.length}** 处`,
      "",
    ];

    pins.forEach((pin, idx) => {
      const num = idx + 1;
      const screenPrefix =
        pin.screen && pin.screen !== "主画板" && pin.screen !== "Main Canvas"
          ? `[${pin.screen}] `
          : "";
      const coordDesc =
        pin.kind === "box" && pin.wPct && pin.hPct
          ? `框选 \`${pin.xPct.toFixed(1)}%, ${pin.yPct.toFixed(1)}%\` · 尺寸 \`${pin.wPct.toFixed(1)}% × ${pin.hPct.toFixed(1)}%\``
          : `点按 \`${pin.xPct.toFixed(1)}%, ${pin.yPct.toFixed(1)}%\``;
      const selSuffix = pin.selector ? ` · \`${pin.selector}\`` : "";
      const noteText = pin.note.trim() || "（此处需调整，请结合上下文优化）";
      lines.push(
        `${num}. **#${num} ${screenPrefix}${pin.part || "画面区域"}**（${coordDesc}${selSuffix}）`,
      );
      lines.push(`   > ${noteText.replace(/\r?\n/g, "\n   > ")}`);
    });

    if (trimmedOverall) {
      lines.push("");
      lines.push(`**整体补充说明**：${trimmedOverall}`);
    }

    return lines.join("\n");
  }

  const lines: string[] = [
    `### 📌 HTML Prototype Annotations: \`${fileName}\``,
    `- Prototype file: \`${resolvedPath}\``,
    ...(savedMarkdownPath ? [`- Saved feedback: \`${savedMarkdownPath}\``] : []),
    `- Annotations: **${pins.length}**`,
    "",
  ];

  pins.forEach((pin, idx) => {
    const num = idx + 1;
    const screenPrefix =
      pin.screen && pin.screen !== "Main Canvas" && pin.screen !== "主画板"
        ? `[${pin.screen}] `
        : "";
    const coordDesc =
      pin.kind === "box" && pin.wPct && pin.hPct
        ? `region \`${pin.xPct.toFixed(1)}%, ${pin.yPct.toFixed(1)}%\` · size \`${pin.wPct.toFixed(1)}% × ${pin.hPct.toFixed(1)}%\``
        : `pin \`${pin.xPct.toFixed(1)}%, ${pin.yPct.toFixed(1)}%\``;
    const selSuffix = pin.selector ? ` · \`${pin.selector}\`` : "";
    const noteText =
      pin.note.trim() || "(Needs adjustment — please refine in context)";
    lines.push(
      `${num}. **#${num} ${screenPrefix}${pin.part || "Canvas region"}** (${coordDesc}${selSuffix})`,
    );
    lines.push(`   > ${noteText.replace(/\r?\n/g, "\n   > ")}`);
  });

  if (trimmedOverall) {
    lines.push("");
    lines.push(`**Overall notes**: ${trimmedOverall}`);
  }

  return lines.join("\n");
}
