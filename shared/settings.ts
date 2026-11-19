import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const prototypeAnnotatorSettingsSchema = z.object({
  defaultMode: z.enum(["interact", "pin", "box"]).default("interact"),
  injectAgentPrompt: z.boolean().default(true),
  browserExecutablePath: z.string().max(1024).default(""),
});

export type PrototypeAnnotatorSettings = z.infer<
  typeof prototypeAnnotatorSettingsSchema
>;

export const prototypeAnnotatorSettings = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: prototypeAnnotatorSettingsSchema,
});

export const AGENT_PROTOTYPE_SNIPPET_EN = [
  "# Interactive HTML Prototype Conventions",
  "",
  "- When designing new screens, layout revamps, or multi-state dialogs, write a self-contained `.html` prototype under `.artifacts/prototypes/` before editing production code, and link it as `[prototype.html](file:///absolute/path/to/prototype.html)`.",
  "- Never start a local HTTP server or port tunnel to preview prototypes; Paseo's Prototype Annotator renders `.html` directly over the encrypted Paseo channel.",
  "- Make buttons, tabs, modals, and drag gestures genuinely interactive, omit any built-in annotation toolbar/sidebar, add `data-screen=\"Screen Name\"` on screen containers, and add `data-part=\"Control Name\"` on key interactive elements.",
].join("\n");

export const AGENT_PROTOTYPE_SNIPPET_ZH = [
  "# HTML 交互原型预览与图钉标注规范",
  "",
  "- 涉及新页面设计、布局/视觉改版或复杂多状态交互时，先在 `.artifacts/prototypes/` 下编写自包含 `.html` 原型并在回复中附上 `[prototype.html](file:///绝对路径)`。",
  "- 严禁为预览原型启动任何本地 HTTP 端口或映射服务，Prototype Annotator 插件会全程通过 Paseo 加密通道零端口直连渲染。",
  "- 把按钮点击、Tab 切换、弹窗与滑动手势做成真实可交互状态，不要在 `.html` 内手写顶部打标栏或批注侧栏；给画板外层加 `data-screen=\"页面名\"`，给关键控件加 `data-part=\"控件语义名\"`。",
].join("\n");
