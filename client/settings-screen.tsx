import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
} from "@getpaseo/plugin/client";
import {
  copyText,
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { isChineseLocale } from "../shared/annotations";
import {
  getBundledSkillsStatusRpc,
  manageBundledSkillsRpc,
  type BundledDesignSkillId,
  type BundledSkillsStatusOutput,
} from "../shared/rpc";
import {
  AGENT_PROTOTYPE_SNIPPET_EN,
  AGENT_PROTOTYPE_SNIPPET_ZH,
  prototypeAnnotatorSettings,
} from "../shared/settings";
import { useProtoI18n, type ProtoTextKey } from "./i18n";

const SKILL_DESC_KEY: Readonly<Record<BundledDesignSkillId, ProtoTextKey>> = {
  "html-prototype-craft": "settings.skill_html_prototype_craft_desc",
  "frontend-design": "settings.skill_frontend_design_desc",
  "baseline-ui": "settings.skill_baseline_ui_desc",
  "fixing-accessibility": "settings.skill_fixing_accessibility_desc",
  "fixing-motion-performance": "settings.skill_fixing_motion_performance_desc",
};

export function PrototypeAnnotatorSettingsScreen({
  theme,
}: PluginSurfaceProps) {
  const { t, locale } = useProtoI18n();
  const toast = useToast();
  const settings = useSettings(prototypeAnnotatorSettings);
  const fetchSkillsStatus = useRpc(getBundledSkillsStatusRpc);
  const mutateSkills = useRpc(manageBundledSkillsRpc);

  const [draftBrowserPath, setDraftBrowserPath] = useState<string | null>(null);
  const [skillsStatus, setSkillsStatus] =
    useState<BundledSkillsStatusOutput | null>(null);
  const [skillsBusy, setSkillsBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSkillsStatus({}).then(
      (res) => {
        if (!cancelled) setSkillsStatus(res);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [fetchSkillsStatus]);

  const handleSkillAction = async (
    action: "install" | "remove",
    skillIds?: BundledDesignSkillId[],
  ) => {
    setSkillsBusy(true);
    try {
      const next = await mutateSkills({ action, skillIds });
      setSkillsStatus(next);
      toast.show(t("settings.skillsUpdatedToast"), { variant: "success" });
    } catch (err) {
      toast.show(
        t("settings.skillsErrorToast", {
          error: err instanceof Error ? err.message : String(err),
        }),
        { variant: "error" },
      );
    } finally {
      setSkillsBusy(false);
    }
  };

  if (settings.status === "loading") {
    return <Loading />;
  }

  if (settings.status !== "ready") {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: theme.colors.statusDanger }}>
          {String(settings.error)}
        </Text>
      </View>
    );
  }

  const { values, revision } = settings;
  const effectiveBrowserPath = draftBrowserPath ?? values.browserExecutablePath;
  const hasMissingSkills =
    skillsStatus?.skills.some((s) => s.state === "missing") ?? true;
  const hasManagedSkills =
    skillsStatus?.skills.some((s) => s.state === "plugin-managed") ?? false;

  return (
    <View style={{ gap: 20 }}>
      <SettingsSection title={t("settings.canvasSection")}>
        <SettingsCard>
          <SettingsSelect
            label={t("settings.defaultModeLabel")}
            hint={t("settings.defaultModeHint")}
            value={values.defaultMode}
            options={[
              { value: "interact", label: t("studio.modeInteract") },
              { value: "pin", label: t("studio.modePin") },
              { value: "box", label: t("studio.modeBox") },
            ]}
            onValueChange={(next) => {
              if (next === "interact" || next === "pin" || next === "box") {
                void settings.save(
                  { ...values, defaultMode: next },
                  revision,
                );
              }
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.skillsSection")}>
        <SettingsCard>
          <SettingsAction
            label={t("settings.skillsBundleLabel")}
            hint={t("settings.skillsBundleHint")}
            actionLabel={
              hasMissingSkills
                ? t("settings.installAllBtn")
                : t("settings.removeManagedBtn")
            }
            disabled={skillsBusy || (!hasMissingSkills && !hasManagedSkills)}
            onPress={() => {
              void handleSkillAction(hasMissingSkills ? "install" : "remove");
            }}
          />
          {skillsStatus?.skills.map((skill) => (
            <SettingsAction
              key={skill.id}
              label={`/${skill.id}`}
              hint={t(SKILL_DESC_KEY[skill.id])}
              actionLabel={
                skill.state === "missing"
                  ? t("settings.installBtn")
                  : skill.state === "plugin-managed"
                    ? t("settings.removeBtn")
                    : t("settings.installedBadge")
              }
              disabled={skillsBusy || skill.state === "external"}
              onPress={() => {
                void handleSkillAction(
                  skill.state === "missing" ? "install" : "remove",
                  [skill.id],
                );
              }}
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.agentSection")}>
        <SettingsCard>
          <SettingsSwitch
            label={t("settings.injectPromptLabel")}
            hint={t("settings.injectPromptHint")}
            value={values.injectAgentPrompt}
            onValueChange={(enabled) => {
              void settings.save(
                { ...values, injectAgentPrompt: enabled },
                revision,
              );
            }}
          />
          <SettingsAction
            label={t("settings.copySnippetLabel")}
            hint={t("settings.copySnippetHint")}
            actionLabel={t("settings.copyBtn")}
            onPress={() => {
              const snippet = isChineseLocale(locale)
                ? AGENT_PROTOTYPE_SNIPPET_ZH
                : AGENT_PROTOTYPE_SNIPPET_EN;
              void copyText(snippet).then(() => {
                toast.show(t("settings.copiedSnippet"), { variant: "success" });
              });
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t("settings.mobileSection")}>
        <SettingsCard>
          <SettingsInput
            label={t("settings.browserPathLabel")}
            hint={t("settings.browserPathHint")}
            initialValue={values.browserExecutablePath}
            placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            onChangeText={(txt) => setDraftBrowserPath(txt)}
          />
          {draftBrowserPath !== null &&
          draftBrowserPath.trim() !== values.browserExecutablePath ? (
            <SettingsAction
              label={t("settings.browserPathLabel")}
              actionLabel={t("settings.saveBtn")}
              disabled={settings.saving}
              onPress={() => {
                void settings
                  .save(
                    {
                      ...values,
                      browserExecutablePath: effectiveBrowserPath.trim(),
                    },
                    revision,
                  )
                  .then((ok) => {
                    if (ok) {
                      setDraftBrowserPath(null);
                      toast.show(t("settings.savedToast"), {
                        variant: "success",
                      });
                    }
                  });
              }}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
