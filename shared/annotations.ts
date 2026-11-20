import { z } from "zod";

export const HTML_EXTENSIONS = ["html", "htm"] as const;
const HTML_EXT_SET = new Set<string>(HTML_EXTENSIONS);

export const annotationPinSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(["pin", "box"]).default("pin"),
  screen: z.string().max(160).default("主画板"),
  part: z.string().max(240).default("画面区域"),
  selector: z.string().max(240).optional(),
  domPath: z.string().max(400).optional(),
  textSnippet: z.string().max(240).optional(),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  wPct: z.number().min(0).max(100).optional(),
  hPct: z.number().min(0).max(100).optional(),
  canvasXPct: z.number().min(0).max(100).optional(),
  canvasYPct: z.number().min(0).max(100).optional(),
  canvasWPct: z.number().min(0).max(100).optional(),
  canvasHPct: z.number().min(0).max(100).optional(),
  sentAt: z.string().max(64).optional(),
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

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const safeFileAttr = escapeXmlAttr(fileName);

  if (pins.length === 0 && (approvedAsIs || !trimmedOverall)) {
    const openTag = `<prototype-feedback version="1" status="approved" file="${safeFileAttr}" count="0">`;
    if (zh) {
      const header = [
        openTag,
        `### ✅ HTML 原型确认通过：\`${fileName}\``,
        `- 原型文件：\`${resolvedPath}\``,
        ...(savedMarkdownPath ? [`- 批注存档：\`${savedMarkdownPath}\``] : []),
        "",
        trimmedOverall
          ? `整体说明：${trimmedOverall}`
          : "无额外视觉/交互修改标注，请按此原型继续推进实现。",
        "</prototype-feedback>",
      ];
      return header.join("\n");
    }
    const header = [
      openTag,
      `### ✅ HTML Prototype Approved: \`${fileName}\``,
      `- Prototype file: \`${resolvedPath}\``,
      ...(savedMarkdownPath ? [`- Saved feedback: \`${savedMarkdownPath}\``] : []),
      "",
      trimmedOverall
        ? `Overall note: ${trimmedOverall}`
        : "Approved with no visual or interaction changes requested. Please proceed with implementation.",
      "</prototype-feedback>",
    ];
    return header.join("\n");
  }

  const distinctScreens = new Set(
    pins.map((p) => p.screen.trim()).filter(Boolean),
  ).size;
  const openTag = `<prototype-feedback version="1" status="changes_requested" file="${safeFileAttr}" count="${pins.length}" screens="${distinctScreens}">`;

  if (zh) {
    const screenSummary =
      distinctScreens > 1 ? `（涉及 **${distinctScreens}** 个画板）` : "";
    const lines: string[] = [
      openTag,
      `### 📌 HTML 原型视觉批注反馈：\`${fileName}\``,
      `- 原型文件：\`${resolvedPath}\``,
      ...(savedMarkdownPath ? [`- 批注存档：\`${savedMarkdownPath}\``] : []),
      `- 标注数量：共 **${pins.length}** 处${screenSummary}`,
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
      if (pin.domPath && pin.domPath !== pin.selector) {
        lines.push(`   - DOM 路径：\`${pin.domPath}\``);
      }
      if (pin.textSnippet) {
        lines.push(`   - 元素文本：「${pin.textSnippet.replace(/\r?\n/g, " ")}」`);
      }
      lines.push(`   > ${noteText.replace(/\r?\n/g, "\n   > ")}`);
    });

    if (trimmedOverall) {
      lines.push("");
      lines.push(`**整体补充说明**：${trimmedOverall}`);
    }

    lines.push("</prototype-feedback>");
    return lines.join("\n");
  }

  const screenSummaryEn =
    distinctScreens > 1 ? ` across **${distinctScreens}** screens` : "";
  const lines: string[] = [
    openTag,
    `### 📌 HTML Prototype Annotations: \`${fileName}\``,
    `- Prototype file: \`${resolvedPath}\``,
    ...(savedMarkdownPath ? [`- Saved feedback: \`${savedMarkdownPath}\``] : []),
    `- Annotations: **${pins.length}**${screenSummaryEn}`,
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
    if (pin.domPath && pin.domPath !== pin.selector) {
      lines.push(`   - DOM path: \`${pin.domPath}\``);
    }
    if (pin.textSnippet) {
      lines.push(`   - Element text: "${pin.textSnippet.replace(/\r?\n/g, " ")}"`);
    }
    lines.push(`   > ${noteText.replace(/\r?\n/g, "\n   > ")}`);
  });

  if (trimmedOverall) {
    lines.push("");
    lines.push(`**Overall notes**: ${trimmedOverall}`);
  }

  lines.push("</prototype-feedback>");
  return lines.join("\n");
}

export const parsedFeedbackItemSchema = z.object({
  index: z.number().int().positive(),
  kind: z.enum(["pin", "box"]),
  screen: z.string().optional(),
  part: z.string(),
  coordSummary: z.string().optional(),
  selector: z.string().optional(),
  domPath: z.string().optional(),
  textSnippet: z.string().optional(),
  note: z.string(),
});

export type ParsedFeedbackItem = z.infer<typeof parsedFeedbackItemSchema>;

export const parsedPrototypeFeedbackSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  fileName: z.string(),
  prototypePath: z.string().optional(),
  savedMarkdownPath: z.string().optional(),
  items: z.array(parsedFeedbackItemSchema),
  overallNote: z.string().optional(),
});

export type ParsedPrototypeFeedback = z.infer<
  typeof parsedPrototypeFeedbackSchema
>;

export function parsePrototypeFeedbackMessage(
  rawText: string,
): ParsedPrototypeFeedback | null {
  if (!rawText || rawText.length < 18) return null;
  const trimmed = rawText.trim();

  const hasEnvelope = trimmed.includes("<prototype-feedback");
  const hasLegacyHeader =
    trimmed.startsWith("### 📌 HTML 原型视觉批注反馈：") ||
    trimmed.startsWith("### ✅ HTML 原型确认通过：") ||
    trimmed.startsWith("### 📌 HTML Prototype Annotations:") ||
    trimmed.startsWith("### ✅ HTML Prototype Approved:");

  if (!hasEnvelope && !hasLegacyHeader) return null;

  const inner = trimmed
    .replace(/^[\s\S]*?<prototype-feedback\b[^>]*>\s*/i, "")
    .replace(/\s*<\/prototype-feedback>\s*$/i, "")
    .trim();

  const lines = inner.split(/\r?\n/);
  const headingLine = lines.find((l) => l.startsWith("### ")) ?? "";
  const isApproved =
    /status="approved"/i.test(trimmed) ||
    headingLine.includes("✅") ||
    headingLine.includes("确认通过") ||
    headingLine.includes("Approved");

  const headingFileMatch = /`([^`]+)`/.exec(headingLine);
  const attrFileMatch = /\bfile="([^"]+)"/i.exec(trimmed);
  let fileName =
    headingFileMatch?.[1]?.trim() || attrFileMatch?.[1]?.trim() || "prototype.html";

  let prototypePath: string | undefined;
  let savedMarkdownPath: string | undefined;
  let overallNote: string | undefined;
  const items: ParsedFeedbackItem[] = [];

  let currentItem: ParsedFeedbackItem | null = null;
  let approvedBodyLines: string[] = [];

  const flushCurrent = () => {
    if (currentItem) {
      currentItem.note = currentItem.note.trim();
      items.push(currentItem);
      currentItem = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("### ")) continue;

    const protoPathMatch =
      /^-\s*(?:原型文件|Prototype file)[：:]\s*`([^`]+)`/.exec(line);
    if (protoPathMatch?.[1]) {
      prototypePath = protoPathMatch[1].trim();
      if (!headingFileMatch && prototypePath) {
        fileName = extractFileName(prototypePath) || fileName;
      }
      continue;
    }

    const savedMdMatch =
      /^-\s*(?:批注存档|Saved feedback)[：:]\s*`([^`]+)`/.exec(line);
    if (savedMdMatch?.[1]) {
      savedMarkdownPath = savedMdMatch[1].trim();
      continue;
    }

    if (/^-\s*(?:标注数量|Annotations)[：:]/.test(line)) {
      continue;
    }

    const overallMatch =
      /^(?:\*\*(?:整体补充说明|Overall notes)\*\*|整体说明|Overall note)[：:]\s*(.+)$/.exec(
        line,
      );
    if (overallMatch?.[1]) {
      flushCurrent();
      overallNote = overallMatch[1].trim();
      continue;
    }

    // Match numbered item header: e.g. `1. **#1 [Screen] Part**（框选 ... · `sel`）` or `1. **#1 [Screen] Part** (region ... · `sel`)`
    const itemMatch =
      /^(\d+)\.\s*\*\*#\d+\s*(?:\[([^\]]+)\]\s*)?([^*]+)\*\*\s*[（(](.+)[)）]\s*$/.exec(
        line,
      );
    if (itemMatch) {
      flushCurrent();
      const idx = Number.parseInt(itemMatch[1] ?? "1", 10) || items.length + 1;
      const screen = itemMatch[2]?.trim() || undefined;
      const part = itemMatch[3]?.trim() || "UI";
      const metaRaw = itemMatch[4]?.trim() ?? "";
      const isBox =
        metaRaw.startsWith("框选") || metaRaw.toLowerCase().startsWith("region");

      let selector: string | undefined;
      let coordSummary = metaRaw.replace(/`/g, "");
      const trailingSelMatch = /^(.*)\s*·\s*`([^`]+)`\s*$/.exec(metaRaw);
      if (trailingSelMatch) {
        const candidateSel = trailingSelMatch[2]?.trim() ?? "";
        // Distinguish CSS selector from `80.0% × 10.0%` dimension token
        if (candidateSel && !candidateSel.includes("%")) {
          selector = candidateSel;
          coordSummary = (trailingSelMatch[1] ?? "").replace(/`/g, "").trim();
        }
      }

      currentItem = {
        index: idx,
        kind: isBox ? "box" : "pin",
        ...(screen ? { screen } : {}),
        part,
        ...(coordSummary ? { coordSummary } : {}),
        ...(selector ? { selector } : {}),
        note: "",
      };
      continue;
    }

    if (currentItem) {
      const domPathMatch = /^-\s*DOM\s*(?:路径|path)[：:]\s*`([^`]+)`/i.exec(line);
      if (domPathMatch?.[1]) {
        currentItem.domPath = domPathMatch[1].trim();
        continue;
      }
      const textSnapMatch =
        /^-\s*(?:元素文本|Element text)[：:]\s*[「"](.+)[」"]$/.exec(line);
      if (textSnapMatch?.[1]) {
        currentItem.textSnippet = textSnapMatch[1].trim();
        continue;
      }
      const quoteMatch = /^>\s?(.*)$/.exec(line);
      if (quoteMatch) {
        const chunk = (quoteMatch[1] ?? "")
          .replace(/^\*\*(?:修改意见|Note)\*\*[：:]\s*/, "")
          .trim();
        currentItem.note = currentItem.note
          ? `${currentItem.note}\n${chunk}`
          : chunk;
        continue;
      }
    } else if (isApproved) {
      approvedBodyLines.push(line);
    }
  }

  flushCurrent();

  if (isApproved && !overallNote && approvedBodyLines.length > 0) {
    const joined = approvedBodyLines.join(" ").trim();
    if (
      joined &&
      !joined.includes("无额外视觉/交互修改标注") &&
      !joined.includes("Approved with no visual or interaction changes")
    ) {
      overallNote = joined;
    }
  }

  return {
    status: isApproved ? "approved" : "changes_requested",
    fileName,
    ...(prototypePath ? { prototypePath } : {}),
    ...(savedMarkdownPath ? { savedMarkdownPath } : {}),
    items,
    ...(overallNote ? { overallNote } : {}),
  };
}
