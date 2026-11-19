import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { annotationPinSchema } from "./annotations";

export const MAX_PROTOTYPE_HTML_BYTES = 8 * 1024 * 1024;
export const MAX_BUNDLED_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_BUNDLED_BYTES = 12 * 1024 * 1024;

export const domHitBoxSchema = z.object({
  screen: z.string(),
  part: z.string(),
  selector: z.string().optional(),
  xPct: z.number(),
  yPct: z.number(),
  wPct: z.number(),
  hPct: z.number(),
  screenXPct: z.number(),
  screenYPct: z.number(),
  area: z.number(),
});

export type DomHitBox = z.infer<typeof domHitBoxSchema>;

export const loadHtmlPrototypeInputSchema = z.object({
  rawPath: z.string().min(1).max(4096),
  cwd: z.string().max(4096).nullable().optional(),
});

export const loadHtmlPrototypeOutputSchema = z.object({
  resolvedPath: z.string(),
  fileName: z.string(),
  title: z.string(),
  byteSize: z.number().int().nonnegative(),
  modifiedAt: z.string(),
  bundledHtml: z.string(),
  semanticScreens: z.array(z.string()),
  semanticParts: z.array(z.string()),
  savedPins: z.array(annotationPinSchema),
  savedOverallNote: z.string(),
});

export type LoadHtmlPrototypeOutput = z.infer<
  typeof loadHtmlPrototypeOutputSchema
>;

export const loadHtmlPrototypeRpc = defineRpc({
  name: "html-prototype-annotator.load-prototype",
  input: loadHtmlPrototypeInputSchema,
  output: loadHtmlPrototypeOutputSchema,
});

export const renderMobilePrototypeInputSchema = z.object({
  resolvedPath: z.string().min(1).max(4096),
  viewportWidth: z.number().int().min(320).max(1440).default(414),
  cleanChrome: z.boolean().default(true),
  clickXPct: z.number().min(0).max(100).optional(),
  clickYPct: z.number().min(0).max(100).optional(),
  resetSession: z.boolean().optional(),
});

export const renderMobilePrototypeOutputSchema = z.object({
  imageDataUri: z.string(),
  docWidth: z.number().positive(),
  docHeight: z.number().positive(),
  hitBoxes: z.array(domHitBoxSchema),
});

export type RenderMobilePrototypeOutput = z.infer<
  typeof renderMobilePrototypeOutputSchema
>;

export const renderMobilePrototypeRpc = defineRpc({
  name: "html-prototype-annotator.render-mobile-prototype",
  input: renderMobilePrototypeInputSchema,
  output: renderMobilePrototypeOutputSchema,
});

export const submitPrototypeAnnotationsInputSchema = z.object({
  resolvedPath: z.string().min(1).max(4096),
  fileName: z.string().min(1).max(512),
  agentId: z.string().max(256).nullable().optional(),
  pins: z.array(annotationPinSchema).max(200),
  overallNote: z.string().max(8000).optional(),
  approvedAsIs: z.boolean().optional(),
  sendToAgent: z.boolean().default(true),
  locale: z.string().max(32).optional(),
});

export const submitPrototypeAnnotationsOutputSchema = z.object({
  savedJsonPath: z.string(),
  savedMarkdownPath: z.string(),
  markdown: z.string(),
  sentToAgent: z.boolean(),
  targetAgentId: z.string().nullable(),
});

export type SubmitPrototypeAnnotationsOutput = z.infer<
  typeof submitPrototypeAnnotationsOutputSchema
>;

export const submitPrototypeAnnotationsRpc = defineRpc({
  name: "html-prototype-annotator.submit-annotations",
  input: submitPrototypeAnnotationsInputSchema,
  output: submitPrototypeAnnotationsOutputSchema,
});

export const BUNDLED_DESIGN_SKILL_IDS = [
  "html-prototype-craft",
  "frontend-design",
  "baseline-ui",
  "fixing-accessibility",
  "fixing-motion-performance",
] as const;

export const bundledSkillIdSchema = z.enum(BUNDLED_DESIGN_SKILL_IDS);
export type BundledDesignSkillId = z.infer<typeof bundledSkillIdSchema>;

export const bundledSkillStatusItemSchema = z.object({
  id: bundledSkillIdSchema,
  license: z.string(),
  state: z.enum(["plugin-managed", "external", "missing"]),
  installedTargets: z.array(z.string()),
});

export type BundledSkillStatusItem = z.infer<
  typeof bundledSkillStatusItemSchema
>;

export const bundledSkillsStatusOutputSchema = z.object({
  targetRoots: z.array(z.string()),
  skills: z.array(bundledSkillStatusItemSchema),
});

export type BundledSkillsStatusOutput = z.infer<
  typeof bundledSkillsStatusOutputSchema
>;

export const getBundledSkillsStatusRpc = defineRpc({
  name: "html-prototype-annotator.get-bundled-skills-status",
  input: z.object({}),
  output: bundledSkillsStatusOutputSchema,
});

export const manageBundledSkillsInputSchema = z.object({
  action: z.enum(["install", "remove"]),
  skillIds: z.array(bundledSkillIdSchema).min(1).max(10).optional(),
});

export const manageBundledSkillsRpc = defineRpc({
  name: "html-prototype-annotator.manage-bundled-skills",
  input: manageBundledSkillsInputSchema,
  output: bundledSkillsStatusOutputSchema,
});
