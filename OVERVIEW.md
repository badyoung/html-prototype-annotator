Prototype Annotator lets you open interactive HTML prototypes produced by coding agents directly inside Paseo, test their live UI states, attach numbered pins or region boxes to specific elements, and send structured Markdown feedback back to the conversation without starting a local HTTP server or port tunnel.

When an agent replies with a `file://` link or workspace path to an `.html` or `.htm` file, the plugin renders an inline card in the chat timeline. You can also open any HTML file from the workspace file tree via **Open with → Prototype Annotator**, from the Command Center, or with `/proto <path>`.

## How it works

On the daemon host, the plugin reads the target `.html` file and inlines relative local `<link rel="stylesheet">` and `<img>` assets from the same directory or its parent folder so multi-file prototypes render over Paseo's encrypted connection across desktop, web, Relay, Tailscale, and mobile clients.

In the studio you can switch between three modes at any time:

- **Interact**: clicks, tabs, dialogs, and drag gestures pass straight through to the prototype so you can test stateful flows first.
- **Drop pins**: clicking an element drops a numbered pin anchored to its `data-screen` container and records its `data-part` label (or accessible text and short CSS selector) alongside percentage coordinates. Hold Option/Alt while clicking to trigger underlying buttons without leaving pin mode.
- **Box region**: drag across the canvas to highlight a region and collect the enclosed `data-part` labels.

Press **Send to agent** (or **Approve** when no changes are needed) to save your draft alongside the prototype and deliver a structured Markdown summary into the selected Paseo session.

## Setup

Requires Paseo 0.14.0 or later on macOS, Linux, or Windows. No accounts, API keys, or external services are needed.

- **Web and desktop clients** render prototypes directly inside a sandboxed `iframe` (`sandbox="allow-scripts"`) with no extra host software.
- **iOS and Android native clients** render high-DPI interactive snapshots and DOM hitboxes through a local headless browser over `--remote-debugging-pipe` (zero listening ports). Install Google Chrome, Chromium, Microsoft Edge, Brave, or Playwright's headless shell on the daemon host, or set a custom executable path in **Settings → Plugins → Prototype Annotator**. The plugin never downloads or installs a browser automatically.

## Capabilities, data access, and limits

- **Bundled frontend design skills**: ships five pure-Markdown agent skills (`html-prototype-craft`, Anthropic's Apache-2.0 `frontend-design`, `baseline-ui`, `fixing-accessibility`, and `fixing-motion-performance`) that can be installed or removed with one click in **Settings → Plugins → Prototype Annotator** (without overwriting skills you already installed elsewhere).
- **Settings**: choose the default canvas mode (**Interact**, **Drop pins**, or **Box region**), toggle automatic prototype-authoring guidance for top-level agents, copy an `AGENTS.md` snippet, or configure a custom browser binary path.
- **Filesystem access**: reads only the `.html`/`.htm` file you open plus relative CSS and image files within its parent directory (resolving symlinks to block outside traversal, up to 8 MB HTML and 12 MB bundled total). Saving or submitting writes `<prototype-dir>/.annotations/<name>.annotations.json` and `.annotations.md` so drafts reload automatically. Clicking **Install** under Bundled frontend design skills copies selected `SKILL.md` folders into `~/.agents/skills` and `~/.claude/skills` with a plugin ownership marker so **Remove** deletes only plugin-installed folders.
- **Agent providers**: when you submit feedback to an agent, the generated Markdown summary (file path, pin coordinates, element labels, and your notes) is sent as a prompt to that session's configured provider. When automatic agent guidance is enabled in settings, a short formatting note is appended to top-level agent prompts.
- **Limits**: external CDN scripts or fonts inside a prototype still depend on the client device's network access; self-contained HTML/CSS/JS prototypes work offline. Mobile touch interaction dispatches single taps and region selection through headless snapshots rather than continuous 60 fps drag streaming.
