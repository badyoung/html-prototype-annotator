import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import type { DomHitBox, RenderMobilePrototypeOutput } from "../shared/rpc";
import { bundleLocalHtmlAssets, resolvePrototypePath } from "./prototype-service";

const CLEAN_CHROME_CSS = `
  .topbar:has(#toggleAnnotateBtn),
  .hint-banner:has(#serverStatus),
  .sidebar:has(#pinList),
  .pin-marker {
    display: none !important;
  }
  .workspace:has(.sidebar #pinList) {
    grid-template-columns: 1fr !important;
    max-width: 1360px !important;
    padding: 12px 10px !important;
  }
`;

let customBrowserPathOverride = "";

export function setCustomBrowserExecutablePath(pathValue: string): void {
  customBrowserPathOverride = pathValue.trim();
}

export function discoverHeadlessBrowserBinary(
  explicitOverride?: string,
): string | null {
  const custom =
    explicitOverride?.trim() ||
    customBrowserPathOverride ||
    process.env.PASEO_PROTOTYPE_BROWSER_PATH?.trim() ||
    process.env.CHROME_PATH?.trim();
  if (custom && existsSync(custom)) {
    return custom;
  }

  const playwrightRoots: string[] = [];
  if (process.platform === "darwin") {
    playwrightRoots.push(join(homedir(), "Library", "Caches", "ms-playwright"));
  } else if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA?.trim() ||
      join(homedir(), "AppData", "Local");
    playwrightRoots.push(join(localAppData, "ms-playwright"));
  } else {
    playwrightRoots.push(join(homedir(), ".cache", "ms-playwright"));
  }

  for (const pwRoot of playwrightRoots) {
    if (!existsSync(pwRoot)) continue;
    try {
      const shells = readdirSync(pwRoot)
        .filter((d) => d.startsWith("chromium_headless_shell-"))
        .sort()
        .reverse();
      for (const dir of shells) {
        const subCandidates =
          process.platform === "darwin"
            ? [
                join(
                  pwRoot,
                  dir,
                  "chrome-headless-shell-mac-arm64",
                  "chrome-headless-shell",
                ),
                join(
                  pwRoot,
                  dir,
                  "chrome-headless-shell-mac-x64",
                  "chrome-headless-shell",
                ),
              ]
            : process.platform === "win32"
              ? [
                  join(
                    pwRoot,
                    dir,
                    "chrome-headless-shell-win64",
                    "chrome-headless-shell.exe",
                  ),
                ]
              : [
                  join(
                    pwRoot,
                    dir,
                    "chrome-headless-shell-linux",
                    "chrome-headless-shell",
                  ),
                ];
        for (const bin of subCandidates) {
          if (existsSync(bin)) return bin;
        }
      }
    } catch {
      // ignore unreadable cache dir
    }
  }

  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
  } else if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    for (const root of [pf, pf86, local]) {
      candidates.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(root, "Chromium", "Application", "chrome.exe"),
      );
    }
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser",
    );
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

interface CdpPendingCall {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

class ZeroPortPipeBrowser {
  private proc: ChildProcess | null = null;
  private pipeWrite: Writable | null = null;
  private tempProfileDir: string | null = null;
  private nextId = 1;
  private pending = new Map<number, CdpPendingCall>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private pageSession: {
    sessionId: string;
    frameId: string;
    loadedKey: string;
    docWidth: number;
    docHeight: number;
  } | null = null;
  private mutex: Promise<void> = Promise.resolve();

  private touchIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.dispose();
    }, 180_000);
  }

  private cleanupTempProfile(): void {
    if (!this.tempProfileDir) return;
    const dir = this.tempProfileDir;
    this.tempProfileDir = null;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore best-effort cleanup
    }
  }

  public dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.pageSession = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("Headless browser closed"));
    }
    this.pending.clear();
    if (this.proc) {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        // ignore
      }
      this.proc = null;
      this.pipeWrite = null;
    }
    this.cleanupTempProfile();
  }

  private async ensureStarted(): Promise<{ sessionId: string; frameId: string }> {
    this.touchIdleTimer();
    if (this.proc && this.pipeWrite && this.pageSession) {
      return {
        sessionId: this.pageSession.sessionId,
        frameId: this.pageSession.frameId,
      };
    }

    this.dispose();
    const binary = discoverHeadlessBrowserBinary();
    if (!binary) {
      throw new Error(
        "No local Chrome, Chromium, Edge, or Playwright headless shell was found on the daemon host to render mobile snapshots.",
      );
    }

    const profileDir = mkdtempSync(join(tmpdir(), "paseo-proto-cdp-"));
    this.tempProfileDir = profileDir;

    const needsNoSandbox =
      process.platform === "linux" &&
      typeof process.getuid === "function" &&
      process.getuid() === 0;

    const args = [
      "--headless",
      ...(needsNoSandbox ? ["--no-sandbox"] : []),
      `--user-data-dir=${profileDir}`,
      "--incognito",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--remote-debugging-pipe",
      "about:blank",
    ];

    const child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
    });

    const writeStream = child.stdio[3] as Writable;
    const readStream = child.stdio[4] as Readable;
    this.proc = child;
    this.pipeWrite = writeStream;

    let buffer = "";
    readStream.setEncoding("utf8");
    readStream.on("data", (chunk: string) => {
      buffer += chunk;
      let nulIdx: number;
      while ((nulIdx = buffer.indexOf("\0")) !== -1) {
        const raw = buffer.slice(0, nulIdx);
        buffer = buffer.slice(nulIdx + 1);
        if (!raw) continue;
        try {
          const msg = JSON.parse(raw) as {
            id?: number;
            result?: Record<string, unknown>;
            error?: { message?: string };
          };
          if (msg.id && this.pending.has(msg.id)) {
            const entry = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(msg.error.message || "CDP error"));
            } else {
              entry.resolve(msg.result ?? {});
            }
          }
        } catch {
          // ignore malformed event frame
        }
      }
    });

    child.on("exit", () => {
      this.proc = null;
      this.pipeWrite = null;
      this.pageSession = null;
      for (const [, p] of this.pending) {
        p.reject(new Error("Headless browser exited"));
      }
      this.pending.clear();
    });

    const targetsRes = await this.sendCdp("Target.getTargets", {});
    const infos = (targetsRes.targetInfos as Array<{
      targetId: string;
      type: string;
    }>) ?? [];
    let targetId = infos.find((t) => t.type === "page")?.targetId;
    if (!targetId) {
      const created = await this.sendCdp("Target.createTarget", {
        url: "about:blank",
      });
      targetId = String(created.targetId ?? "");
    }

    const attached = await this.sendCdp("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = String(attached.sessionId ?? "");
    await this.sendCdp("Page.enable", {}, sessionId);
    const treeRes = await this.sendCdp("Page.getFrameTree", {}, sessionId);
    const frameTree = treeRes.frameTree as { frame?: { id?: string } } | undefined;
    const frameId = String(frameTree?.frame?.id ?? "");

    this.pageSession = {
      sessionId,
      frameId,
      loadedKey: "",
      docWidth: 414,
      docHeight: 800,
    };
    this.touchIdleTimer();
    return { sessionId, frameId };
  }

  private sendCdp(
    method: string,
    params: Record<string, unknown>,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolvePromise, rejectPromise) => {
      if (!this.pipeWrite) {
        rejectPromise(new Error("CDP pipe not available"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectPromise(new Error(`CDP timeout on ${method}`));
        }
      }, 12_000);

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolvePromise(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
      });

      const payload = JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      });
      this.pipeWrite.write(`${payload}\0`);
    });
  }

  public runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.mutex.then(fn, fn);
    this.mutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  public async renderOrInteract(params: {
    resolvedPath: string;
    bundledHtml: string;
    modifiedAt: string;
    viewportWidth: number;
    cleanChrome: boolean;
    clickXPct?: number;
    clickYPct?: number;
    resetSession?: boolean;
  }): Promise<RenderMobilePrototypeOutput> {
    return this.runSerialized(async () => {
      const { sessionId, frameId } = await this.ensureStarted();
      const key = `${params.resolvedPath}|${params.modifiedAt}|${params.viewportWidth}|${params.cleanChrome ? "clean" : "raw"}`;

      const needsReload =
        params.resetSession ||
        !this.pageSession ||
        this.pageSession.loadedKey !== key;

      if (needsReload) {
        await this.sendCdp(
          "Emulation.setDeviceMetricsOverride",
          {
            width: params.viewportWidth,
            height: 480,
            deviceScaleFactor: 2,
            mobile: params.viewportWidth <= 540,
          },
          sessionId,
        );

        const htmlToLoad = params.cleanChrome
          ? params.bundledHtml.replace(
              /<\/head>/i,
              `<style>${CLEAN_CHROME_CSS}</style></head>`,
            )
          : params.bundledHtml;

        await this.sendCdp(
          "Page.setDocumentContent",
          { frameId, html: htmlToLoad },
          sessionId,
        );
        await new Promise((r) => setTimeout(r, 90));
        if (this.pageSession) {
          this.pageSession.loadedKey = key;
        }
      }

      // Measure initial document dimensions before optional click
      const preEval = await this.sendCdp(
        "Runtime.evaluate",
        {
          expression: `(() => ({
            w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth, 1),
            h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 480)
          }))()`,
          returnByValue: true,
        },
        sessionId,
      );
      const preSize = ((preEval.result as { value?: { w: number; h: number } })
        ?.value) ?? { w: params.viewportWidth, h: 900 };

      if (
        params.clickXPct !== undefined &&
        params.clickYPct !== undefined &&
        this.pageSession
      ) {
        const prevW = this.pageSession.docWidth || preSize.w;
        const prevH = this.pageSession.docHeight || Math.min(preSize.h, 7600);
        const x = Math.max(1, Math.round((params.clickXPct / 100) * prevW));
        const y = Math.max(1, Math.round((params.clickYPct / 100) * prevH));
        await this.sendCdp(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x, y, button: "none" },
          sessionId,
        );
        await this.sendCdp(
          "Input.dispatchMouseEvent",
          {
            type: "mousePressed",
            x,
            y,
            button: "left",
            buttons: 1,
            clickCount: 1,
          },
          sessionId,
        );
        await this.sendCdp(
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            buttons: 0,
            clickCount: 1,
          },
          sessionId,
        );
        await new Promise((r) => setTimeout(r, 90));
      }

      // Re-measure full height & set exact viewport so full-page layout + hitBoxes match 1:1
      const measureRes = await this.sendCdp(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const docW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth, 1);
            const docH = Math.min(7600, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 520));
            return { docW, docH };
          })()`,
          returnByValue: true,
        },
        sessionId,
      );
      const { docW, docH } = ((
        measureRes.result as { value?: { docW: number; docH: number } }
      )?.value) ?? { docW: params.viewportWidth, docH: 900 };

      const safeDpr = Math.min(2, Math.max(1, Math.floor((7200 / docH) * 10) / 10));
      await this.sendCdp(
        "Emulation.setDeviceMetricsOverride",
        {
          width: params.viewportWidth,
          height: docH,
          deviceScaleFactor: safeDpr,
          mobile: params.viewportWidth <= 540,
        },
        sessionId,
      );
      await new Promise((r) => setTimeout(r, 35));

      // Extract exact DOM HitBoxes in full-document percentage coordinates
      const hitRes = await this.sendCdp(
        "Runtime.evaluate",
        {
          expression: `(() => {
            const docW = ${docW};
            const docH = ${docH};
            const clean = (s, n = 60) => {
              const t = String(s || "").replace(/\\s+/g, " ").trim();
              return t.length > n ? t.slice(0, n) + "…" : t;
            };
            const shortSel = (el) => {
              const tag = el.tagName.toLowerCase();
              if (el.id) return tag + "#" + el.id;
              const cls = typeof el.className === "string"
                ? el.className.split(/\\s+/).filter(Boolean).slice(0, 2)
                : [];
              return cls.length ? tag + "." + cls.join(".") : tag;
            };
            const nodes = document.querySelectorAll("[data-part], button, a, input, select, textarea, [role='button']");
            const boxes = [];
            for (const el of nodes) {
              const st = window.getComputedStyle(el);
              if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) continue;
              const r = el.getBoundingClientRect();
              if (r.width < 8 || r.height < 8) continue;
              const pageLeft = r.left + window.scrollX;
              const pageTop = r.top + window.scrollY;
              if (pageTop > docH || pageTop + r.height < 0) continue;

              const ds = el.closest("[data-screen]");
              const screenName = ds ? (clean(ds.getAttribute("data-screen"), 70) || "画板") : (clean(document.title, 50) || "主画板");
              let sx = (pageLeft + r.width / 2) / docW * 100;
              let sy = (pageTop + r.height / 2) / docH * 100;
              if (ds) {
                const sr = ds.getBoundingClientRect();
                if (sr.width > 0 && sr.height > 0) {
                  sx = ((r.left + r.width / 2 - sr.left) / sr.width) * 100;
                  sy = ((r.top + r.height / 2 - sr.top) / sr.height) * 100;
                }
              }

              const partAttr = el.getAttribute("data-part");
              const label = clean(partAttr || el.getAttribute("aria-label") || el.innerText || el.textContent || "", 56) || shortSel(el);
              boxes.push({
                screen: screenName,
                part: label,
                selector: shortSel(el),
                xPct: Math.round((pageLeft / docW) * 1000) / 10,
                yPct: Math.round((pageTop / docH) * 1000) / 10,
                wPct: Math.round((r.width / docW) * 1000) / 10,
                hPct: Math.round((r.height / docH) * 1000) / 10,
                screenXPct: Math.max(0, Math.min(100, Math.round(sx * 10) / 10)),
                screenYPct: Math.max(0, Math.min(100, Math.round(sy * 10) / 10)),
                area: Math.round(r.width * r.height)
              });
              if (boxes.length >= 180) break;
            }
            return boxes;
          })()`,
          returnByValue: true,
        },
        sessionId,
      );

      const hitBoxes = (((hitRes.result as { value?: DomHitBox[] })?.value) ??
        []) as DomHitBox[];

      const shotRes = await this.sendCdp(
        "Page.captureScreenshot",
        {
          format: "jpeg",
          quality: 88,
          clip: { x: 0, y: 0, width: docW, height: docH, scale: 1 },
          captureBeyondViewport: true,
        },
        sessionId,
      );
      const b64 = String(shotRes.data ?? "");

      if (this.pageSession) {
        this.pageSession.docWidth = docW;
        this.pageSession.docHeight = docH;
      }
      this.touchIdleTimer();

      return {
        imageDataUri: `data:image/jpeg;base64,${b64}`,
        docWidth: docW,
        docHeight: docH,
        hitBoxes,
      };
    });
  }
}

const singletonRenderer = new ZeroPortPipeBrowser();

export function disposeMobileRenderer(): void {
  singletonRenderer.dispose();
}

export async function renderMobilePrototypeSnapshot(params: {
  resolvedPath: string;
  viewportWidth: number;
  cleanChrome: boolean;
  clickXPct?: number;
  clickYPct?: number;
  resetSession?: boolean;
}): Promise<RenderMobilePrototypeOutput> {
  const canonicalPath = resolvePrototypePath(params.resolvedPath, null);
  const mtimeMs = Math.floor(statSync(canonicalPath).mtimeMs);
  const rawHtml = await readFile(canonicalPath, "utf8");
  const bundledHtml = await bundleLocalHtmlAssets(rawHtml, canonicalPath);
  return singletonRenderer.renderOrInteract({
    resolvedPath: canonicalPath,
    bundledHtml,
    modifiedAt: `${rawHtml.length}-${mtimeMs}`,
    viewportWidth: params.viewportWidth,
    cleanChrome: params.cleanChrome,
    clickXPct: params.clickXPct,
    clickYPct: params.clickYPct,
    resetSession: params.resetSession,
  });
}
