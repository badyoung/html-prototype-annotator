import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

type PaseoApi = PluginHandlerContext["paseo"];
import {
  annotationPinSchema,
  extractFileName,
  extractSemanticTargetsFromHtml,
  formatAnnotationsMarkdown,
  formatByteSize,
  isHtmlFilePath,
  normalizeHtmlLinkToPath,
  type AnnotationPin,
} from "../shared/annotations";
import {
  MAX_BUNDLED_ASSET_BYTES,
  MAX_PROTOTYPE_HTML_BYTES,
  MAX_TOTAL_BUNDLED_BYTES,
  PROTOTYPE_HTML_CHUNK_CHARS,
  type LoadHtmlPrototypeOutput,
  type ReadPrototypeHtmlChunkOutput,
  type SubmitPrototypeAnnotationsOutput,
} from "../shared/rpc";

interface BundledHtmlCacheEntry {
  cacheKey: string;
  bundledHtml: string;
  rawHtml: string;
  byteSize: number;
  mtimeMs: number;
  modifiedAt: string;
  ts: number;
}

const bundledHtmlCache = new Map<string, BundledHtmlCacheEntry>();
const MAX_BUNDLED_CACHE_ENTRIES = 4;

function putBundledCache(canonicalPath: string, entry: BundledHtmlCacheEntry): void {
  bundledHtmlCache.delete(canonicalPath);
  bundledHtmlCache.set(canonicalPath, entry);
  while (bundledHtmlCache.size > MAX_BUNDLED_CACHE_ENTRIES) {
    const oldestKey = bundledHtmlCache.keys().next().value;
    if (oldestKey === undefined) break;
    bundledHtmlCache.delete(oldestKey);
  }
}

const ASSET_MIME_BY_EXT: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
};

function hasErrorCode(err: unknown, code: string): boolean {
  return err instanceof Error && "code" in err && err.code === code;
}

export function resolvePrototypePath(
  rawInput: string,
  cwd?: string | null,
): string {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.includes("\0")) {
    throw new Error("Prototype path is empty or contains invalid characters.");
  }

  const normalized =
    normalizeHtmlLinkToPath(trimmed, { requirePathPrefixForPlain: false }) ??
    trimmed.replace(/^file:\/\/(?:localhost)?/i, "").split(/[?#]/)[0]?.trim() ??
    "";

  if (!normalized || normalized.includes("\0")) {
    throw new Error(`Unable to parse HTML prototype path: ${rawInput}`);
  }

  let decoded = normalized;
  try {
    decoded = decodeURIComponent(normalized);
  } catch {
    decoded = normalized;
  }

  let resolved: string;
  if (decoded === "~") {
    resolved = homedir();
  } else if (decoded.startsWith("~/")) {
    resolved = resolve(homedir(), decoded.slice(2));
  } else if (isAbsolute(decoded)) {
    resolved = resolve(decoded);
  } else {
    const baseDir = cwd?.trim();
    resolved =
      baseDir && isAbsolute(baseDir)
        ? resolve(baseDir, decoded)
        : resolve(homedir(), decoded);
  }

  if (!isHtmlFilePath(resolved)) {
    throw new Error(
      `Only .html or .htm prototype files are supported (got: ${extractFileName(resolved)}).`,
    );
  }
  return resolved;
}

function isLocalRelativeAssetRef(ref: string): boolean {
  const t = ref.trim();
  if (!t || t.startsWith("#")) return false;
  if (/^(?:https?:|data:|blob:|mailto:|tel:|javascript:|\/\/)/i.test(t)) {
    return false;
  }
  return true;
}

function isSubPathOrSame(childPath: string, allowedRoot: string): boolean {
  const normRoot = resolve(allowedRoot);
  const normChild = resolve(childPath);
  if (normChild === normRoot) return true;
  const prefix = normRoot.endsWith(sep) ? normRoot : `${normRoot}${sep}`;
  return normChild.startsWith(prefix);
}

/**
 * Inlines local relative `<link rel="stylesheet" href="...">` and `<img src="...">`
 * so multi-file HTML prototypes render 100% zero-port across Relay/Mobile/Web.
 * Resolves `realpath` on both the allowed ceiling and each candidate asset to prevent
 * symlink traversal outside the prototype's parent directory.
 */
export async function bundleLocalHtmlAssets(
  rawHtml: string,
  htmlFilePath: string,
): Promise<string> {
  const realHtmlPath = await realpath(htmlFilePath).catch(() =>
    resolve(htmlFilePath),
  );
  const baseDir = dirname(realHtmlPath);
  const parentCeiling = await realpath(dirname(baseDir)).catch(() =>
    resolve(dirname(baseDir)),
  );
  let totalInlinedBytes = Buffer.byteLength(rawHtml, "utf8");

  // 1. Inline local relative stylesheets
  const linkRe = /<link\b([^>]*?)>/gi;
  let result = rawHtml;
  const linkMatches = [...result.matchAll(linkRe)];
  for (const m of linkMatches) {
    const fullTag = m[0];
    const attrs = m[1] ?? "";
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(attrs)) continue;
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/i.exec(attrs);
    const rawHref =
      (hrefMatch?.[1] ?? hrefMatch?.[2] ?? "").split(/[?#]/)[0]?.trim() ?? "";
    if (!isLocalRelativeAssetRef(rawHref)) continue;

    const cssCandidate = resolve(baseDir, rawHref);
    if (!isSubPathOrSame(cssCandidate, parentCeiling)) continue;
    try {
      const realCssPath = await realpath(cssCandidate);
      if (!isSubPathOrSame(realCssPath, parentCeiling)) continue;
      const st = await stat(realCssPath);
      if (!st.isFile() || st.size > MAX_BUNDLED_ASSET_BYTES) continue;
      if (totalInlinedBytes + st.size > MAX_TOTAL_BUNDLED_BYTES) continue;
      const cssText = await readFile(realCssPath, "utf8");
      if (cssText.includes("</style")) continue;
      totalInlinedBytes += st.size;
      result = result.replace(
        fullTag,
        () => `<style data-inlined-href="${rawHref}">\n${cssText}\n</style>`,
      );
    } catch {
      // leave tag untouched if missing
    }
  }

  // 2. Inline local relative <img src="..."> (skip data:/http:/blob: directly in regex so multi-MB Base64 tags cost ~0ms)
  const imgRe =
    /(<img\b[^>]*?\bsrc\s*=\s*)(?:"(?!(?:data:|https?:|blob:|\/\/))([^"]{1,2048})"|'(?!(?:data:|https?:|blob:|\/\/))([^']{1,2048})')([^>]*>)/gi;
  const imgMatches = [...result.matchAll(imgRe)];
  for (const m of imgMatches) {
    const fullTag = m[0];
    const prefix = m[1] ?? "";
    const rawSrc = m[2] ?? m[3] ?? "";
    const suffix = m[4] ?? "";
    const cleanRel = rawSrc.split(/[?#]/)[0]?.trim() ?? "";
    if (!isLocalRelativeAssetRef(cleanRel)) continue;

    const imgCandidate = resolve(baseDir, cleanRel);
    if (!isSubPathOrSame(imgCandidate, parentCeiling)) continue;
    const ext = extname(imgCandidate).toLowerCase();
    const mime = ASSET_MIME_BY_EXT[ext];
    if (!mime) continue;

    try {
      const realImgPath = await realpath(imgCandidate);
      if (!isSubPathOrSame(realImgPath, parentCeiling)) continue;
      const st = await stat(realImgPath);
      if (!st.isFile() || st.size > MAX_BUNDLED_ASSET_BYTES) continue;
      if (totalInlinedBytes + Math.ceil(st.size * 1.37) > MAX_TOTAL_BUNDLED_BYTES)
        continue;
      const buf = await readFile(realImgPath);
      const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
      totalInlinedBytes += dataUri.length;
      result = result.replace(fullTag, () => `${prefix}"${dataUri}"${suffix}`);
    } catch {
      // leave tag untouched if missing
    }
  }

  return result;
}

export function getAnnotationSidecarPaths(resolvedHtmlPath: string): {
  dir: string;
  jsonPath: string;
  markdownPath: string;
} {
  const dir = join(dirname(resolvedHtmlPath), ".annotations");
  const stem = basename(resolvedHtmlPath, extname(resolvedHtmlPath));
  return {
    dir,
    jsonPath: join(dir, `${stem}.annotations.json`),
    markdownPath: join(dir, `${stem}.annotations.md`),
  };
}

export async function getCachedBundledPrototype(
  rawPath: string,
  cwd?: string | null,
): Promise<{
  canonicalPath: string;
  fileName: string;
  rawHtml: string;
  bundledHtml: string;
  byteSize: number;
  mtimeMs: number;
  modifiedAt: string;
}> {
  const candidatePath = resolvePrototypePath(rawPath, cwd);

  let fileStat;
  try {
    fileStat = await stat(candidatePath);
  } catch (err) {
    if (hasErrorCode(err, "ENOENT")) {
      throw new Error(`Prototype file not found on host: ${candidatePath}`);
    }
    if (hasErrorCode(err, "EACCES") || hasErrorCode(err, "EPERM")) {
      throw new Error(
        `Permission denied reading prototype file: ${candidatePath}`,
      );
    }
    throw new Error(
      `Failed to read prototype file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!fileStat.isFile()) {
    throw new Error(`Target is not a regular HTML file: ${candidatePath}`);
  }
  if (fileStat.size > MAX_PROTOTYPE_HTML_BYTES) {
    throw new Error(
      `HTML prototype size (${formatByteSize(fileStat.size)}) exceeds the limit (${formatByteSize(MAX_PROTOTYPE_HTML_BYTES)}).`,
    );
  }

  const canonicalPath = await realpath(candidatePath).catch(() => candidatePath);
  const fileName =
    extractFileName(candidatePath) || extractFileName(canonicalPath);
  const mtimeMs = Math.floor(fileStat.mtimeMs);
  const cacheKey = `${canonicalPath}|${fileStat.size}|${mtimeMs}`;

  const hit = bundledHtmlCache.get(canonicalPath);
  if (hit && hit.cacheKey === cacheKey) {
    hit.ts = Date.now();
    return {
      canonicalPath,
      fileName,
      rawHtml: hit.rawHtml,
      bundledHtml: hit.bundledHtml,
      byteSize: hit.byteSize,
      mtimeMs: hit.mtimeMs,
      modifiedAt: hit.modifiedAt,
    };
  }

  const rawHtml = await readFile(canonicalPath, "utf8");
  const bundledHtml = await bundleLocalHtmlAssets(rawHtml, canonicalPath);
  const modifiedAt = fileStat.mtime.toISOString();

  putBundledCache(canonicalPath, {
    cacheKey,
    rawHtml,
    bundledHtml,
    byteSize: fileStat.size,
    mtimeMs,
    modifiedAt,
    ts: Date.now(),
  });

  return {
    canonicalPath,
    fileName,
    rawHtml,
    bundledHtml,
    byteSize: fileStat.size,
    mtimeMs,
    modifiedAt,
  };
}

export async function loadHtmlPrototype(params: {
  rawPath: string;
  cwd?: string | null;
  omitHtml?: boolean;
  maxInlineChars?: number;
}): Promise<LoadHtmlPrototypeOutput> {
  const {
    canonicalPath,
    fileName,
    rawHtml,
    bundledHtml,
    byteSize,
    modifiedAt,
  } = await getCachedBundledPrototype(params.rawPath, params.cwd);

  const semantics = extractSemanticTargetsFromHtml(rawHtml);

  let savedPins: AnnotationPin[] = [];
  let savedOverallNote = "";
  const sidecar = getAnnotationSidecarPaths(canonicalPath);
  try {
    const rawSaved = JSON.parse(await readFile(sidecar.jsonPath, "utf8")) as {
      pins?: unknown[];
      overallNote?: unknown;
    };
    if (Array.isArray(rawSaved.pins)) {
      savedPins = rawSaved.pins
        .map((p) => annotationPinSchema.safeParse(p))
        .filter((r): r is { success: true; data: AnnotationPin } => r.success)
        .map((r) => r.data);
    }
    if (typeof rawSaved.overallNote === "string") {
      savedOverallNote = rawSaved.overallNote;
    }
  } catch {
    // No saved draft yet
  }

  const totalHtmlChars = bundledHtml.length;
  let inlineSlice = bundledHtml;
  let htmlComplete = true;

  if (params.omitHtml) {
    inlineSlice = "";
    htmlComplete = totalHtmlChars === 0;
  } else if (
    params.maxInlineChars !== undefined &&
    totalHtmlChars > params.maxInlineChars
  ) {
    inlineSlice = bundledHtml.slice(0, params.maxInlineChars);
    htmlComplete = false;
  }

  return {
    resolvedPath: canonicalPath,
    fileName,
    title: semantics.title || fileName,
    byteSize,
    modifiedAt,
    bundledHtml: inlineSlice,
    totalHtmlChars,
    htmlComplete,
    semanticScreens: semantics.screens,
    semanticParts: semantics.parts,
    savedPins,
    savedOverallNote,
  };
}

export async function readPrototypeHtmlChunk(params: {
  resolvedPath: string;
  offset: number;
  maxChars?: number;
}): Promise<ReadPrototypeHtmlChunkOutput> {
  const { bundledHtml } = await getCachedBundledPrototype(
    params.resolvedPath,
    null,
  );
  const totalChars = bundledHtml.length;
  const safeOffset = Math.min(Math.max(0, params.offset), totalChars);
  const step = Math.max(
    4096,
    Math.min(4_000_000, params.maxChars ?? PROTOTYPE_HTML_CHUNK_CHARS),
  );
  const nextOffset = Math.min(totalChars, safeOffset + step);
  return {
    chunk: bundledHtml.slice(safeOffset, nextOffset),
    nextOffset,
    totalChars,
    eof: nextOffset >= totalChars,
  };
}

export async function submitPrototypeAnnotations(params: {
  resolvedPath: string;
  fileName: string;
  agentId?: string | null;
  pins: readonly AnnotationPin[];
  overallNote?: string;
  approvedAsIs?: boolean;
  sendToAgent: boolean;
  locale?: string | null;
  paseo: PaseoApi;
}): Promise<SubmitPrototypeAnnotationsOutput> {
  const canonicalPath = resolvePrototypePath(params.resolvedPath, null);
  const sidecar = getAnnotationSidecarPaths(canonicalPath);
  await mkdir(sidecar.dir, { recursive: true });

  const unsentPins = params.pins.filter((p) => !p.sentAt);
  const pinsForDelivery =
    params.sendToAgent && unsentPins.length > 0 ? unsentPins : params.pins;

  const deliveryMarkdown = formatAnnotationsMarkdown({
    fileName: params.fileName,
    resolvedPath: canonicalPath,
    savedMarkdownPath: sidecar.markdownPath,
    pins: pinsForDelivery,
    overallNote: params.overallNote,
    approvedAsIs: params.approvedAsIs,
    locale: params.locale,
  });

  const fullArchiveMarkdown =
    pinsForDelivery.length === params.pins.length
      ? deliveryMarkdown
      : formatAnnotationsMarkdown({
          fileName: params.fileName,
          resolvedPath: canonicalPath,
          savedMarkdownPath: sidecar.markdownPath,
          pins: params.pins,
          overallNote: params.overallNote,
          approvedAsIs: params.approvedAsIs,
          locale: params.locale,
        });

  const targetAgentId = params.agentId?.trim() || null;
  let sentToAgent = false;

  if (params.sendToAgent && targetAgentId) {
    await params.paseo.agents.ref(targetAgentId).send(deliveryMarkdown, {
      activeTurnBehavior: "steer",
    });
    sentToAgent = true;
  }

  const stampedNow = new Date().toISOString();
  const nextPins: AnnotationPin[] = sentToAgent
    ? params.pins.map((p) => (p.sentAt ? p : { ...p, sentAt: stampedNow }))
    : [...params.pins];

  const payloadJson = {
    updatedAt: stampedNow,
    prototypePath: canonicalPath,
    fileName: params.fileName,
    approvedAsIs: Boolean(params.approvedAsIs),
    overallNote: params.overallNote ?? "",
    pins: nextPins,
  };

  await writeFile(sidecar.jsonPath, `${JSON.stringify(payloadJson, null, 2)}\n`, "utf8");
  await writeFile(sidecar.markdownPath, `${fullArchiveMarkdown}\n`, "utf8");

  return {
    savedJsonPath: sidecar.jsonPath,
    savedMarkdownPath: sidecar.markdownPath,
    markdown: deliveryMarkdown,
    sentToAgent,
    targetAgentId,
    sentCount: sentToAgent ? pinsForDelivery.length : 0,
    updatedPins: nextPins,
  };
}
