/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { ArrowLeft, Play, Plus } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { AlertModalCore, Input, Loader, TextArea, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
// hooks
import { useAppRouter } from "@/hooks/use-app-router";
// services
import type { TAutomation, TAutomationRun } from "@/services/automation.service";
import { AutomationService } from "@/services/automation.service";
// local imports
import { ActionRow, ConditionRow, TriggerConfig, emptyCondition } from "./automation-parts";
import { StatusBadge, emptyAction, errorText } from "./helpers";
import { ChoiceSelect } from "./select";
import { useAutomationChoices } from "./use-choices";

const service = new AutomationService();

type Props = { workspaceSlug: string; projectId: string; automationId: string };

function Block({ label, title, children }: { label: string; title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border-[0.5px] border-subtle">
      <header className="flex items-center gap-2 border-b-[0.5px] border-subtle px-4 py-2.5">
        <span className="rounded-sm bg-layer-2 px-1.5 py-0.5 text-caption-sm-medium text-secondary uppercase">
          {label}
        </span>
        {title && <span className="text-body-sm-medium text-primary">{title}</span>}
      </header>
      <div className="space-y-3 px-4 py-3">{children}</div>
    </section>
  );
}

/** One automation: If <trigger>, provided <conditions>, then <actions>; plus its run history. */
export const AutomationEditor = observer(function AutomationEditor({ workspaceSlug, projectId, automationId }: Props) {
  const { t } = useTranslation();
  const router = useAppRouter();
  const choices = useAutomationChoices(workspaceSlug, projectId);
  const [saved, setSaved] = useState<TAutomation | null>(null);
  const [draft, setDraft] = useState<TAutomation | null>(null);
  const [runs, setRuns] = useState<TAutomationRun[] | undefined>(undefined);
  const [onlyFails, setOnlyFails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const base = `/${workspaceSlug}/settings/projects/${projectId}/automations`;

  useEffect(() => {
    service
      .retrieve(workspaceSlug, projectId, automationId)
      .then((data) => {
        setSaved(data);
        setDraft(data);
        return data;
      })
      .catch(() => router.push(base));
  }, [workspaceSlug, projectId, automationId, router, base]);

  const loadRuns = useCallback(() => {
    service
      .runs(workspaceSlug, projectId, automationId, onlyFails ? "failed" : undefined)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, [workspaceSlug, projectId, automationId, onlyFails]);

  useEffect(() => loadRuns(), [loadRuns]);

  if (!draft || !saved)
    return (
      <Loader className="space-y-3">
        <Loader.Item height="60px" />
        <Loader.Item height="120px" />
        <Loader.Item height="160px" />
      </Loader>
    );

  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);
  // editing pauses while a save is in flight
  const locked = isSaving;
  const update = (changes: Partial<TAutomation>) => setDraft((prev) => (prev ? { ...prev, ...changes } : prev));

  const save = async (changes: Partial<TAutomation>, toastKey?: "enable" | "disable") => {
    setIsSaving(true);
    try {
      const next = await service.update(workspaceSlug, projectId, automationId, changes);
      setSaved(next);
      setDraft(next);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: toastKey ? t(`automations.toasts.${toastKey}.success.title`) : t("automations.custom.saved"),
        message: toastKey ? t(`automations.toasts.${toastKey}.success.message`) : undefined,
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t(`automations.toasts.${toastKey ?? "update"}.error.title`),
        message: errorText(error, t(`automations.toasts.${toastKey ?? "update"}.error.message`)),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveDraft = () =>
    save({
      name: draft.name,
      description: draft.description,
      trigger: draft.trigger,
      match: draft.match,
      conditions: draft.conditions,
      actions: draft.actions,
    });

  const runOn = async (issues: ISearchIssueResponse[]) => {
    setIsRunning(true);
    try {
      await Promise.all(issues.map((issue) => service.runNow(workspaceSlug, projectId, automationId, issue.id)));
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("automations.custom.run_started", { count: issues.length }),
      });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: errorText(error, t("toast.error")) });
    } finally {
      setIsRunning(false);
      loadRuns();
    }
  };

  const runSchedule = async () => {
    setIsRunning(true);
    try {
      const result = (await service.runNow(workspaceSlug, projectId, automationId)) as { matched: number };
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("automations.custom.run_started", { count: result.matched }) });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("toast.error"), message: errorText(error, t("toast.error")) });
    } finally {
      setIsRunning(false);
      loadRuns();
    }
  };

  return (
    <div className="space-y-4 pb-10">
      <Link
        href={base}
        className="flex w-fit items-center gap-1 text-caption-md-medium text-tertiary hover:text-primary"
      >
        <ArrowLeft className="size-3.5" />
        {t("automations.custom.back")}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <Input
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            mode="true-transparent"
            className="w-full px-0 text-h4-medium text-primary"
            placeholder={t("automations.create_modal.title.placeholder")}
            disabled={locked}
          />
          <TextArea
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            mode="true-transparent"
            className="min-h-0 w-full resize-none px-0 text-body-sm-regular text-secondary"
            placeholder={t("automations.create_modal.description.placeholder")}
            disabled={locked}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsDeleteOpen(true)}
            disabled={saved.is_enabled}
            title={saved.is_enabled ? t("automations.delete.validation.enabled") : undefined}
          >
            {t("common.actions.delete")}
          </Button>
          <div className="flex items-center gap-2 rounded-md border-[0.5px] border-subtle px-2 py-1 text-caption-md-medium text-secondary">
            {saved.is_enabled ? t("common.enabled") : t("common.disabled")}
            <ToggleSwitch
              value={saved.is_enabled}
              onChange={(value) => {
                if (value && isDirty) {
                  setToast({ type: TOAST_TYPE.WARNING, title: t("automations.custom.unsaved") });
                  return;
                }
                void save({ is_enabled: value }, value ? "enable" : "disable");
              }}
              disabled={isSaving}
            />
          </div>
        </div>
      </div>

      {!saved.is_enabled && (
        <p className="rounded-md bg-layer-1 px-3 py-2 text-caption-md-regular text-secondary">
          {t("automations.enable.alert")}
        </p>
      )}

      <Block label={t("automations.conjunctions.if")} title={t(`automations.custom.triggers.${draft.trigger.type}`)}>
        <TriggerConfig
          trigger={draft.trigger}
          onChange={(trigger) => update({ trigger })}
          choices={choices}
          disabled={locked}
        />
        {draft.trigger.type === "schedule" && (
          <p className="text-caption-sm-regular text-tertiary">{t("automations.custom.schedule_scope")}</p>
        )}
        {draft.trigger.type !== "schedule" && draft.trigger.type !== "property_changed" && (
          <p className="text-caption-sm-regular text-tertiary">
            {t("automations.trigger.warning.disabled_trigger_switching")}
          </p>
        )}
      </Block>

      <Block label={t("automations.condition.label")}>
        <div className="flex items-center gap-2 text-caption-md-regular text-secondary">
          {t("automations.custom.match_label")}
          <ChoiceSelect
            value={draft.match}
            choices={[
              { value: "all", label: t("automations.custom.match_all") },
              { value: "any", label: t("automations.custom.match_any") },
            ]}
            onChange={(match) => update({ match: match as "all" | "any" })}
            placeholder=""
            disabled={locked}
            className="min-w-28"
          />
        </div>
        {draft.conditions.length === 0 && (
          <p className="text-caption-md-regular text-tertiary">{t("automations.custom.no_conditions")}</p>
        )}
        {draft.conditions.map((condition, index) => (
          <ConditionRow
            // rows have no ids of their own and are only appended or removed
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            condition={condition}
            choices={choices}
            disabled={locked}
            onChange={(next) => update({ conditions: draft.conditions.map((c, i) => (i === index ? next : c)) })}
            onRemove={() => update({ conditions: draft.conditions.filter((_, i) => i !== index) })}
          />
        ))}
        {!locked && (
          <button
            type="button"
            className="flex items-center gap-1 text-body-xs-medium text-accent-primary"
            onClick={() => update({ conditions: [...draft.conditions, emptyCondition("state")] })}
          >
            <Plus className="size-3.5" />
            {t("automations.condition.add_condition")}
          </button>
        )}
      </Block>

      <Block label={t("automations.conjunctions.then")}>
        {draft.actions.map((action, index) => (
          <ActionRow
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            index={index}
            action={action}
            choices={choices}
            projectId={projectId}
            disabled={locked}
            onChange={(next) => update({ actions: draft.actions.map((a, i) => (i === index ? next : a)) })}
            onRemove={() => update({ actions: draft.actions.filter((_, i) => i !== index) })}
          />
        ))}
        {!locked && (
          <button
            type="button"
            className="flex items-center gap-1 text-body-xs-medium text-accent-primary"
            onClick={() => update({ actions: [...draft.actions, emptyAction("add_comment")] })}
          >
            <Plus className="size-3.5" />
            {t("automations.action.add_action")}
          </button>
        )}
      </Block>

      {isDirty && (
        <div className="sticky bottom-4 flex justify-end gap-2 rounded-lg border-[0.5px] border-subtle bg-surface-1 p-3 shadow-raised-200">
          <Button variant="secondary" onClick={() => setDraft(saved)} disabled={isSaving}>
            {t("automations.custom.discard")}
          </Button>
          <Button variant="primary" onClick={() => void saveDraft()} loading={isSaving}>
            {t("automations.custom.save")}
          </Button>
        </div>
      )}

      <section className="rounded-lg border-[0.5px] border-subtle">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b-[0.5px] border-subtle px-4 py-2.5">
          <span className="text-body-sm-medium text-primary">{t("automations.custom.runs")}</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-caption-md-regular text-secondary">
              <ToggleSwitch value={onlyFails} onChange={setOnlyFails} size="sm" />
              {t("automations.activity.filters.show_fails")}
            </label>
            <Button
              variant="secondary"
              size="sm"
              loading={isRunning}
              disabled={saved.actions.length === 0 || isDirty}
              onClick={() => (saved.trigger.type === "schedule" ? void runSchedule() : setIsPickerOpen(true))}
            >
              <Play className="size-3" />
              {saved.trigger.type === "schedule" ? t("automations.custom.run_now") : t("automations.custom.run_on")}
            </Button>
          </div>
        </header>
        {runs === undefined ? (
          <Loader className="space-y-2 p-4">
            <Loader.Item height="32px" />
          </Loader>
        ) : runs.length === 0 ? (
          <p className="px-4 py-6 text-center text-caption-md-regular text-tertiary">
            {t("automations.custom.no_runs")}
          </p>
        ) : (
          <div className="divide-y-[0.5px] divide-subtle">
            {runs.map((run) => (
              <div key={run.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2 text-body-xs-regular">
                <span className="w-36 flex-shrink-0 text-tertiary tabular-nums">
                  {new Date(run.created_at).toLocaleString()}
                </span>
                <span className="w-28 flex-shrink-0">
                  <StatusBadge status={run.status} />
                </span>
                <span className="w-40 flex-shrink-0 truncate text-secondary">
                  {run.issue ? (
                    <Link
                      href={`/${workspaceSlug}/browse/${run.issue.project_identifier}-${run.issue.sequence_id}/`}
                      className="hover:underline"
                    >
                      {run.issue.project_identifier}-{run.issue.sequence_id} {run.issue.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="w-36 flex-shrink-0 text-tertiary">
                  {t(`automations.custom.triggers.${run.event}`)}
                </span>
                <ul className="min-w-0 flex-1 space-y-0.5">
                  {run.details.map((detail, i) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <li key={i} className={cn(detail.ok ? "text-secondary" : "text-danger-primary")}>
                      {detail.message}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <ExistingIssuesListModal
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        isOpen={isPickerOpen}
        handleClose={() => setIsPickerOpen(false)}
        searchParams={{}}
        handleOnSubmit={runOn}
      />
      <AlertModalCore
        isOpen={isDeleteOpen}
        handleClose={() => setIsDeleteOpen(false)}
        handleSubmit={async () => {
          try {
            await service.remove(workspaceSlug, projectId, automationId);
            setToast({
              type: TOAST_TYPE.SUCCESS,
              title: t("automations.toasts.delete.success.title"),
              message: t("automations.toasts.delete.success.message", { name: saved.name }),
            });
            router.push(base);
          } catch (error) {
            setToast({
              type: TOAST_TYPE.ERROR,
              title: t("automations.toasts.delete.error.title"),
              message: errorText(error, t("automations.toasts.delete.error.message")),
            });
          } finally {
            setIsDeleteOpen(false);
          }
        }}
        isSubmitting={false}
        title={t("automations.delete_modal.heading")}
        content={t("automations.custom.delete_content")}
      />
    </div>
  );
});
