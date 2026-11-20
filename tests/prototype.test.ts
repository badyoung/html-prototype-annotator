import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

type PaseoApi = PluginHandlerContext["paseo"];
import {
  extractHtmlPrototypeTargets,
  extractSemanticTargetsFromHtml,
  formatAnnotationsMarkdown,
  parsePrototypeFeedbackMessage,
} from "../shared/annotations";
import {
  getHtmlPrototypeBridge,
  registerHtmlPrototypeBridge,
} from "../shared/bridge";
import { instrumentHtmlForWebAnnotator } from "../shared/html-instrumenter";
import {
  applyPrototypeCreatePrompt,
  applyPrototypeOpenPrompt,
} from "../server/prompt-injection";
import {
  loadHtmlPrototype,
  readPrototypeHtmlChunk,
  submitPrototypeAnnotations,
} from "../server/prototype-service";
import {
  assembleFullPrototypeHtml,
  PROTOTYPE_HTML_CHUNK_CHARS,
} from "../shared/rpc";
import {
  discoverHeadlessBrowserBinary,
  disposeMobileRenderer,
  renderMobilePrototypeSnapshot,
} from "../server/mobile-renderer";
import {
  getBundledSkillsStatus,
  manageBundledSkills,
} from "../server/skill-manager";

test("extracts .html and .htm links from markdown while ignoring code blocks and non-html files", () => {
  const md = [
    "Prototype ready: [checkout-v2.html](file:///workspace/app/.artifacts/prototypes/checkout-v2.html)",
    "Reference image: [preview.png](file:///workspace/app/.artifacts/prototypes/preview.png)",
    "Fallback page: `/tmp/mobile-flow.htm`",
    "```html",
    "<a href=\"file:///tmp/ignored.html\">ignored</a>",
    "```",
    "External URL [live page](https://example.com/index.html) is ignored.",
  ].join("\n");

  const targets = extractHtmlPrototypeTargets(md);
  assert.equal(targets.length, 2);
  assert.equal(
    targets[0].cleanPath,
    "/workspace/app/.artifacts/prototypes/checkout-v2.html",
  );
  assert.equal(targets[0].fileName, "checkout-v2.html");
  assert.equal(targets[1].cleanPath, "/tmp/mobile-flow.htm");
});

test("bundles local relative CSS & images, extracts data-screen/data-part, instruments HTML, and submits structured Markdown to agent", async () => {
  const root = mkdtempSync(join(tmpdir(), "html-proto-test-"));
  try {
    const assetsDir = join(root, "assets");
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(assetsDir, "theme.css"), ".hero { color: #0e8a5f; }", "utf8");
    // 1x1 transparent PNG
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    writeFileSync(join(assetsDir, "dot.png"), tinyPng);

    const htmlPath = join(root, "lobby-proto.html");
    writeFileSync(
      htmlPath,
      [
        "<!doctype html><html><head><title>大厅改版原型</title>",
        "<link rel=\"stylesheet\" href=\"./assets/theme.css\" />",
        "</head><body>",
        "<div data-screen=\"首页语音台\">",
        "  <button data-part=\"主录音按钮\">开始说话</button>",
        "  <img src=\"./assets/dot.png\" alt=\"dot\" />",
        "</div>",
        "</body></html>",
      ].join("\n"),
      "utf8",
    );

    const loaded = await loadHtmlPrototype({ rawPath: `file://${htmlPath}` });
    assert.equal(loaded.title, "大厅改版原型");
    assert.deepEqual(loaded.semanticScreens, ["首页语音台"]);
    assert.equal(loaded.semanticParts.includes("主录音按钮"), true);
    assert.match(loaded.bundledHtml, /<style data-inlined-href="\.\/assets\/theme\.css">/);
    assert.match(loaded.bundledHtml, /src="data:image\/png;base64,/);

    const instrumented = instrumentHtmlForWebAnnotator(loaded.bundledHtml, "tok-xyz");
    assert.match(instrumented, /__paseo_proto_annotator_boot__/);
    assert.match(instrumented, /"tok-xyz"/);
    assert.match(instrumented, /mode:\s*"interact"/);
    assert.match(
      instrumented,
      /html\.__paseo-mode-interact \.__paseo-pin-badge[\s\S]*pointer-events:\s*none\s*!important/,
    );

    const sentMessages: Array<{ agentId: string; text: string }> = [];
    const fakePaseo = {
      agents: {
        ref(agentId: string) {
          return {
            async send(text: string) {
              sentMessages.push({ agentId, text });
              return {};
            },
          };
        },
      },
    } as unknown as PaseoApi;

    const submitted = await submitPrototypeAnnotations({
      resolvedPath: loaded.resolvedPath,
      fileName: loaded.fileName,
      agentId: "agent-demo-1",
      pins: [
        {
          id: "p1",
          kind: "pin",
          screen: "首页语音台",
          part: "主录音按钮",
          selector: "button",
          xPct: 48.5,
          yPct: 82.2,
          note: "改成翡翠绿胶囊并拉宽到 100%",
        },
        {
          id: "p2",
          kind: "box",
          screen: "首页语音台",
          part: "底部导航区",
          xPct: 10,
          yPct: 88,
          wPct: 80,
          hPct: 10,
          note: "去掉多余副标题",
        },
      ],
      overallNote: "暗色模式后续单独对。",
      sendToAgent: true,
      locale: "zh-CN",
      paseo: fakePaseo,
    });

    assert.equal(submitted.sentToAgent, true);
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].agentId, "agent-demo-1");
    assert.match(submitted.markdown, /#1 \[首页语音台\] 主录音按钮/);
    assert.match(submitted.markdown, /框选 `10.0%, 88.0%` · 尺寸 `80.0% × 10.0%`/);
    assert.equal(existsSync(submitted.savedJsonPath), true);
    assert.equal(existsSync(submitted.savedMarkdownPath), true);

    // Reloading prototype restores saved pins & overallNote
    const reloaded = await loadHtmlPrototype({ rawPath: htmlPath });
    assert.equal(reloaded.savedPins.length, 2);
    assert.equal(reloaded.savedOverallNote, "暗色模式后续单独对。");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinked CSS/images pointing outside the prototype parent directory", async () => {
  const outerSecretDir = mkdtempSync(join(tmpdir(), "html-proto-secret-"));
  const workspaceRoot = mkdtempSync(join(tmpdir(), "html-proto-ws-"));
  try {
    const secretCss = join(outerSecretDir, "secret.css");
    writeFileSync(secretCss, "body { content: 'TOP_SECRET_TOKEN'; }", "utf8");

    const protoDir = join(workspaceRoot, "nested", "proto");
    mkdirSync(protoDir, { recursive: true });
    symlinkSync(secretCss, join(protoDir, "leak.css"));

    const htmlPath = join(protoDir, "index.html");
    writeFileSync(
      htmlPath,
      "<!doctype html><html><head><link rel=\"stylesheet\" href=\"./leak.css\"></head><body>Hello</body></html>",
      "utf8",
    );

    const loaded = await loadHtmlPrototype({ rawPath: htmlPath });
    assert.equal(
      loaded.bundledHtml.includes("TOP_SECRET_TOKEN"),
      false,
      "symlink outside parent ceiling must never be inlined",
    );
  } finally {
    rmSync(outerSecretDir, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("extracts multi-screen and fallback button/heading semantics cleanly", () => {
  const html = [
    "<!doctype html><html><head><title>Billing Flow</title></head><body>",
    "<section data-screen=\"Plan Picker\"><button data-part=\"Upgrade CTA\">Start Pro</button></section>",
    "<section data-screen=\"Checkout Modal\"><h2>Payment Details</h2><button>Confirm Order</button></section>",
    "</body></html>",
  ].join("\n");
  const sem = extractSemanticTargetsFromHtml(html);
  assert.deepEqual(sem.screens, ["Plan Picker", "Checkout Modal"]);
  assert.equal(sem.parts.includes("Upgrade CTA"), true);
  assert.equal(sem.parts.includes("Confirm Order"), true);
});

test("registers cross-plugin bridge and injects prompt only into top-level controllers", () => {
  assert.equal(getHtmlPrototypeBridge(), null);
  let lastReq: unknown = null;
  const unregister = registerHtmlPrototypeBridge({
    open(req) {
      lastReq = req;
    },
  });
  getHtmlPrototypeBridge()?.open({ path: "/tmp/a.html", agentId: "ag-1" });
  assert.deepEqual(lastReq, { path: "/tmp/a.html", agentId: "ag-1" });
  unregister();
  assert.equal(getHtmlPrototypeBridge(), null);

  const subOpen = applyPrototypeOpenPrompt(
    { labels: { "paseo.parent-agent-id": "parent-1" }, env: {} as Record<string, string> },
    "/tmp/proto-prompt.txt",
  );
  assert.equal(subOpen.env.PASEO_APPEND_PROMPT_FILES, undefined);

  const topOpen = applyPrototypeOpenPrompt(
    { labels: {}, env: { PASEO_APPEND_PROMPT_FILES: "/tmp/a.txt" } },
    "/tmp/proto-prompt.txt",
  );
  assert.equal(topOpen.env.PASEO_APPEND_PROMPT_FILES, "/tmp/a.txt:/tmp/proto-prompt.txt");

  const subCreate = applyPrototypeCreatePrompt({
    config: { title: "[feat] worker", systemPrompt: "base" },
    env: { HPA_IS_TOP_LEVEL: "0" },
  });
  assert.equal(subCreate.config.systemPrompt, "base");

  const approvedEn = formatAnnotationsMarkdown({
    fileName: "demo.html",
    resolvedPath: "/tmp/demo.html",
    pins: [],
    approvedAsIs: true,
  });
  assert.match(approvedEn, /HTML Prototype Approved/);

  const approvedZh = formatAnnotationsMarkdown({
    fileName: "demo.html",
    resolvedPath: "/tmp/demo.html",
    pins: [],
    approvedAsIs: true,
    locale: "zh-CN",
  });
  assert.match(approvedZh, /HTML 原型确认通过/);
});

test("renders mobile Retina snapshot + exact DOM hitBoxes over zero-port CDP pipe and dispatches interactive clicks", async (t) => {
  if (!discoverHeadlessBrowserBinary()) {
    t.skip("No local headless browser installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "html-proto-mobile-"));
  try {
    const htmlPath = join(root, "mobile-tap.html");
    writeFileSync(
      htmlPath,
      [
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        "<style>body{margin:0;padding:20px;font-family:sans-serif;} #btn{width:200px;height:60px;background:#0e8a5f;color:#fff;} #sheet{display:none;height:120px;background:#ffe;} #sheet.open{display:block;}</style>",
        "</head><body>",
        "<div data-screen=\"移动端测试页\">",
        "  <button id=\"btn\" data-part=\"主操作按钮\" onclick=\"document.getElementById('sheet').classList.add('open')\"><svg width=\"24\" height=\"24\"><path d=\"M0 0h24v24H0z\"/></svg><span>打开底部面板</span></button>",
        "  <div id=\"sheet\" data-part=\"弹出的底部面板\">面板已展开</div>",
        "</div>",
        "</body></html>",
      ].join("\n"),
      "utf8",
    );

    const snap1 = await renderMobilePrototypeSnapshot({
      resolvedPath: htmlPath,
      viewportWidth: 414,
      cleanChrome: true,
      resetSession: true,
    });
    assert.match(snap1.imageDataUri, /^data:image\/jpeg;base64,/);
    assert.ok(snap1.imageDataUri.length > 1000);
    const btnHit = snap1.hitBoxes.find((b) => b.part === "主操作按钮");
    assert.ok(btnHit, "should extract data-part hitBox for button");
    assert.equal(
      snap1.hitBoxes.some((b) => b.part === "弹出的底部面板"),
      false,
    );

    // Simulate user tapping the button in 'interact' mode on iOS!
    const clickX = btnHit.xPct + btnHit.wPct / 2;
    const clickY = btnHit.yPct + btnHit.hPct / 2;
    const snap2 = await renderMobilePrototypeSnapshot({
      resolvedPath: htmlPath,
      viewportWidth: 414,
      cleanChrome: true,
      clickXPct: clickX,
      clickYPct: clickY,
    });
    assert.equal(
      snap2.hitBoxes.some((b) => b.part === "弹出的底部面板"),
      true,
      "clicking button in interact mode must open hidden sheet and update hitBoxes",
    );
  } finally {
    disposeMobileRenderer();
    rmSync(root, { recursive: true, force: true });
  }
});

test("switches sandboxed iframe from interact to pin mode via contentWindow.postMessage and pins elements despite pointerup innerHTML re-renders", async (t) => {
  if (!discoverHeadlessBrowserBinary()) {
    t.skip("No local headless browser installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "html-proto-iframe-"));
  try {
    const innerProto = instrumentHtmlForWebAnnotator(
      [
        "<!doctype html><html><head><meta charset=\"utf-8\">",
        "<style>body{margin:0;padding:10px;} .phone{width:360px;height:420px;overflow:hidden;position:relative;background:#111;color:#fff;}</style>",
        "</head><body>",
        "<div id=\"phone\" class=\"phone\" data-screen=\"语音台·深色·idle\">",
        "  <button id=\"pad\" data-part=\"主语音按住区\" style=\"width:240px;height:90px;margin:20px;\">按住说话</button>",
        "</div>",
        "<script>",
        "const phone = document.getElementById('phone');",
        "phone.addEventListener('pointerup', () => {",
        "  phone.dataset.screen = '语音台·浅色·free';",
        "  phone.innerHTML = '<button id=\"pad\" data-part=\"主语音按住区\" style=\"width:240px;height:90px;margin:20px;\">重绘后按住区</button>';",
        "});",
        "</script>",
        "</body></html>",
      ].join("\n"),
      "tok-iframe-e2e",
    );

    const escapedSrcDoc = innerProto
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");

    const hostPath = join(root, "host-shell.html");
    writeFileSync(
      hostPath,
      [
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
        "<style>body{margin:0;font-family:sans-serif;} #bar{height:50px;display:flex;gap:10px;align-items:center;padding:0 10px;} iframe{width:400px;height:460px;border:0;display:block;}</style>",
        "</head><body>",
        "<div data-screen=\"宿主外壳\">",
        "  <div id=\"bar\">",
        "    <button id=\"switchPin\" data-part=\"切换点按标注\">点按标注</button>",
        "    <div id=\"pinReceipt\" data-part=\"未收到图钉\">pins:0</div>",
        "  </div>",
        `  <iframe id="frame" sandbox="allow-scripts" srcdoc="${escapedSrcDoc}"></iframe>`,
        "</div>",
        "<script>",
        "const pins = [];",
        "const frame = document.getElementById('frame');",
        "const receipt = document.getElementById('pinReceipt');",
        "let mode = 'interact';",
        "function sync() {",
        "  const contentWin = frame.contentWindow;",
        "  if (contentWin && typeof contentWin.postMessage === 'function') {",
        "    contentWin.postMessage({ source: 'paseo-proto-host', token: 'tok-iframe-e2e', type: 'sync-state', mode, cleanChrome: true, pins, activePinId: pins[pins.length - 1]?.id || null }, '*');",
        "  }",
        "}",
        "document.getElementById('switchPin').addEventListener('click', () => { mode = 'pin'; sync(); });",
        "frame.addEventListener('load', sync);",
        "window.addEventListener('message', (ev) => {",
        "  const d = ev.data;",
        "  if (!d || d.source !== 'paseo-proto-frame' || d.token !== 'tok-iframe-e2e') return;",
        "  if (d.type === 'ready') sync();",
        "  if (d.type === 'add-pin') {",
        "    pins.push(Object.assign({ id: 'pin-1', note: '' }, d.draft));",
        "    receipt.setAttribute('data-part', '收到图钉:' + d.draft.part);",
        "    receipt.textContent = 'pins:' + pins.length;",
        "    sync();",
        "  }",
        "});",
        "</script>",
        "</body></html>",
      ].join("\n"),
      "utf8",
    );

    const s1 = await renderMobilePrototypeSnapshot({
      resolvedPath: hostPath,
      viewportWidth: 414,
      cleanChrome: false,
      resetSession: true,
    });
    const switchBtn = s1.hitBoxes.find((b) => b.part === "切换点按标注");
    assert.ok(switchBtn, "host switch button should exist");
    await new Promise((r) => setTimeout(r, 120));

    // 1. Click '切换点按标注' in host bar -> calls contentWin.postMessage({ mode: 'pin' })
    await renderMobilePrototypeSnapshot({
      resolvedPath: hostPath,
      viewportWidth: 414,
      cleanChrome: false,
      clickXPct: switchBtn.xPct + switchBtn.wPct / 2,
      clickYPct: switchBtn.yPct + switchBtn.hPct / 2,
    });
    await new Promise((r) => setTimeout(r, 120));

    // 2. Click inside the sandboxed iframe over #pad (around x=120px/414=29%, y=115px/510=22.5%)
    const s3 = await renderMobilePrototypeSnapshot({
      resolvedPath: hostPath,
      viewportWidth: 414,
      cleanChrome: false,
      clickXPct: 29,
      clickYPct: 22.5,
    });

    assert.equal(
      s3.hitBoxes.some((b) => b.part === "收到图钉:主语音按住区"),
      true,
      "switching to pin mode and clicking inside sandboxed iframe must emit add-pin with exact data-part without getting swallowed by pointerup innerHTML re-render",
    );
  } finally {
    disposeMobileRenderer();
    rmSync(root, { recursive: true, force: true });
  }
});

test("installs and removes bundled frontend design skills while preserving pre-existing external skills", async () => {
  const root = mkdtempSync(join(tmpdir(), "html-proto-skills-"));
  try {
    const agentsSkills = join(root, ".agents", "skills");
    const claudeSkills = join(root, ".claude", "skills");
    const targetRoots = [agentsSkills, claudeSkills];

    // Pre-create an externally installed frontend-design skill in ~/.claude/skills
    mkdirSync(join(claudeSkills, "frontend-design"), { recursive: true });
    writeFileSync(
      join(claudeSkills, "frontend-design", "SKILL.md"),
      "external custom skill",
      "utf8",
    );

    const initial = await getBundledSkillsStatus({ targetRoots });
    assert.equal(initial.skills.length, 5);
    assert.equal(
      initial.skills.find((s) => s.id === "frontend-design")?.state,
      "external",
    );
    assert.equal(
      initial.skills.find((s) => s.id === "html-prototype-craft")?.state,
      "missing",
    );

    const afterInstall = await manageBundledSkills({
      action: "install",
      targetRoots,
    });
    assert.equal(
      afterInstall.skills.every((s) => s.state === "plugin-managed"),
      true,
    );
    // External folder in claudeSkills must NOT have been overwritten!
    assert.equal(
      existsSync(
        join(
          claudeSkills,
          "frontend-design",
          ".paseo-prototype-annotator-skill.json",
        ),
      ),
      false,
    );
    // Missing folder in agentsSkills WAS installed by plugin
    assert.equal(
      existsSync(join(agentsSkills, "html-prototype-craft", "SKILL.md")),
      true,
    );

    const afterRemove = await manageBundledSkills({
      action: "remove",
      targetRoots,
    });
    // External skill remains intact; plugin-managed ones are cleanly removed!
    assert.equal(
      afterRemove.skills.find((s) => s.id === "frontend-design")?.state,
      "external",
    );
    assert.equal(
      afterRemove.skills.find((s) => s.id === "html-prototype-craft")?.state,
      "missing",
    );
    assert.equal(
      existsSync(join(claudeSkills, "frontend-design", "SKILL.md")),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renders 100vh mobile app shell at full stage height, filters hidden data-screens, and scrolls inner overflow containers", async (t) => {
  if (!discoverHeadlessBrowserBinary()) {
    t.skip("No local headless browser installed");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "html-proto-100vh-"));
  try {
    const htmlPath = join(root, "app-shell.html");
    writeFileSync(
      htmlPath,
      [
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>短剧原型 v15</title>",
        "<style>",
        "body{margin:0;overflow:hidden;font-family:sans-serif;}",
        ".shell{width:100vw;height:100vh;display:flex;flex-direction:column;}",
        ".hidden{display:none!important;}",
        "#feed{flex:1;overflow-y:auto;}",
        ".hero{height:460px;background:#223;}",
        ".grid-card{height:380px;background:#345;color:#fff;}",
        ".tabbar{height:58px;background:#111;color:#fff;}",
        "</style></head><body>",
        "<div class=\"shell\">",
        "  <div class=\"hidden\" data-screen=\"竖屏播放页\"><button data-part=\"播放页按钮\">播放</button></div>",
        "  <div id=\"feed\" data-screen=\"App首页 · 双列推荐\">",
        "    <div class=\"hero\" data-part=\"首焦大图\">Banner</div>",
        "    <div class=\"grid-card\" data-part=\"首屏剧集卡\">Card 1</div>",
        "    <div class=\"grid-card\" data-part=\"折叠区剧集卡\">Card 2</div>",
        "  </div>",
        "  <div class=\"tabbar\" data-part=\"底部导航栏\">Tabs</div>",
        "</div>",
        "</body></html>",
      ].join("\n"),
      "utf8",
    );

    const initial = await renderMobilePrototypeSnapshot({
      resolvedPath: htmlPath,
      viewportWidth: 393,
      viewportHeight: 760,
      cleanChrome: true,
      resetSession: true,
    });

    assert.equal(initial.docWidth, 393);
    assert.equal(initial.docHeight, 760);
    assert.deepEqual(initial.activeScreens, ["App首页 · 双列推荐"]);
    assert.equal(initial.pageTitle, "短剧原型 v15");
    assert.equal(
      initial.hitBoxes.some((b) => b.part === "首屏剧集卡"),
      true,
      "760px mobile stage must expose first-row grid card below 460px hero without crushing",
    );

    const beforeCard2 = initial.hitBoxes.find((b) => b.part === "折叠区剧集卡");
    const scrolled = await renderMobilePrototypeSnapshot({
      resolvedPath: htmlPath,
      viewportWidth: 393,
      viewportHeight: 760,
      cleanChrome: true,
      scrollDeltaY: 320,
      scrollXPct: 50,
      scrollYPct: 50,
    });
    const afterCard2 = scrolled.hitBoxes.find((b) => b.part === "折叠区剧集卡");
    assert.ok(afterCard2, "second-row card should be visible in hitBoxes after inner scroll");
    if (beforeCard2) {
      assert.ok(
        afterCard2.yPct < beforeCard2.yPct - 15,
        "inner #feed scrollTop must shift card upward",
      );
    }
  } finally {
    disposeMobileRenderer();
    rmSync(root, { recursive: true, force: true });
  }
});

test("formats structured <prototype-feedback> with DOM path, parses both new and legacy user_messages, and sends only unsent pins on follow-up rounds", async () => {
  assert.equal(parsePrototypeFeedbackMessage("普通聊天消息，不要误伤"), null);

  const structuredMd = formatAnnotationsMarkdown({
    fileName: "player-v15.html",
    resolvedPath: "/workspace/.artifacts/prototypes/player-v15.html",
    pins: [
      {
        id: "p1",
        kind: "box",
        screen: "App首页 · 3:4标准海报框",
        part: "海报卡：闪婚后傅总",
        selector: "article.drama-card",
        domPath: "main#appRoot > div#homeVideoGrid > article.drama-card:nth-of-type(2)",
        textSnippet: "3:4 无裁切 312.8w 全 92 集",
        xPct: 49.5,
        yPct: 56.2,
        wPct: 48.2,
        hPct: 28.2,
        note: "列表封面也要支持 WebP 动图",
      },
    ],
    overallNote: "底部跑马灯单条不滚动。",
    locale: "zh-CN",
  });

  assert.match(structuredMd, /<prototype-feedback version="1" status="changes_requested"/);
  assert.match(structuredMd, /DOM 路径：`main#appRoot > div#homeVideoGrid > article\.drama-card:nth-of-type\(2\)`/);
  assert.match(structuredMd, /元素文本：「3:4 无裁切 312\.8w 全 92 集」/);

  const parsedNew = parsePrototypeFeedbackMessage(structuredMd);
  assert.ok(parsedNew);
  assert.equal(parsedNew.status, "changes_requested");
  assert.equal(parsedNew.fileName, "player-v15.html");
  assert.equal(parsedNew.prototypePath, "/workspace/.artifacts/prototypes/player-v15.html");
  assert.equal(parsedNew.items.length, 1);
  assert.equal(parsedNew.items[0].screen, "App首页 · 3:4标准海报框");
  assert.equal(parsedNew.items[0].part, "海报卡：闪婚后傅总");
  assert.equal(parsedNew.items[0].selector, "article.drama-card");
  assert.equal(
    parsedNew.items[0].domPath,
    "main#appRoot > div#homeVideoGrid > article.drama-card:nth-of-type(2)",
  );
  assert.equal(parsedNew.items[0].note, "列表封面也要支持 WebP 动图");
  assert.equal(parsedNew.overallNote, "底部跑马灯单条不滚动。");

  // Legacy plain-markdown feedback already in chat timelines must also parse cleanly
  const legacyRaw = [
    "### 📌 HTML 原型视觉批注反馈：`qingning-direct-player-v15.html`",
    "- 原型文件：`/Users/danz/work/huangguo/.artifacts/prototypes/qingning-direct-player-v15.html`",
    "- 标注数量：共 **2** 处",
    "",
    "1. **#1 [竖屏播放页] 全屏视频手势画布**（点按 `60.8%, 37.9%` · `div#videoStage`）",
    "   > 如果上滑到下一集，那短剧频道上下切剧怎么办",
    "2. **#2 底部导航区**（框选 `10.0%, 88.0%` · 尺寸 `80.0% × 10.0%`）",
    "   > 去掉多余副标题",
  ].join("\n");

  const parsedLegacy = parsePrototypeFeedbackMessage(legacyRaw);
  assert.ok(parsedLegacy);
  assert.equal(parsedLegacy.fileName, "qingning-direct-player-v15.html");
  assert.equal(parsedLegacy.items.length, 2);
  assert.equal(parsedLegacy.items[0].screen, "竖屏播放页");
  assert.equal(parsedLegacy.items[0].selector, "div#videoStage");
  assert.equal(parsedLegacy.items[1].selector, undefined);
  assert.equal(parsedLegacy.items[1].kind, "box");

  // Paseo's client transformTimelineItem rejects any object property whose value is `undefined`
  const isStrictPaseoJsonCompatible = (val: unknown): boolean => {
    if (val === null || typeof val === "string" || typeof val === "boolean") return true;
    if (typeof val === "number") return Number.isFinite(val);
    if (typeof val !== "object") return false;
    return (Array.isArray(val) ? val : Object.values(val)).every(isStrictPaseoJsonCompatible);
  };
  assert.equal(isStrictPaseoJsonCompatible({ feedback: parsedNew }), true);
  assert.equal(isStrictPaseoJsonCompatible({ feedback: parsedLegacy }), true);

  // Incremental delivery test: round 2 only sends newly added/edited unsent pins
  const root = mkdtempSync(join(tmpdir(), "html-proto-inc-"));
  try {
    const htmlPath = join(root, "iter.html");
    writeFileSync(htmlPath, "<!doctype html><html><body><button>OK</button></body></html>", "utf8");
    const sentPayloads: string[] = [];
    const fakePaseo = {
      agents: {
        ref() {
          return {
            async send(text: string) {
              sentPayloads.push(text);
              return {};
            },
          };
        },
      },
    } as unknown as PaseoApi;

    const round1 = await submitPrototypeAnnotations({
      resolvedPath: htmlPath,
      fileName: "iter.html",
      agentId: "agent-1",
      pins: [
        { id: "a", kind: "pin", screen: "首页", part: "按钮A", xPct: 20, yPct: 30, note: "第一轮意见" },
      ],
      sendToAgent: true,
      locale: "zh-CN",
      paseo: fakePaseo,
    });
    assert.equal(round1.sentCount, 1);
    assert.ok(round1.updatedPins?.[0]?.sentAt);

    const round2 = await submitPrototypeAnnotations({
      resolvedPath: htmlPath,
      fileName: "iter.html",
      agentId: "agent-1",
      pins: [
        ...(round1.updatedPins ?? []),
        { id: "b", kind: "pin", screen: "首页", part: "按钮B", xPct: 60, yPct: 50, note: "第二轮新增意见" },
      ],
      sendToAgent: true,
      locale: "zh-CN",
      paseo: fakePaseo,
    });
    assert.equal(round2.sentCount, 1);
    assert.equal(sentPayloads.length, 2);
    assert.equal(sentPayloads[1].includes("第一轮意见"), false);
    assert.equal(sentPayloads[1].includes("第二轮新增意见"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("streams 9.5 MB Base64-heavy HTML prototypes in Relay-safe chunks and skips HTML transfer on mobile omitHtml", async () => {
  const root = mkdtempSync(join(tmpdir(), "html-proto-9mb-"));
  try {
    const htmlPath = join(root, "animated-webp-9mb.html");
    const fakeBase64Payload = "A".repeat(9_600_000);
    const bigHtml = [
      "<!doctype html><html><head><title>9.5MB 动态WebP海报原型</title></head><body>",
      "<div data-screen=\"App首页\">",
      `  <img data-part="动态海报卡" src="data:image/webp;base64,${fakeBase64Payload}" />`,
      "</div>",
      "</body></html>",
    ].join("\n");
    writeFileSync(htmlPath, bigHtml, "utf8");

    // 1. Mobile metadata-only load transfers 0 chars of bundledHtml
    const mobileMeta = await loadHtmlPrototype({
      rawPath: htmlPath,
      omitHtml: true,
    });
    assert.equal(mobileMeta.bundledHtml, "");
    assert.equal(mobileMeta.htmlComplete, false);
    assert.equal(mobileMeta.totalHtmlChars, bigHtml.length);
    assert.deepEqual(mobileMeta.semanticScreens, ["App首页"]);

    // 2. Web chunked load keeps every RPC slice <= 1.5M chars and reassembles 100% identically
    const webInitial = await loadHtmlPrototype({
      rawPath: htmlPath,
      maxInlineChars: PROTOTYPE_HTML_CHUNK_CHARS,
    });
    assert.equal(webInitial.bundledHtml.length, PROTOTYPE_HTML_CHUNK_CHARS);
    assert.equal(webInitial.htmlComplete, false);

    let chunkCalls = 0;
    const reassembled = await assembleFullPrototypeHtml(
      webInitial,
      async (req) => {
        chunkCalls += 1;
        const slice = await readPrototypeHtmlChunk(req);
        assert.ok(slice.chunk.length <= PROTOTYPE_HTML_CHUNK_CHARS);
        return slice;
      },
    );
    assert.ok(chunkCalls >= 5);
    assert.equal(reassembled.length, bigHtml.length);
    assert.equal(reassembled, bigHtml);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
// end of tests
