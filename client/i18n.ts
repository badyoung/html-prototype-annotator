import * as sdk from "@getpaseo/plugin/client";
import type {
  PluginMessage,
  PluginTranslations,
} from "@getpaseo/plugin/client";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

type Resource = typeof en;

type DotPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : T[K] extends Record<string, unknown>
      ? DotPaths<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type ProtoTextKey = DotPaths<Resource>;
export type ProtoValues = Readonly<Record<string, string | number>>;

export const protoMessages: PluginTranslations<Resource> | null =
  typeof sdk.defineTranslations === "function"
    ? sdk.defineTranslations({ resources: { en, "zh-CN": zhCN } })
    : null;

function resolveStaticLocale(): "en" | "zh-CN" {
  try {
    const lang = Intl.DateTimeFormat().resolvedOptions().locale || "";
    if (/^zh(?:\b|[-_])/i.test(lang)) return "zh-CN";
  } catch {
    // ignore
  }
  return "en";
}

function interpolate(
  dict: Record<string, unknown>,
  key: ProtoTextKey,
  values?: ProtoValues,
): string {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== "string") return key;
  if (!values) return node;
  return node.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) =>
    values[name] !== undefined ? String(values[name]) : m,
  );
}

export function protoLabel(
  key: ProtoTextKey,
  values?: ProtoValues,
): string | PluginMessage {
  if (protoMessages) {
    const fn = protoMessages.message as unknown as (
      k: string,
      opts?: Record<string, unknown>,
    ) => PluginMessage;
    return fn(key, values as Record<string, unknown> | undefined);
  }
  return interpolate(en as unknown as Record<string, unknown>, key, values);
}

export function useProtoI18n(): {
  locale: string;
  t: (key: ProtoTextKey, values?: ProtoValues) => string;
} {
  if (protoMessages && typeof sdk.useTranslation === "function") {
    const hook = sdk.useTranslation(protoMessages) as unknown as {
      locale: string;
      t: (k: string, opts?: Record<string, unknown>) => string;
    };
    return {
      locale: hook.locale,
      t: (key, values) =>
        hook.t(key, values as Record<string, unknown> | undefined),
    };
  }
  const fallbackLocale = resolveStaticLocale();
  const dict = (fallbackLocale === "zh-CN" ? zhCN : en) as unknown as Record<
    string,
    unknown
  >;
  return {
    locale: fallbackLocale,
    t: (key, values) => interpolate(dict, key, values),
  };
}
