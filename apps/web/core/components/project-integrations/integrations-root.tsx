/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
// plane imports
import { API_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Checkbox, Input, Loader, ToggleSwitch } from "@plane/ui";
import { copyTextToClipboard } from "@plane/utils";
// components
import { ChoiceMultiSelect, ChoiceSelect } from "@/components/automation/custom/select";
import { useAutomationChoices } from "@/components/automation/custom/use-choices";
// hooks
import { useProject } from "@/hooks/store/use-project";
// services
import type { TProjectIntegration, TIntegrationProvider } from "@/services/project-integration.service";
import { ProjectIntegrationService } from "@/services/project-integration.service";

const service = new ProjectIntegrationService();
const SENTRY_LEVELS = ["fatal", "error", "warning", "info", "debug"] as const;

type Props = { workspaceSlug: string; projectId: string };

const errorText = (error: unknown, fallback: string) => (error as { error?: string } | undefined)?.error ?? fallback;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-48 flex-shrink-0 text-caption-md-regular text-secondary">{label}</span>
      {children}
    </div>
  );
}

function CopyBox({ value, secret = false }: { value: string; secret?: boolean }) {
  const { t } = useTranslation();
  const [isShown, setIsShown] = useState(!secret);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 rounded-md border-[0.5px] border-strong py-1 pr-1 pl-3">
      <code className="min-w-0 flex-1 truncate text-body-xs-regular text-secondary">
        {isShown ? value : "•".repeat(24)}
      </code>
      {secret && (
        <button
          type="button"
          className="rounded-sm p-1 text-tertiary hover:bg-layer-1"
          onClick={() => setIsShown((v) => !v)}
          aria-label={isShown ? "Hide" : "Show"}
        >
          {isShown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
      <button
        type="button"
        className="rounded-sm p-1 text-tertiary hover:bg-layer-1"
        aria-label={t("project_integrations.copy")}
        onClick={() =>
          void copyTextToClipboard(value).then(() =>
            setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_integrations.copied") })
          )
        }
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** Settings > Integrations: GitLab and Sentry webhooks for this project. */
export const ProjectIntegrationsRoot = observer(function ProjectIntegrationsRoot({ workspaceSlug, projectId }: Props) {
  const [integrations, setIntegrations] = useState<Partial<Record<TIntegrationProvider, TProjectIntegration>>>({});

  useEffect(() => {
    for (const provider of ["gitlab", "sentry"] as const)
      service
        .retrieve(workspaceSlug, projectId, provider)
        .then((data) => setIntegrations((prev) => ({ ...prev, [provider]: data })))
        .catch(() => undefined);
  }, [workspaceSlug, projectId]);

  return (
    <div className="mt-6 space-y-4">
      {(["gitlab", "sentry"] as const).map((provider) => {
        const integration = integrations[provider];
        return integration ? (
          <IntegrationCard
            key={provider}
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            integration={integration}
            onSaved={(data) => setIntegrations((prev) => ({ ...prev, [provider]: data }))}
          />
        ) : (
          <Loader key={provider}>
            <Loader.Item height="180px" />
          </Loader>
        );
      })}
    </div>
  );
});

type TCardProps = Props & {
  integration: TProjectIntegration;
  onSaved: (data: TProjectIntegration) => void;
};

const IntegrationCard = observer(function IntegrationCard(props: TCardProps) {
  const { workspaceSlug, projectId, integration, onSaved } = props;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const choices = useAutomationChoices(workspaceSlug, projectId);
  const [isSaving, setIsSaving] = useState(false);
  const [sentrySecret, setSentrySecret] = useState("");
  const provider = integration.provider;
  const config = integration.config;
  const origin = API_BASE_URL.trim() === "" ? window.location.origin : API_BASE_URL;
  const noChange = { value: "", label: t("project_integrations.no_change") };
  const stateChoices = [noChange, ...choices.states];

  const save = async (data: Parameters<typeof service.update>[3]) => {
    setIsSaving(true);
    try {
      const saved = await service.update(workspaceSlug, projectId, provider, data);
      onSaved(saved);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("project_integrations.saved") });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("project_integrations.error"),
        message: errorText(error, t("project_integrations.error")),
      });
    } finally {
      setIsSaving(false);
    }
  };
  const saveConfig = (changes: Record<string, unknown>) => void save({ config: changes });

  return (
    <div className="space-y-4 rounded-lg border-[0.5px] border-subtle p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-body-md-medium text-primary">{t(`project_integrations.${provider}.title`)}</h3>
          <p className="text-caption-md-regular text-tertiary">
            {t(`project_integrations.${provider}.description`, { identifier: currentProjectDetails?.identifier ?? "" })}
          </p>
        </div>
        <ToggleSwitch
          value={integration.is_enabled}
          onChange={(value) => void save({ is_enabled: value })}
          disabled={isSaving}
        />
      </div>

      <div className="space-y-2">
        <Field label={t("project_integrations.webhook_url")}>
          <CopyBox value={`${origin}${integration.webhook_path}`} />
        </Field>
        {provider === "gitlab" ? (
          <Field label={t("project_integrations.secret_token")}>
            <CopyBox value={integration.secret ?? ""} secret />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void save({ rotate_secret: true })}
              disabled={isSaving}
            >
              <RefreshCw className="size-3" />
              {t("project_integrations.rotate")}
            </Button>
          </Field>
        ) : (
          <Field label={t("project_integrations.sentry.client_secret")}>
            <Input
              type="password"
              autoComplete="off"
              value={sentrySecret}
              onChange={(e) => setSentrySecret(e.target.value)}
              placeholder={
                integration.has_secret
                  ? t("project_integrations.sentry.secret_set")
                  : t("project_integrations.sentry.secret_placeholder")
              }
              className="min-w-64 flex-1 px-2 py-1 text-body-xs-regular"
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!sentrySecret.trim() || isSaving}
              onClick={() => {
                void save({ secret: sentrySecret.trim() });
                setSentrySecret("");
              }}
            >
              {t("automations.custom.save")}
            </Button>
          </Field>
        )}
        <p className="text-caption-sm-regular text-tertiary">
          <span className="font-medium text-secondary">{t("project_integrations.setup")}: </span>
          {t(`project_integrations.${provider}.setup`)}
        </p>
      </div>

      <div className="space-y-2 border-t-[0.5px] border-subtle pt-3">
        {provider === "gitlab" ? (
          <>
            {(["mr_opened", "mr_merged", "mr_closed"] as const).map((key) => (
              <Field
                key={key}
                label={t(
                  `project_integrations.gitlab.${key === "mr_opened" ? "on_open" : key === "mr_merged" ? "on_merge" : "on_close"}`
                )}
              >
                <ChoiceSelect
                  value={config.states?.[key] ?? ""}
                  choices={stateChoices}
                  onChange={(value) => saveConfig({ states: { ...config.states, [key]: value || null } })}
                  placeholder={t("project_integrations.no_change")}
                  disabled={isSaving}
                />
              </Field>
            ))}
            <label className="flex items-center gap-2 text-caption-md-regular text-secondary">
              <Checkbox
                checked={!!config.post_comments}
                onChange={(e) => saveConfig({ post_comments: e.target.checked })}
                disabled={isSaving}
              />
              {t("project_integrations.gitlab.post_comments")}
            </label>
          </>
        ) : (
          <>
            {choices.types.length > 0 && (
              <Field label={t("project_integrations.sentry.type")}>
                <ChoiceSelect
                  value={config.issue_type_id ?? undefined}
                  choices={choices.types}
                  onChange={(issue_type_id) => saveConfig({ issue_type_id })}
                  placeholder={t("project_integrations.sentry.default_state")}
                  disabled={isSaving}
                />
              </Field>
            )}
            <Field label={t("project_integrations.sentry.state")}>
              <ChoiceSelect
                value={config.state_id ?? ""}
                choices={[{ value: "", label: t("project_integrations.sentry.default_state") }, ...choices.states]}
                onChange={(value) => saveConfig({ state_id: value || null })}
                placeholder={t("project_integrations.sentry.default_state")}
                disabled={isSaving}
              />
            </Field>
            <Field label={t("project_integrations.sentry.resolved")}>
              <ChoiceSelect
                value={config.resolved_state_id ?? ""}
                choices={stateChoices}
                onChange={(value) => saveConfig({ resolved_state_id: value || null })}
                placeholder={t("project_integrations.no_change")}
                disabled={isSaving}
              />
            </Field>
            <Field label={t("project_integrations.sentry.reopened")}>
              <ChoiceSelect
                value={config.reopened_state_id ?? ""}
                choices={stateChoices}
                onChange={(value) => saveConfig({ reopened_state_id: value || null })}
                placeholder={t("project_integrations.no_change")}
                disabled={isSaving}
              />
            </Field>
            <Field label={t("project_integrations.sentry.assignees")}>
              <ChoiceMultiSelect
                value={config.assignee_ids ?? []}
                choices={choices.members}
                onChange={(assignee_ids) => saveConfig({ assignee_ids })}
                placeholder={t("automations.custom.select")}
                disabled={isSaving}
              />
            </Field>
            <Field label={t("project_integrations.sentry.labels")}>
              <ChoiceMultiSelect
                value={config.label_ids ?? []}
                choices={choices.labels}
                onChange={(label_ids) => saveConfig({ label_ids })}
                placeholder={t("automations.custom.select")}
                disabled={isSaving}
              />
            </Field>
            <Field label={t("project_integrations.sentry.priorities")}>
              <div className="flex flex-wrap gap-2">
                {SENTRY_LEVELS.map((level) => (
                  <span key={level} className="flex items-center gap-1 text-caption-md-regular text-tertiary">
                    {level}
                    <ChoiceSelect
                      value={config.priorities?.[level]}
                      choices={choices.priorities}
                      onChange={(priority) => saveConfig({ priorities: { ...config.priorities, [level]: priority } })}
                      placeholder=""
                      disabled={isSaving}
                      className="min-w-24"
                    />
                  </span>
                ))}
              </div>
            </Field>
          </>
        )}
      </div>

      <p className="text-caption-sm-regular text-tertiary">
        {integration.last_event_at
          ? t("project_integrations.last_event", {
              event: integration.last_event ?? "",
              time: new Date(integration.last_event_at).toLocaleString(),
            })
          : t("project_integrations.no_event")}
      </p>
    </div>
  );
});
