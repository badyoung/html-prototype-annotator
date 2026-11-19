import { existsSync } from "node:fs";
import { cp, lstat, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  BUNDLED_DESIGN_SKILL_IDS,
  type BundledDesignSkillId,
  type BundledSkillsStatusOutput,
  type BundledSkillStatusItem,
} from "../shared/rpc";

const PLUGIN_SKILL_MARKER = ".paseo-prototype-annotator-skill.json";

const SKILL_LICENSE_BY_ID: Readonly<Record<BundledDesignSkillId, string>> = {
  "html-prototype-craft": "MIT",
  "frontend-design": "Apache-2.0",
  "baseline-ui": "MIT",
  "fixing-accessibility": "MIT",
  "fixing-motion-performance": "MIT",
};

export function locateBundledSkillsRoot(): string {
  const candidates: string[] = [join(process.cwd(), "skills")];
  const stack = new Error().stack ?? "";

  for (const match of stack.matchAll(
    /(?:file:\/\/)?(\/[^\s):]+?)[\\/]server[\\/]skill-manager\.[tj]s/g,
  )) {
    candidates.unshift(join(match[1], "skills"));
    candidates.unshift(join(dirname(match[1]), "skills"));
  }
  for (const match of stack.matchAll(
    /(?:file:\/\/\/)?([A-Za-z]:[^\s):]+?)[\\/]server[\\/]skill-manager\.[tj]s/g,
  )) {
    candidates.unshift(join(match[1], "skills"));
    candidates.unshift(join(dirname(match[1]), "skills"));
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "html-prototype-craft", "SKILL.md"))) {
      return candidate;
    }
  }
  return join(process.cwd(), "skills");
}

export function defaultSkillTargetRoots(baseHome = homedir()): string[] {
  return [
    join(baseHome, ".agents", "skills"),
    join(baseHome, ".claude", "skills"),
  ];
}

async function pathExistsOrSymlink(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isPluginManagedSkillDir(skillDir: string): Promise<boolean> {
  try {
    const stat = await lstat(skillDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    return existsSync(join(skillDir, PLUGIN_SKILL_MARKER));
  } catch {
    return false;
  }
}

export async function getBundledSkillsStatus(options?: {
  targetRoots?: string[];
  bundledRoot?: string;
}): Promise<BundledSkillsStatusOutput> {
  const targetRoots = options?.targetRoots ?? defaultSkillTargetRoots();
  const skills: BundledSkillStatusItem[] = [];

  for (const id of BUNDLED_DESIGN_SKILL_IDS) {
    let anyManaged = false;
    let anyExternal = false;
    const installedTargets: string[] = [];

    for (const root of targetRoots) {
      const dest = join(root, id);
      if (!(await pathExistsOrSymlink(dest))) continue;
      installedTargets.push(dest);
      if (await isPluginManagedSkillDir(dest)) {
        anyManaged = true;
      } else {
        anyExternal = true;
      }
    }

    const state: BundledSkillStatusItem["state"] = anyManaged
      ? "plugin-managed"
      : anyExternal
        ? "external"
        : "missing";

    skills.push({
      id,
      license: SKILL_LICENSE_BY_ID[id],
      state,
      installedTargets,
    });
  }

  return { targetRoots, skills };
}

export async function manageBundledSkills(options: {
  action: "install" | "remove";
  skillIds?: BundledDesignSkillId[];
  targetRoots?: string[];
  bundledRoot?: string;
}): Promise<BundledSkillsStatusOutput> {
  const targetRoots = options.targetRoots ?? defaultSkillTargetRoots();
  const bundledRoot = options.bundledRoot ?? locateBundledSkillsRoot();
  const selectedIds = options.skillIds ?? [...BUNDLED_DESIGN_SKILL_IDS];

  for (const id of selectedIds) {
    const srcDir = join(bundledRoot, id);
    if (!existsSync(join(srcDir, "SKILL.md"))) {
      throw new Error(`Bundled skill source not found: ${id}`);
    }

    for (const root of targetRoots) {
      const destDir = join(root, id);
      const exists = await pathExistsOrSymlink(destDir);
      const managed = exists ? await isPluginManagedSkillDir(destDir) : false;

      if (options.action === "install") {
        // Never overwrite a skill that the user installed externally.
        if (exists && !managed) continue;
        await mkdir(destDir, { recursive: true });
        const entries = await readdir(srcDir);
        for (const entry of entries) {
          await cp(join(srcDir, entry), join(destDir, entry), {
            recursive: true,
            force: true,
          });
        }
        await writeFile(
          join(destDir, PLUGIN_SKILL_MARKER),
          JSON.stringify(
            {
              managedBy: "html-prototype-annotator",
              skillId: id,
              installedAt: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      } else {
        // Only remove directories created by this plugin.
        if (!managed) continue;
        await rm(destDir, { recursive: true, force: true });
      }
    }
  }

  return getBundledSkillsStatus({ targetRoots, bundledRoot });
}
