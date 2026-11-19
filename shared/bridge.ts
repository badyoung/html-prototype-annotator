export interface HtmlPrototypeOpenRequest {
  path: string;
  title?: string;
  cwd?: string | null;
  agentId?: string | null;
  agentTitle?: string | null;
}

export interface HtmlPrototypeBridgeApi {
  open(request: HtmlPrototypeOpenRequest): void;
}

const BRIDGE_GLOBAL_KEY = "__paseoHtmlPrototypeBridge_v1";

export function registerHtmlPrototypeBridge(
  api: HtmlPrototypeBridgeApi,
): () => void {
  const g = globalThis as Record<string, unknown>;
  g[BRIDGE_GLOBAL_KEY] = api;
  return () => {
    if (g[BRIDGE_GLOBAL_KEY] === api) {
      delete g[BRIDGE_GLOBAL_KEY];
    }
  };
}

export function getHtmlPrototypeBridge(): HtmlPrototypeBridgeApi | null {
  const g = globalThis as Record<string, unknown>;
  const candidate = g[BRIDGE_GLOBAL_KEY];
  if (
    candidate &&
    typeof candidate === "object" &&
    typeof (candidate as HtmlPrototypeBridgeApi).open === "function"
  ) {
    return candidate as HtmlPrototypeBridgeApi;
  }
  return null;
}
