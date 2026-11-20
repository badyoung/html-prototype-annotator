---
name: html-prototype-craft
description: Design and build interactive, self-contained HTML UI prototypes for Paseo's Prototype Annotator—zero local HTTP ports, semantic data-screen/data-part markers, real multi-state interactions, and one-click pin review.
license: MIT
---

# HTML Prototype Craft

Use this skill before modifying production frontend code whenever a task involves designing a new screen, revamping layout or visual hierarchy, comparing design directions, or aligning on complex multi-state dialogs and flows inside Paseo.

## When to build an HTML prototype first

- **Build a prototype** for new pages, major layout/visual redesigns, multi-option design explorations, or stateful modals/drawers/wizards where interactive validation saves implementation rework.
- **Skip the prototype** for pure logic fixes, API wiring that preserves existing UI, or small, unambiguous style tweaks.

## Zero-port Paseo delivery

1. Save prototypes inside the workspace under `.artifacts/prototypes/<slug>.html` (plus optional relative `.css` or image files in the same folder—Prototype Annotator bundles local relative `<link rel="stylesheet">` and `<img>` assets automatically).
2. **Never** start a temporary local HTTP server (`python -m http.server`, `npx serve`, Vite preview, port tunnels) just to preview a prototype. Paseo streams bundled prototypes over its encrypted connection across Desktop, Web, Relay, Tailscale, iOS, and Android.
3. Share the prototype in your reply as a standard clickable `file://` Markdown link using the file basename:
   `[checkout-flow.html](file:///absolute/path/to/.artifacts/prototypes/checkout-flow.html)`

## Semantic `data-screen` & `data-part` instrumentation

Prototype Annotator opens in **Interact** mode (`pointer-events: none` overlay) and lets reviewers drop numbered pins or drag region boxes onto elements. Give reviewers crisp, unambiguous feedback payloads by annotating key DOM nodes:

- Add `data-screen="<Screen or State Name>"` on each page, artboard, modal, or state container (update `dataset.screen` dynamically if JavaScript switches major views inside a single container).
- Add `data-part="<Semantic Element Name>"` on every interactive control, card, form field, section header, and CTA button.

```html
<main data-screen="Billing Upgrade · Annual">
  <div role="tablist" aria-label="Billing cycle" data-part="Billing Cycle Toggle">
    <button role="tab" aria-selected="false" data-part="Monthly Tab">Monthly</button>
    <button role="tab" aria-selected="true" data-part="Annual Tab">Annual (Save 20%)</button>
  </div>

  <section data-part="Pro Plan Card">
    <h2>Pro Team</h2>
    <button type="button" data-part="Primary Upgrade CTA">Start 14-day trial</button>
  </section>
</main>
```

## Make interactions genuinely alive

- Wire real click, tab, drawer, dialog, segmented-control, and empty/loading/error state transitions in clean vanilla JavaScript so reviewers can click through the flow in **Interact** mode before dropping pins.
- **Never** build your own top annotation bar, pin sidebar, or full-screen `pointer-events` interceptor inside the `.html` file—Prototype Annotator provides the surrounding studio chrome automatically.
- Keep prototypes self-contained and offline-friendly: prefer inline SVG icons, CSS custom properties (design tokens), and system or locally available type stacks rather than fragile external scripts.
- Respect both desktop and mobile viewports (`<meta name="viewport" content="width=device-width, initial-scale=1">`, responsive CSS Grid/Flexbox, minimum `44×44px` touch targets, visible `:focus-visible` outlines, and `prefers-reduced-motion`).

## Acting on returned Prototype Annotator feedback

When the user sends back a `<prototype-feedback>` (or `📌 HTML Prototype Annotations`) message:
1. Match each numbered item (`#1 [Screen] Part (pin x%, y% · selector)`, plus optional `DOM:` path and `Text:` snippet) directly to its `data-screen` and `data-part` in the prototype or target production component.
2. If `status="approved"` with zero revision items, proceed to production implementation; otherwise address every listed pin and the overall note systematically—either updating the prototype for another round or applying the requested revisions into production code as instructed.
