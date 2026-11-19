import { Platform, Share } from "react-native";
import { formatByteSize } from "../shared/annotations";

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  if (len === 0) return "";
  const parts: string[] = [];
  const step = 3 * 4096;
  for (let start = 0; start < len; start += step) {
    const end = Math.min(len, start + step);
    let chunk = "";
    let i = start;
    for (; i + 2 < end; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chunk +=
        B64_ALPHABET[(n >> 18) & 63] +
        B64_ALPHABET[(n >> 12) & 63] +
        B64_ALPHABET[(n >> 6) & 63] +
        B64_ALPHABET[n & 63];
    }
    const rem = end - i;
    if (rem === 1) {
      const n = bytes[i] << 16;
      chunk += B64_ALPHABET[(n >> 18) & 63] + B64_ALPHABET[(n >> 12) & 63] + "==";
    } else if (rem === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      chunk +=
        B64_ALPHABET[(n >> 18) & 63] +
        B64_ALPHABET[(n >> 12) & 63] +
        B64_ALPHABET[(n >> 6) & 63] +
        "=";
    }
    parts.push(chunk);
  }
  return parts.join("");
}

export function utf8ToHtmlDataUri(html: string): string {
  const bytes = new TextEncoder().encode(html);
  return `data:text/html;charset=utf-8;base64,${bytesToBase64(bytes)}`;
}

interface DomAnchorBridge {
  createElement?: (tag: string) => {
    href: string;
    download: string;
    rel: string;
    style: { display: string };
    click: () => void;
    remove: () => void;
  };
  body?: { appendChild: (el: unknown) => void };
}

export async function saveHtmlStringToDevice(
  html: string,
  fileName: string,
  labels?: {
    startedDownload?: (name: string, size: string) => string;
    openedShare?: (name: string) => string;
  },
): Promise<string> {
  const safeName = fileName.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_") || "prototype.html";
  const bytes = new TextEncoder().encode(html);
  const formattedSize = formatByteSize(bytes.byteLength);

  const g = globalThis as unknown as {
    document?: DomAnchorBridge;
    Blob?: new (parts: unknown[], opts?: { type?: string }) => unknown;
    URL?: {
      createObjectURL?: (blob: unknown) => string;
      revokeObjectURL?: (url: string) => void;
    };
  };

  if (
    g.document?.createElement &&
    g.document.body &&
    typeof g.Blob === "function" &&
    typeof g.URL?.createObjectURL === "function"
  ) {
    const blob = new g.Blob([bytes], { type: "text/html;charset=utf-8" });
    const url = g.URL.createObjectURL(blob);
    const a = g.document.createElement("a");
    a.href = url;
    a.download = safeName;
    a.rel = "noopener";
    a.style.display = "none";
    g.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try {
        g.URL?.revokeObjectURL?.(url);
      } catch {
        // ignore
      }
    }, 60_000);
    return (
      labels?.startedDownload?.(safeName, formattedSize) ??
      `Downloading ${safeName} (${formattedSize})`
    );
  }

  const dataUri = `data:text/html;charset=utf-8;base64,${bytesToBase64(bytes)}`;
  if (Platform.OS === "ios") {
    await Share.share({ title: safeName, url: dataUri });
  } else {
    await Share.share({ title: safeName, message: dataUri });
  }
  return labels?.openedShare?.(safeName) ?? `Opened share sheet: ${safeName}`;
}
