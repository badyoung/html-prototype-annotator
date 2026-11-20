import { isChineseLocale } from "./annotations";

/**
 * Injects a Figma-grade zero-network visual inspection, teardrop pin, box-select,
 * inline comment popover, and legacy-chrome purifier runtime into an HTML prototype.
 */
export function instrumentHtmlForWebAnnotator(
  rawHtml: string,
  bridgeToken: string,
  locale?: string | null,
): string {
  const safeTokenJson = JSON.stringify(bridgeToken);
  const zh = isChineseLocale(locale);
  const uiCopyJson = JSON.stringify(
    zh
      ? {
          pinBanner: "📌 点按打标模式（按住 Option/Alt 点击可触发按钮）",
          boxBanner: "🔲 框选打标模式（拖拽画框批注）",
          backToInteract: "切回交互点击",
          screenFallback: "画板",
          mainScreenFallback: "主画板",
          canvasRegion: "画布区域",
          componentFallback: "组件",
          elementFallback: "界面元素",
          notePlaceholder: "输入调整想法（按 Enter 收起）…",
          deletePin: "删除图钉",
          done: "完成",
          hudOptionHint: " · Option+点击触发按钮",
        }
      : {
          pinBanner: "📌 Pin mode (Option/Alt + click to trigger buttons)",
          boxBanner: "🔲 Box-select mode (drag to highlight a region)",
          backToInteract: "Back to Interact",
          screenFallback: "Screen",
          mainScreenFallback: "Main Canvas",
          canvasRegion: "Canvas region",
          componentFallback: "Component",
          elementFallback: "UI element",
          notePlaceholder: "Describe the change (press Enter to close)…",
          deletePin: "Delete pin",
          done: "Done",
          hudOptionHint: " · Option+click to trigger button",
        },
  );

  const injectedSnippet = `
<style id="__paseo_proto_annotator_style__">
  html.__paseo-mode-pin, html.__paseo-mode-pin * {
    cursor: crosshair !important;
  }
  html.__paseo-mode-box, html.__paseo-mode-box * {
    cursor: crosshair !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }

  /* In 'interact' mode, EVERY annotation mask/pin/box/popover/HUD is strictly pointer-events: none
     so mousedown / pointerdown / pointermove / touchstart / touchmove / wheel pass 100% through to the page */
  html.__paseo-mode-interact #__paseo_overlay_layer__,
  html.__paseo-mode-interact #__paseo_overlay_layer__ *,
  html.__paseo-mode-interact .__paseo-pin-badge,
  html.__paseo-mode-interact .__paseo-pin-badge *,
  html.__paseo-mode-interact .__paseo-box-overlay,
  html.__paseo-mode-interact .__paseo-box-overlay *,
  html.__paseo-mode-interact #__paseo_hover_hud__,
  html.__paseo-mode-interact #__paseo_inline_popover__,
  html.__paseo-mode-interact #__paseo_inline_popover__ *,
  html.__paseo-mode-interact #__paseo_mode_banner__,
  html.__paseo-mode-interact #__paseo_mode_banner__ * {
    pointer-events: none !important;
  }
  html.__paseo-mode-interact .__paseo-pin-badge:not(.__active),
  html.__paseo-mode-interact .__paseo-box-overlay:not(.__active) {
    display: none !important;
  }
  .__paseo-box-overlay:not(.__active):not(.__dragging) {
    border-color: transparent !important;
    background: transparent !important;
    box-shadow: none !important;
  }

  #__paseo_overlay_layer__ {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 2147483638;
  }

  /* Smart Purifier: hide legacy baked-in standalone annotation toolbars/sidebars */
  html.__paseo-clean-chrome .topbar:has(#toggleAnnotateBtn),
  html.__paseo-clean-chrome .hint-banner:has(#serverStatus),
  html.__paseo-clean-chrome .sidebar:has(#pinList),
  html.__paseo-clean-chrome .pin-marker {
    display: none !important;
  }
  html.__paseo-clean-chrome .workspace:has(.sidebar #pinList) {
    grid-template-columns: 1fr !important;
    max-width: 1360px !important;
    padding: 24px 20px !important;
  }

  @keyframes __paseoPinPop {
    0% { transform: translate(-3px, -26px) rotate(-45deg) scale(0.4); opacity: 0; }
    100% { transform: translate(-3px, -26px) rotate(-45deg) scale(1); opacity: 1; }
  }

  /* Sculpted Figma-style speech-drop pin */
  .__paseo-pin-badge {
    position: absolute;
    width: 28px;
    height: 28px;
    border-radius: 50% 50% 50% 4px;
    transform: translate(-3px, -26px) rotate(-45deg);
    background: linear-gradient(135deg, #FF6B35 0%, #E84118 100%);
    border: 2px solid #FFFFFF;
    box-shadow: 0 6px 16px rgba(232, 65, 24, 0.36), 0 2px 4px rgba(15, 23, 42, 0.22);
    z-index: 2147483640;
    cursor: pointer !important;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: __paseoPinPop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: transform 0.14s ease, box-shadow 0.14s ease, background 0.14s ease;
  }
  .__paseo-pin-badge > span {
    transform: rotate(45deg);
    color: #FFFFFF;
    font: 700 11.5px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", sans-serif;
    letter-spacing: -0.02em;
    pointer-events: none;
  }
  .__paseo-pin-badge:hover {
    transform: translate(-3px, -26px) rotate(-45deg) scale(1.12);
  }
  .__paseo-pin-badge.__sent:not(.__active) {
    background: linear-gradient(135deg, #64748B 0%, #475569 100%);
    box-shadow: 0 3px 8px rgba(15, 23, 42, 0.22);
    opacity: 0.78;
  }
  .__paseo-pin-badge.__active {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.28), 0 6px 16px rgba(5, 150, 105, 0.35);
    z-index: 2147483642;
  }

  /* Area selection box */
  .__paseo-box-overlay {
    position: absolute;
    border: 1.5px dashed #F97316;
    background: rgba(249, 115, 22, 0.08);
    border-radius: 10px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    z-index: 2147483638;
    pointer-events: none;
  }
  .__paseo-box-overlay.__active {
    border-color: #10B981;
    border-style: solid;
    background: rgba(16, 185, 129, 0.09);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
  }
  .__paseo-box-overlay .__paseo-box-tag {
    position: absolute;
    top: -12px;
    left: -2px;
    min-width: 24px;
    height: 22px;
    padding: 0 7px;
    border-radius: 999px;
    background: linear-gradient(135deg, #FF6B35 0%, #E84118 100%);
    color: #FFFFFF;
    font: 700 11px/18px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
    border: 2px solid #FFFFFF;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    cursor: pointer !important;
    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.22);
  }
  .__paseo-box-overlay.__sent:not(.__active) .__paseo-box-tag {
    background: linear-gradient(135deg, #64748B 0%, #475569 100%);
    opacity: 0.78;
  }
  .__paseo-box-overlay.__active .__paseo-box-tag {
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
  }

  /* Subtle Indigo Hover Inspector Ring + Floating Pill HUD */
  .__paseo-hover-outline {
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.82) !important;
    border-radius: 6px;
  }
  #__paseo_hover_hud__ {
    position: fixed;
    left: 0;
    top: 0;
    padding: 4px 9px;
    border-radius: 7px;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: #F8FAFC;
    font: 600 11px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    pointer-events: none;
    z-index: 2147483645;
    display: none;
    max-width: 260px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.24);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  /* Floating Figma-style Inline Comment Popover right next to active pin */
  #__paseo_inline_popover__ {
    position: fixed;
    width: 276px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(15, 23, 42, 0.1);
    box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.08);
    padding: 11px;
    z-index: 2147483646;
    display: none;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    color: #0F172A;
    cursor: default !important;
  }
  #__paseo_inline_popover__ * {
    cursor: auto !important;
  }
  #__paseo_inline_popover__ .__pop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }
  #__paseo_inline_popover__ .__pop-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #0F172A;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  #__paseo_inline_popover__ .__pop-num {
    background: #10B981;
    color: #FFFFFF;
    font-size: 10.5px;
    font-weight: 800;
    padding: 2px 6px;
    border-radius: 999px;
    flex-shrink: 0;
  }
  #__paseo_inline_popover__ textarea {
    width: 100%;
    min-height: 62px;
    border: 1px solid #E2E8F0;
    border-radius: 9px;
    background: #F8FAFC;
    color: #0F172A;
    padding: 8px 9px;
    font: 400 12.5px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
    cursor: text !important;
  }
  #__paseo_inline_popover__ textarea:focus {
    border-color: #10B981;
    background: #FFFFFF;
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
  }
  #__paseo_inline_popover__ .__pop-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }
  #__paseo_inline_popover__ button {
    border: none;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 600;
    padding: 5px 10px;
    cursor: pointer !important;
  }
  #__paseo_inline_popover__ .__btn-del {
    background: transparent;
    color: #EF4444;
    padding: 5px 6px;
  }
  #__paseo_inline_popover__ .__btn-del:hover {
    background: #FEF2F2;
  }
  #__paseo_inline_popover__ .__btn-ok {
    background: #0F172A;
    color: #FFFFFF;
  }

  /* Compact top-center banner shown ONLY in pin/box annotation modes */
  #__paseo_mode_banner__ {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: none;
    align-items: center;
    gap: 8px;
    padding: 5px 7px 5px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.88);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(249, 115, 22, 0.55);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.24);
    color: #F8FAFC;
    font: 600 11.5px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    z-index: 2147483644;
    pointer-events: auto;
    cursor: default !important;
    white-space: nowrap;
  }
  #__paseo_mode_banner__ button {
    border: none;
    border-radius: 999px;
    background: #10B981;
    color: #FFFFFF;
    font: 700 11px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif;
    padding: 5px 10px;
    cursor: pointer !important;
  }
  #__paseo_mode_banner__ button:hover {
    background: #059669;
  }
</style>
<script id="__paseo_proto_annotator_boot__">
(function() {
  var TOKEN = ${safeTokenJson};
  var I18N = ${uiCopyJson};

  // 1. Safe in-memory Web Storage shim inside sandbox="allow-scripts"
  function makeMemStorage() {
    var store = Object.create(null);
    return {
      getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v) { store[String(k)] = String(v); },
      removeItem: function(k) { delete store[String(k)]; },
      clear: function() { store = Object.create(null); },
      key: function(i) { return Object.keys(store)[i] || null; },
      get length() { return Object.keys(store).length; }
    };
  }
  try {
    var _ls = window.localStorage && window.localStorage.length;
  } catch (_err) {
    try { Object.defineProperty(window, "localStorage", { value: makeMemStorage(), configurable: true }); } catch (_e) {}
    try { Object.defineProperty(window, "sessionStorage", { value: makeMemStorage(), configurable: true }); } catch (_e) {}
  }

  // 2. Graceful offline stub for legacy /api/annotations calls
  if (typeof window.fetch === "function") {
    var origFetch = window.fetch.bind(window);
    window.fetch = function(input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.indexOf("/api/annotations") !== -1) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, pins: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }));
      }
      return origFetch(input, init);
    };
  }

  var state = {
    mode: "interact",
    cleanChrome: true,
    pins: [],
    activePinId: null,
    popoverOpenForId: null
  };

  var hudEl = null;
  var overlayLayerEl = null;
  var modeBannerEl = null;
  var modeBannerTextEl = null;
  var popoverEl = null;
  var popoverTextarea = null;
  var popoverTitleSpan = null;
  var popoverNumSpan = null;
  var badgeDomById = Object.create(null);
  var overlayItems = [];
  var dragState = null;
  var pendingOpenNewest = false;

  function postToHost(type, payload) {
    try {
      window.parent.postMessage(Object.assign({
        source: "paseo-proto-frame",
        token: TOKEN,
        type: type
      }, payload || {}), "*");
    } catch (_e) {}
  }

  function applyRootClasses() {
    var root = document.documentElement;
    if (!root) return;
    root.classList.toggle("__paseo-mode-interact", state.mode === "interact");
    root.classList.toggle("__paseo-mode-pin", state.mode === "pin");
    root.classList.toggle("__paseo-mode-box", state.mode === "box");
    root.classList.toggle("__paseo-clean-chrome", Boolean(state.cleanChrome));
    if (state.mode === "interact") {
      if (dragState) {
        try { dragState.previewEl.remove(); } catch (_e) {}
        dragState = null;
      }
      if (state.popoverOpenForId) {
        state.popoverOpenForId = null;
        if (popoverEl) popoverEl.style.display = "none";
      }
    }
    if (modeBannerEl && modeBannerTextEl) {
      if (state.mode === "pin") {
        modeBannerTextEl.textContent = I18N.pinBanner;
        modeBannerEl.style.display = "inline-flex";
      } else if (state.mode === "box") {
        modeBannerTextEl.textContent = I18N.boxBanner;
        modeBannerEl.style.display = "inline-flex";
      } else {
        modeBannerEl.style.display = "none";
      }
    }
  }

  function cleanText(str, maxLen) {
    var s = String(str || "").replace(/\\s+/g, " ").trim();
    if (!s) return "";
    return s.length > (maxLen || 42) ? s.slice(0, maxLen || 42) + "…" : s;
  }

  function buildShortSelector(el) {
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    if (el.id && !/^__paseo/.test(el.id)) return tag + "#" + el.id;
    var cls = typeof el.className === "string"
      ? el.className.split(/\\s+/).filter(function(c) { return c && !/^__paseo/.test(c); }).slice(0, 2)
      : [];
    return cls.length ? tag + "." + cls.join(".") : tag;
  }

  function isScreenElVisible(el) {
    var cur = el;
    while (cur && cur !== document.documentElement) {
      var st = window.getComputedStyle(cur);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      if (cur.classList && (cur.classList.contains("hidden") || cur.classList.contains("hidden-el"))) return false;
      cur = cur.parentElement;
    }
    var r = el.getBoundingClientRect();
    return r.width >= 20 && r.height >= 20;
  }

  function resolveScreenHost(target) {
    if (target && target.closest) {
      var ds = target.closest("[data-screen]");
      if (ds) {
        return {
          el: ds,
          name: cleanText(ds.getAttribute("data-screen"), 80) || I18N.screenFallback
        };
      }
    }
    var visibleScreens = [];
    var allScreens = document.querySelectorAll("[data-screen]");
    for (var i = 0; i < allScreens.length; i++) {
      if (isScreenElVisible(allScreens[i])) {
        visibleScreens.push(allScreens[i]);
      }
    }
    if (visibleScreens.length === 1) {
      return {
        el: visibleScreens[0],
        name: cleanText(visibleScreens[0].getAttribute("data-screen"), 80) || I18N.screenFallback
      };
    }
    var body = document.body || document.documentElement;
    if (body && window.getComputedStyle(body).position === "static") {
      body.style.position = "relative";
    }
    return {
      el: body,
      name: cleanText(document.title, 60) || I18N.mainScreenFallback
    };
  }

  function buildDomPath(el, stopEl) {
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 5) {
      var seg = buildShortSelector(cur);
      if (seg) {
        if (!cur.id && cur.parentElement && cur.parentElement.children) {
          var siblings = cur.parentElement.children;
          var sameTag = [];
          for (var i = 0; i < siblings.length; i++) {
            if (siblings[i].tagName === cur.tagName) sameTag.push(siblings[i]);
          }
          if (sameTag.length > 1) {
            seg += ":nth-of-type(" + (sameTag.indexOf(cur) + 1) + ")";
          }
        }
        parts.unshift(seg);
      }
      if (cur === stopEl || cur === document.body) break;
      cur = cur.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  }

  function resolvePartSummary(target, screenEl) {
    if (!target || target === document.body || target === document.documentElement) {
      return { part: I18N.canvasRegion, selector: "body", domPath: "body", textSnippet: "" };
    }
    var dp = target.closest ? target.closest("[data-part]") : null;
    if (dp && (!screenEl || screenEl.contains(dp))) {
      var dpText = cleanText(dp.innerText || dp.textContent || "", 84);
      var dpPart = cleanText(dp.getAttribute("data-part"), 90) || I18N.componentFallback;
      return {
        part: dpPart,
        selector: buildShortSelector(dp),
        domPath: buildDomPath(dp, screenEl || document.body),
        textSnippet: dpText && dpText !== dpPart ? dpText : ""
      };
    }
    var interactive = target.closest
      ? target.closest("button, a, input, select, textarea, [role='button'], h1, h2, h3, h4, label")
      : null;
    var chosen = (interactive && (!screenEl || screenEl.contains(interactive))) ? interactive : target;
    var aria = chosen.getAttribute && (chosen.getAttribute("aria-label") || chosen.getAttribute("placeholder") || chosen.getAttribute("title"));
    var rawText = cleanText(chosen.innerText || chosen.textContent || "", 84);
    var text = cleanText(aria || rawText || "", 44);
    var sel = buildShortSelector(chosen);
    var finalPart = text ? text : (sel || I18N.elementFallback);
    return {
      part: finalPart,
      selector: sel,
      domPath: buildDomPath(chosen, screenEl || document.body),
      textSnippet: rawText && rawText !== finalPart ? rawText : ""
    };
  }

  function findHostForScreenName(screenName) {
    var nodes = document.querySelectorAll("[data-screen]");
    if (nodes.length === 0) {
      return document.body || document.documentElement;
    }
    var visibleNodes = [];
    for (var i = 0; i < nodes.length; i++) {
      if (!isScreenElVisible(nodes[i])) continue;
      var val = cleanText(nodes[i].getAttribute("data-screen"), 80);
      if (val === screenName) {
        return nodes[i];
      }
      visibleNodes.push({ el: nodes[i], val: val });
    }
    var prefix = String(screenName || "").split("·")[0].trim();
    if (prefix) {
      for (var j = 0; j < visibleNodes.length; j++) {
        if (visibleNodes[j].val.split("·")[0].trim() === prefix) {
          return visibleNodes[j].el;
        }
      }
    }
    var docTitle = cleanText(document.title, 60);
    if (docTitle && screenName === docTitle) {
      return visibleNodes.length === 1 ? visibleNodes[0].el : (document.body || document.documentElement);
    }
    return null;
  }

  function getHostPageBox(hostEl) {
    var isDocRoot = !hostEl || hostEl === document.body || hostEl === document.documentElement;
    if (isDocRoot) {
      var docW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth, 1);
      var docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight, 1);
      return { left: 0, top: 0, width: docW, height: docH };
    }
    var rect = hostEl.getBoundingClientRect();
    return {
      left: rect.left + window.scrollX,
      top: rect.top + window.scrollY,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1)
    };
  }

  function ensureFloatingChrome() {
    if (!document.body) return;
    if (!overlayLayerEl || !overlayLayerEl.isConnected) {
      overlayLayerEl = document.createElement("div");
      overlayLayerEl.id = "__paseo_overlay_layer__";
      document.body.appendChild(overlayLayerEl);
    }
    if (!hudEl || !hudEl.isConnected) {
      hudEl = document.createElement("div");
      hudEl.id = "__paseo_hover_hud__";
      document.body.appendChild(hudEl);
    }
    if (!modeBannerEl || !modeBannerEl.isConnected) {
      modeBannerEl = document.createElement("div");
      modeBannerEl.id = "__paseo_mode_banner__";
      modeBannerEl.innerHTML =
        '<span class="__banner-txt"></span>' +
        '<button type="button" class="__banner-btn">' + I18N.backToInteract + '</button>';
      document.body.appendChild(modeBannerEl);
      modeBannerTextEl = modeBannerEl.querySelector(".__banner-txt");
      modeBannerEl.querySelector(".__banner-btn").addEventListener("click", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        state.mode = "interact";
        clearHover();
        applyRootClasses();
        postToHost("set-mode", { mode: "interact" });
      });
    }
    if (!popoverEl || !popoverEl.isConnected) {
      popoverEl = document.createElement("div");
      popoverEl.id = "__paseo_inline_popover__";
      popoverEl.innerHTML =
        '<div class="__pop-head">' +
          '<div class="__pop-title"><span class="__pop-num">#1</span><span class="__pop-part">' + I18N.componentFallback + '</span></div>' +
        '</div>' +
        '<textarea placeholder="' + I18N.notePlaceholder + '"></textarea>' +
        '<div class="__pop-foot">' +
          '<button type="button" class="__btn-del">' + I18N.deletePin + '</button>' +
          '<button type="button" class="__btn-ok">' + I18N.done + '</button>' +
        '</div>';
      document.body.appendChild(popoverEl);
      popoverTextarea = popoverEl.querySelector("textarea");
      popoverTitleSpan = popoverEl.querySelector(".__pop-part");
      popoverNumSpan = popoverEl.querySelector(".__pop-num");

      popoverTextarea.addEventListener("input", function() {
        if (!state.popoverOpenForId) return;
        postToHost("update-pin-note", {
          id: state.popoverOpenForId,
          note: popoverTextarea.value
        });
      });
      popoverTextarea.addEventListener("keydown", function(ev) {
        if (ev.key === "Escape" || (ev.key === "Enter" && !ev.shiftKey)) {
          ev.preventDefault();
          state.popoverOpenForId = null;
          updatePopoverPosition();
        }
      });
      popoverEl.querySelector(".__btn-ok").addEventListener("click", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        state.popoverOpenForId = null;
        updatePopoverPosition();
      });
      popoverEl.querySelector(".__btn-del").addEventListener("click", function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var targetId = state.popoverOpenForId;
        state.popoverOpenForId = null;
        updatePopoverPosition();
        if (targetId) postToHost("delete-pin", { id: targetId });
      });
    }
  }

  function updatePopoverPosition(focusInput) {
    ensureFloatingChrome();
    if (!popoverEl) return;
    if (!state.popoverOpenForId) {
      popoverEl.style.display = "none";
      return;
    }
    var idx = -1;
    var pin = null;
    for (var i = 0; i < state.pins.length; i++) {
      if (state.pins[i].id === state.popoverOpenForId) {
        idx = i;
        pin = state.pins[i];
        break;
      }
    }
    var anchor = badgeDomById[state.popoverOpenForId];
    if (!pin || !anchor) {
      popoverEl.style.display = "none";
      return;
    }
    popoverNumSpan.textContent = "#" + (idx + 1);
    popoverTitleSpan.textContent = pin.part || I18N.canvasRegion;
    if (document.activeElement !== popoverTextarea) {
      popoverTextarea.value = pin.note || "";
    }
    popoverEl.style.display = "block";

    var r = anchor.getBoundingClientRect();
    var pw = 276;
    var ph = popoverEl.offsetHeight || 136;
    var left = r.right + 10;
    if (left + pw > window.innerWidth - 12) {
      left = Math.max(12, r.left - pw - 10);
    }
    var top = Math.max(12, Math.min(window.innerHeight - ph - 12, r.top - 8));
    popoverEl.style.left = Math.round(left) + "px";
    popoverEl.style.top = Math.round(top) + "px";

    if (focusInput) {
      setTimeout(function() {
        try { popoverTextarea.focus(); } catch (_e) {}
      }, 20);
    }
  }

  function repositionOverlays() {
    for (var i = 0; i < overlayItems.length; i++) {
      var item = overlayItems[i];
      var isAct = state.activePinId === item.pin.id;
      var host = findHostForScreenName(item.pin.screen);
      if (!host && !isAct) {
        item.el.style.display = "none";
        continue;
      }
      item.el.style.display = "";
      var box = getHostPageBox(host || document.body || document.documentElement);
      item.el.style.left = Math.round((box.left + (item.pin.xPct / 100) * box.width) * 10) / 10 + "px";
      item.el.style.top = Math.round((box.top + (item.pin.yPct / 100) * box.height) * 10) / 10 + "px";
      if (item.pin.kind === "box" && item.pin.wPct && item.pin.hPct) {
        item.el.style.width = Math.round(((item.pin.wPct / 100) * box.width) * 10) / 10 + "px";
        item.el.style.height = Math.round(((item.pin.hPct / 100) * box.height) * 10) / 10 + "px";
      }
    }
  }

  function renderOverlays(justAddedId) {
    ensureFloatingChrome();
    if (!overlayLayerEl) return;
    overlayLayerEl.innerHTML = "";
    badgeDomById = Object.create(null);
    overlayItems = [];

    for (var idx = 0; idx < state.pins.length; idx++) {
      (function(pin, num) {
        var isActive = state.activePinId === pin.id;
        var sentCls = pin.sentAt ? " __sent" : "";
        if (pin.kind === "box" && pin.wPct && pin.hPct) {
          var box = document.createElement("div");
          box.className = "__paseo-box-overlay" + sentCls + (isActive ? " __active" : "");
          var tag = document.createElement("div");
          tag.className = "__paseo-box-tag";
          tag.textContent = "#" + num;
          tag.title = pin.note || pin.part || "";
          tag.addEventListener("click", function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            state.popoverOpenForId = pin.id;
            postToHost("select-pin", { id: pin.id });
            updatePopoverPosition(true);
          }, true);
          box.appendChild(tag);
          overlayLayerEl.appendChild(box);
          badgeDomById[pin.id] = tag;
          overlayItems.push({ pin: pin, el: box });
        } else {
          var badge = document.createElement("div");
          badge.className = "__paseo-pin-badge" + sentCls + (isActive ? " __active" : "");
          var inner = document.createElement("span");
          inner.textContent = String(num);
          badge.appendChild(inner);
          badge.title = pin.note || pin.part || "";
          badge.addEventListener("click", function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            state.popoverOpenForId = pin.id;
            postToHost("select-pin", { id: pin.id });
            updatePopoverPosition(true);
          }, true);
          overlayLayerEl.appendChild(badge);
          badgeDomById[pin.id] = badge;
          overlayItems.push({ pin: pin, el: badge });
        }
      })(state.pins[idx], idx + 1);
    }

    repositionOverlays();

    if (justAddedId) {
      state.popoverOpenForId = justAddedId;
      updatePopoverPosition(true);
    } else {
      updatePopoverPosition(false);
    }
  }

  function clampPct(v) {
    return Math.max(0, Math.min(100, Math.round(v * 10) / 10));
  }

  function computeContainerMetrics(hostEl, clientX, clientY) {
    var isDocRoot = hostEl === document.body || hostEl === document.documentElement;
    if (isDocRoot) {
      var docW = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, window.innerWidth, 1);
      var docH = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight, 1);
      return {
        xPct: clampPct(((clientX + window.scrollX) / docW) * 100),
        yPct: clampPct(((clientY + window.scrollY) / docH) * 100)
      };
    }
    var rect = hostEl.getBoundingClientRect();
    return {
      xPct: clampPct(((clientX - rect.left) / Math.max(rect.width, 1)) * 100),
      yPct: clampPct(((clientY - rect.top) / Math.max(rect.height, 1)) * 100)
    };
  }

  var hoveredEl = null;
  function clearHover() {
    if (hoveredEl) {
      hoveredEl.classList.remove("__paseo-hover-outline");
      hoveredEl = null;
    }
    if (hudEl) hudEl.style.display = "none";
  }

  function isOwnAnnotatorChrome(t) {
    return Boolean(
      t &&
      t.closest &&
      t.closest("#__paseo_inline_popover__, #__paseo_mode_banner__, .__paseo-pin-badge, .__paseo-box-tag")
    );
  }

  function installDomListeners() {
    ensureFloatingChrome();
    applyRootClasses();

    window.addEventListener("scroll", function() {
      repositionOverlays();
      if (state.popoverOpenForId) updatePopoverPosition(false);
    }, { capture: true, passive: true });

    window.addEventListener("resize", function() {
      repositionOverlays();
      if (state.popoverOpenForId) updatePopoverPosition(false);
    }, { passive: true });

    // Shield underlying prototype pointer/mouse scripts in 'pin' mode so custom pointerup->innerHTML re-renders cannot swallow clicks
    function shieldPinPointerEvent(ev) {
      if (state.mode !== "pin" || ev.altKey) return;
      if (isOwnAnnotatorChrome(ev.target)) return;
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") {
        ev.stopImmediatePropagation();
      }
    }
    window.addEventListener("pointerdown", shieldPinPointerEvent, true);
    window.addEventListener("mousedown", shieldPinPointerEvent, true);
    window.addEventListener("pointerup", shieldPinPointerEvent, true);
    window.addEventListener("mouseup", shieldPinPointerEvent, true);

    window.addEventListener("keydown", function(ev) {
      if (ev.key !== "Escape") return;
      if (state.popoverOpenForId) {
        state.popoverOpenForId = null;
        updatePopoverPosition(false);
        return;
      }
      var active = document.activeElement;
      if (active && /^(INPUT|TEXTAREA|SELECT)$/i.test(active.tagName || "")) {
        return;
      }
      if (state.mode !== "interact") {
        state.mode = "interact";
        clearHover();
        applyRootClasses();
        postToHost("set-mode", { mode: "interact" });
      }
    });

    document.addEventListener("mousemove", function(ev) {
      if (state.mode !== "pin") {
        clearHover();
        return;
      }
      var t = ev.target;
      if (!t || (t.closest && t.closest(".__paseo-pin-badge, .__paseo-box-tag, #__paseo_inline_popover__, #__paseo_mode_banner__"))) {
        clearHover();
        return;
      }
      var cand = (t.closest && t.closest("[data-part], button, a, input, select, textarea, summary, [role='button'], [onclick]")) || null;
      if (cand !== hoveredEl) {
        if (hoveredEl) hoveredEl.classList.remove("__paseo-hover-outline");
        hoveredEl = null;
        if (cand && cand !== document.body && cand !== document.documentElement) {
          cand.classList.add("__paseo-hover-outline");
          hoveredEl = cand;
        }
      }
      if (hoveredEl && hudEl) {
        var hostInfo = resolveScreenHost(hoveredEl);
        var info = resolvePartSummary(hoveredEl, hostInfo.el);
        var isClickableCtrl = Boolean(
          hoveredEl.closest &&
          hoveredEl.closest("button, a, input, select, textarea, summary, [role='button'], [onclick]")
        );
        hudEl.textContent = isClickableCtrl
          ? info.part + I18N.hudOptionHint
          : info.part;
        hudEl.style.display = "block";
        var r = hoveredEl.getBoundingClientRect();
        var topPos = r.top - 28;
        if (topPos < 6) topPos = r.bottom + 6;
        hudEl.style.left = Math.max(8, Math.min(window.innerWidth - 260, r.left)) + "px";
        hudEl.style.top = Math.round(topPos) + "px";
      } else if (hudEl) {
        hudEl.style.display = "none";
      }
    }, true);

    window.addEventListener("click", function(ev) {
      var t = ev.target;
      if (t && t.closest && t.closest("#__paseo_inline_popover__, #__paseo_mode_banner__")) return;
      if (t && t.closest && t.closest(".__paseo-pin-badge, .__paseo-box-tag")) return;

      if (state.mode === "interact") {
        if (ev.altKey) {
          ev.preventDefault();
          ev.stopPropagation();
          var altHost = resolveScreenHost(t);
          var altPart = resolvePartSummary(t, altHost.el);
          var altCoords = computeContainerMetrics(altHost.el, ev.clientX, ev.clientY);
          pendingOpenNewest = true;
          postToHost("add-pin", {
            draft: {
              kind: "pin",
              screen: altHost.name,
              part: altPart.part,
              selector: altPart.selector,
              domPath: altPart.domPath,
              textSnippet: altPart.textSnippet,
              xPct: altCoords.xPct,
              yPct: altCoords.yPct
            }
          });
          return;
        }
        if (state.popoverOpenForId) {
          state.popoverOpenForId = null;
          updatePopoverPosition(false);
        }
        setTimeout(function() { repositionOverlays(); }, 60);
        return;
      }

      if (state.mode === "box") {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }

      // In 'pin' mode: holding Option/Alt lets the click pass through to the prototype button!
      if (ev.altKey) {
        clearHover();
        setTimeout(function() { repositionOverlays(); }, 60);
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();
      clearHover();

      var hostInfo = resolveScreenHost(t);
      var partInfo = resolvePartSummary(t, hostInfo.el);
      var coords = computeContainerMetrics(hostInfo.el, ev.clientX, ev.clientY);
      pendingOpenNewest = true;

      postToHost("add-pin", {
        draft: {
          kind: "pin",
          screen: hostInfo.name,
          part: partInfo.part,
          selector: partInfo.selector,
          domPath: partInfo.domPath,
          textSnippet: partInfo.textSnippet,
          xPct: coords.xPct,
          yPct: coords.yPct
        }
      });
    }, true);

    // Prevent accidental full-iframe navigation inside srcdoc when clicking prototype <a> or <form> in interact mode
    document.addEventListener("click", function(ev) {
      if (ev.defaultPrevented) return;
      var t = ev.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = (a.getAttribute("href") || "").trim();
      if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
      ev.preventDefault();
    }, false);

    document.addEventListener("submit", function(ev) {
      if (!ev.defaultPrevented) {
        ev.preventDefault();
      }
    }, false);

    window.addEventListener("pointerdown", function(ev) {
      var t = ev.target;
      if (isOwnAnnotatorChrome(t)) return;
      if (state.mode !== "box" || ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof ev.stopImmediatePropagation === "function") {
        ev.stopImmediatePropagation();
      }

      ensureFloatingChrome();
      var hostInfo = resolveScreenHost(t);
      var hostBox = getHostPageBox(hostInfo.el);
      var start = computeContainerMetrics(hostInfo.el, ev.clientX, ev.clientY);
      var preview = document.createElement("div");
      preview.className = "__paseo-box-overlay __dragging";
      if (overlayLayerEl) overlayLayerEl.appendChild(preview);

      dragState = {
        hostEl: hostInfo.el,
        hostBox: hostBox,
        screenName: hostInfo.name,
        startTarget: t,
        startX: start.xPct,
        startY: start.yPct,
        curX: start.xPct,
        curY: start.yPct,
        startClientX: ev.clientX,
        startClientY: ev.clientY,
        previewEl: preview
      };
    }, true);

    window.addEventListener("pointermove", function(ev) {
      if (!dragState) return;
      ev.preventDefault();
      var cur = computeContainerMetrics(dragState.hostEl, ev.clientX, ev.clientY);
      dragState.curX = cur.xPct;
      dragState.curY = cur.yPct;
      var box = dragState.hostBox || getHostPageBox(dragState.hostEl);
      var lPct = Math.min(dragState.startX, dragState.curX);
      var tPct = Math.min(dragState.startY, dragState.curY);
      var wPct = Math.abs(dragState.curX - dragState.startX);
      var hPct = Math.abs(dragState.curY - dragState.startY);
      dragState.previewEl.style.left = Math.round((box.left + (lPct / 100) * box.width) * 10) / 10 + "px";
      dragState.previewEl.style.top = Math.round((box.top + (tPct / 100) * box.height) * 10) / 10 + "px";
      dragState.previewEl.style.width = Math.round(((wPct / 100) * box.width) * 10) / 10 + "px";
      dragState.previewEl.style.height = Math.round(((hPct / 100) * box.height) * 10) / 10 + "px";
    }, true);

    window.addEventListener("pointerup", function(ev) {
      if (!dragState) return;
      ev.preventDefault();
      ev.stopPropagation();
      var ds = dragState;
      dragState = null;
      ds.previewEl.remove();

      var left = clampPct(Math.min(ds.startX, ds.curX));
      var top = clampPct(Math.min(ds.startY, ds.curY));
      var w = clampPct(Math.abs(ds.curX - ds.startX));
      var h = clampPct(Math.abs(ds.curY - ds.startY));
      pendingOpenNewest = true;

      if (w < 1.5 && h < 1.5) {
        var tapPart = resolvePartSummary(ds.startTarget, ds.hostEl);
        postToHost("add-pin", {
          draft: {
            kind: "pin",
            screen: ds.screenName,
            part: tapPart.part,
            selector: tapPart.selector,
            domPath: tapPart.domPath,
            textSnippet: tapPart.textSnippet,
            xPct: ds.startX,
            yPct: ds.startY
          }
        });
        return;
      }

      var minCx = Math.min(ds.startClientX, ev.clientX);
      var maxCx = Math.max(ds.startClientX, ev.clientX);
      var minCy = Math.min(ds.startClientY, ev.clientY);
      var maxCy = Math.max(ds.startClientY, ev.clientY);
      var enclosedParts = [];
      var firstEnclosedEl = null;
      var candidates = ds.hostEl.querySelectorAll("[data-part]");
      for (var i = 0; i < candidates.length; i++) {
        var r = candidates[i].getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        if (cx >= minCx && cx <= maxCx && cy >= minCy && cy <= maxCy) {
          if (!firstEnclosedEl) firstEnclosedEl = candidates[i];
          var pName = cleanText(candidates[i].getAttribute("data-part"), 45);
          if (pName && enclosedParts.indexOf(pName) === -1) enclosedParts.push(pName);
          if (enclosedParts.length >= 3) break;
        }
      }
      var fallbackPart = resolvePartSummary(firstEnclosedEl || ds.startTarget, ds.hostEl);
      postToHost("add-pin", {
        draft: {
          kind: "box",
          screen: ds.screenName,
          part: enclosedParts.length ? enclosedParts.join(" + ") : fallbackPart.part,
          selector: fallbackPart.selector,
          domPath: fallbackPart.domPath,
          textSnippet: fallbackPart.textSnippet,
          xPct: left,
          yPct: top,
          wPct: w,
          hPct: h
        }
      });
    }, true);

    renderOverlays(null);
    postToHost("ready", { title: document.title || "" });
  }

  window.addEventListener("message", function(ev) {
    var d = ev && ev.data;
    if (!d || d.source !== "paseo-proto-host" || d.token !== TOKEN) return;
    if (d.type === "sync-state") {
      var prevLen = state.pins.length;
      if (d.mode) state.mode = d.mode;
      if (typeof d.cleanChrome === "boolean") state.cleanChrome = d.cleanChrome;
      if (Array.isArray(d.pins)) state.pins = d.pins;
      state.activePinId = d.activePinId || null;
      if (state.mode !== "pin") clearHover();
      applyRootClasses();
      var newestId = null;
      if (pendingOpenNewest && state.pins.length > prevLen) {
        newestId = state.pins[state.pins.length - 1].id;
      }
      pendingOpenNewest = false;
      renderOverlays(newestId);
    }
  });

  applyRootClasses();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installDomListeners, { once: true });
  } else {
    installDomListeners();
  }
})();
</script>
`;

  if (/<head\b[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head\b[^>]*>/i, (match) => `${match}\n${injectedSnippet}`);
  }
  if (/<html\b[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<html\b[^>]*>/i, (match) => `${match}<head>${injectedSnippet}</head>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${injectedSnippet}</head><body>${rawHtml}</body></html>`;
}
