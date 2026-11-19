import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const HTML_PROTOTYPE_PROMPT_SIGNATURE =
  "# HTML 交互原型预览与图钉标注规范";

export const HTML_PROTOTYPE_DELIVERY_PROMPT = [
  HTML_PROTOTYPE_PROMPT_SIGNATURE,
  "",
  "当前宿主已启用 `html-prototype-annotator` 插件（全程走 Paseo 加密通道，**严禁为预览原型临时启动任何本地 HTTP 端口或映射服务**）：",
  "- **何时使用**：涉及新页面设计、布局/视觉改版、多方案取舍或复杂弹窗/多状态交互时，在改正式代码或派工前先出轻量自包含 `.html` 原型（落盘至 `.artifacts/prototypes/`）与用户对齐；纯逻辑/纯接口适配/明确微调直接执行，不强出原型。",
  "- **怎么编写与交付**：插件默认以「交互点击」态打开，且标注遮罩层全程 `pointer-events: none` 透传 `click / mousedown / pointermove / touchmove` 手势；编写原型时请把按钮点击、Tab 切换、弹窗与拖拽滑动等真实交互状态做活，仅保留干净界面画板（**严禁在 `.html` 内再手写顶部打标栏、批注侧栏或全屏拦截遮罩**），给画板容器加 `data-screen=\"页面名\"`、给关键控件加 `data-part=\"控件语义名\"`，在回复中直接附上 `[原型文件名.html](file:///绝对路径)`；用户点击即可直接操作交互、随时切「点按标注」插图钉并一键把批注打回当前对话。",
].join("\n");

export function getDefaultPrototypePromptFilePath(): string {
  return join(homedir(), ".paseo", "html-prototype-annotator", "delivery-prompt.txt");
}

export function ensurePrototypePromptFile(
  filePath: string = getDefaultPrototypePromptFilePath(),
): string | null {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const desired = `${HTML_PROTOTYPE_DELIVERY_PROMPT}\n`;
    if (existsSync(filePath) && readFileSync(filePath, "utf8") === desired) {
      return filePath;
    }
    writeFileSync(filePath, desired, "utf8");
    return filePath;
  } catch {
    return null;
  }
}

export function appendColonPath(
  existing: string | undefined,
  targetPath: string,
): string {
  const trimmed = targetPath.trim();
  if (!trimmed) return existing ?? "";
  const parts = (existing ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.includes(trimmed)) {
    parts.push(trimmed);
  }
  return parts.join(":");
}

export interface OpenBeforeLike {
  purpose?: "interactive" | "history";
  readonly labels?: Readonly<Record<string, string>>;
  env: Record<string, string>;
}

export interface CreateBeforeLike {
  config: {
    internal?: boolean;
    title?: string | null;
    systemPrompt?: string;
  };
  env?: Record<string, string>;
}

export function applyPrototypeOpenPrompt<T extends OpenBeforeLike>(
  request: T,
  promptFilePath: string | null,
): T {
  if (request.purpose === "history") return request;
  const isSubagent = Boolean(request.labels?.["paseo.parent-agent-id"]);
  const nextEnv: Record<string, string> = {
    ...(request.env ?? {}),
    HPA_IS_TOP_LEVEL: isSubagent ? "0" : "1",
  };
  if (!isSubagent && promptFilePath) {
    nextEnv.PASEO_APPEND_PROMPT_FILES = appendColonPath(
      nextEnv.PASEO_APPEND_PROMPT_FILES,
      promptFilePath,
    );
  }
  request.env = nextEnv;
  return request;
}

export function applyPrototypeCreatePrompt<T extends CreateBeforeLike>(
  request: T,
): T {
  const marker = request.env?.HPA_IS_TOP_LEVEL;
  const isSubagent =
    Boolean(request.config.internal) ||
    Boolean(request.env?.PASEO_PARENT_AGENT_ID) ||
    (marker === "0"
      ? true
      : marker === "1"
        ? false
        : Boolean(request.config.title));

  if (isSubagent) return request;

  const existing = request.config.systemPrompt ?? "";
  if (existing.includes(HTML_PROTOTYPE_PROMPT_SIGNATURE)) {
    return request;
  }

  request.config.systemPrompt = existing.trim()
    ? `${existing.trimEnd()}\n\n${HTML_PROTOTYPE_DELIVERY_PROMPT}`
    : HTML_PROTOTYPE_DELIVERY_PROMPT;
  return request;
}
