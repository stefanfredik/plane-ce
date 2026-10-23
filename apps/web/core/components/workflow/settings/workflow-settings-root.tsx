/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Info, Plus, RotateCcw, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { StateGroupIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import type { IState } from "@plane/types";
import { AlertModalCore, CustomSearchSelect, Loader, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useWorkflow } from "@/hooks/store/use-workflow";
// services
import type { TWorkflowRule } from "@/services/workflow.service";

const BUILTIN_REQUIREMENTS = ["assignees", "target_date", "estimate_point"] as const;
const EMPTY_RULE: TWorkflowRule = { allow_creation: true, transitions: {}, require: [] };

type Props = { workspaceSlug: string; projectId: string; isAdmin: boolean };

function StateName({ state }: { state: IState | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <StateGroupIcon
        stateGroup={state?.group ?? "backlog"}
        color={state?.color}
        className="size-3.5 flex-shrink-0"
        percentage={state?.order}
      />
      <span className="truncate">{state?.name ?? "—"}</span>
    </span>
  );
}

/** Settings > Workflows: per state, the permitted moves out of it, their reviewers, and what must be filled first. */
export const WorkflowSettingsRoot = observer(function WorkflowSettingsRoot({
  workspaceSlug,
  projectId,
  isAdmin,
}: Props) {
  const { t } = useTranslation();
  const { fetchWorkflow, getWorkflow, updateWorkflow } = useWorkflow();
  const { fetchProjectStates, getProjectStates, getStateById } = useProjectState();
  const typeStore = useWorkItemType();
  const [isSaving, setIsSaving] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);

  useEffect(() => {
    void fetchWorkflow(workspaceSlug, projectId).catch(() => undefined);
    void fetchProjectStates(workspaceSlug, projectId);
    void typeStore.fetchProjectProperties(workspaceSlug, projectId).catch(() => undefined);
  }, [fetchWorkflow, fetchProjectStates, typeStore, workspaceSlug, projectId]);

  const workflow = getWorkflow(projectId);
  const states = getProjectStates(projectId);
  if (!workflow || !states)
    return (
      <Loader className="mt-6 space-y-3">
        <Loader.Item height="56px" />
        <Loader.Item height="120px" />
        <Loader.Item height="120px" />
      </Loader>
    );

  const properties = (typeStore.projectProperties[projectId] ?? []).filter((p) => p.is_active);
  const requirementName = (key: string) =>
    (BUILTIN_REQUIREMENTS as readonly string[]).includes(key)
      ? t(`workflows.settings.fields.${key}`)
      : properties.find((p) => p.id === key)?.display_name;
  const requirementOptions = [
    ...BUILTIN_REQUIREMENTS.map((key) => ({
      value: key,
      query: requirementName(key) ?? key,
      content: requirementName(key),
    })),
    ...properties.map((p) => ({ value: p.id, query: p.display_name, content: p.display_name })),
  ];

  const save = async (data: Parameters<typeof updateWorkflow>[2], successMessage?: string) => {
    setIsSaving(true);
    try {
      await updateWorkflow(workspaceSlug, projectId, data);
      if (successMessage)
        setToast({
          type: TOAST_TYPE.SUCCESS,
          title: t("workflows.toasts.reset.success.title"),
          message: successMessage,
        });
    } catch (error) {
      const message = (error as { error?: string } | undefined)?.error;
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("workflows.toasts.modify_state_change_rule.error.title"),
        message: message ?? t("workflows.toasts.modify_state_change_rule.error.message"),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const ruleOf = (stateId: string): TWorkflowRule => ({ ...EMPTY_RULE, ...workflow.rules[stateId] });
  const saveRule = (stateId: string, changes: Partial<TWorkflowRule>) =>
    save({ rules: { ...workflow.rules, [stateId]: { ...ruleOf(stateId), ...changes } } });

  const toggleEnabled = async (value: boolean) => {
    const action = value ? "enabled" : "disabled";
    setIsSaving(true);
    try {
      await updateWorkflow(workspaceSlug, projectId, { is_enabled: value });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("workflows.toasts.enable_disable.success.title"),
        message: t("workflows.toasts.enable_disable.success.message", { action }),
      });
    } catch {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("workflows.toasts.enable_disable.error.title"),
        message: t("workflows.toasts.enable_disable.error.message", { action }),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = !isAdmin || isSaving;

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border-[0.5px] border-subtle p-4">
        <div>
          <h3 className="text-body-md-medium text-primary">{t("workflows.settings.enable")}</h3>
          <p className="text-caption-md-regular text-tertiary">{t("workflows.settings.enable_description")}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {isAdmin && Object.keys(workflow.rules).length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setIsResetOpen(true)} disabled={isSaving}>
              <RotateCcw className="size-3.5" />
              {t("workflows.quick_actions.reset_workflow")}
            </Button>
          )}
          <ToggleSwitch
            value={workflow.is_enabled}
            onChange={(value) => void toggleEnabled(value)}
            disabled={disabled}
          />
        </div>
      </div>

      <div className={cn("space-y-3", !workflow.is_enabled && "opacity-70")}>
        {states.map((state) => {
          const rule = ruleOf(state.id);
          // listed in the project's state order (the server does not keep key order)
          const targets = states.filter((s) => rule.transitions[s.id]).map((s) => s.id);
          const unused = states.filter((s) => s.id !== state.id && !rule.transitions[s.id]);
          const stateOptions = (current?: string) =>
            states
              .filter((s) => s.id !== state.id && (s.id === current || !rule.transitions[s.id]))
              .map((s) => ({ value: s.id, query: s.name, content: <StateName state={s} /> }));
          const renameTarget = (from: string, to: string) => {
            const transitions = Object.fromEntries(
              Object.entries(rule.transitions).map(([id, transition]) => [id === from ? to : id, transition])
            );
            void saveRule(state.id, { transitions });
          };

          return (
            <div key={state.id} className="rounded-lg border-[0.5px] border-subtle">
              <div className="flex items-center justify-between gap-3 border-b-[0.5px] border-subtle px-4 py-3">
                <div className="flex min-w-0 items-center gap-2 text-body-sm-regular">
                  <span className="flex-shrink-0 text-tertiary">{t("workflows.workflow_tree.label")}</span>
                  <span className="text-body-sm-medium text-primary">
                    <StateName state={state} />
                  </span>
                  <span className="flex-shrink-0 text-caption-md-regular text-placeholder">
                    · {t("workflows.workflow_states.state_change_count", { count: targets.length })}
                  </span>
                </div>
                <Tooltip
                  tooltipContent={
                    state.default
                      ? t("workflows.workflow_states.default_state")
                      : t("workflows.workflow_states.work_item_creation")
                  }
                >
                  <div className="flex flex-shrink-0 items-center gap-2 text-caption-md-regular text-secondary">
                    <span className="hidden sm:inline">{t("workflows.workflow_states.work_item_creation")}</span>
                    <ToggleSwitch
                      size="sm"
                      value={state.default || rule.allow_creation}
                      onChange={(value) => void saveRule(state.id, { allow_creation: value })}
                      disabled={disabled || state.default}
                    />
                  </div>
                </Tooltip>
              </div>

              <div className="space-y-2 px-4 py-3">
                <p className="text-caption-md-regular text-tertiary">
                  {targets.length === 0
                    ? t("workflows.settings.free_moves")
                    : t("workflows.workflow_tree.state_change_label")}
                </p>
                {targets.map((targetId) => (
                  <div key={targetId} className="flex flex-wrap items-center gap-2">
                    <span className="text-caption-md-regular text-tertiary">
                      {t("workflows.workflow_states.state_changes.move_to")}
                    </span>
                    <CustomSearchSelect
                      value={targetId}
                      options={stateOptions(targetId)}
                      onChange={(value: string) => value && value !== targetId && renameTarget(targetId, value)}
                      label={<StateName state={getStateById(targetId)} />}
                      buttonClassName="border-[0.5px] border-subtle-1 px-2 py-1 text-body-xs-regular min-w-36"
                      disabled={disabled}
                      input
                    />
                    <Tooltip tooltipContent={t("workflows.workflow_states.state_changes.movers.tooltip")}>
                      <span className="text-caption-md-regular text-tertiary">
                        {t("workflows.workflow_states.state_changes.movers.label")}
                      </span>
                    </Tooltip>
                    <MemberDropdown
                      multiple
                      projectId={projectId}
                      value={rule.transitions[targetId]?.movers ?? []}
                      onChange={(movers: string[]) =>
                        void saveRule(state.id, { transitions: { ...rule.transitions, [targetId]: { movers } } })
                      }
                      buttonVariant="border-with-text"
                      placeholder={t("workflows.settings.anyone")}
                      disabled={disabled}
                    />
                    {isAdmin && (
                      <button
                        type="button"
                        className="rounded-sm p-1 text-tertiary hover:bg-layer-1 hover:text-danger-primary"
                        aria-label={t("common.actions.delete")}
                        disabled={isSaving}
                        onClick={() => {
                          const { [targetId]: _removed, ...transitions } = rule.transitions;
                          void saveRule(state.id, { transitions });
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                {isAdmin && unused.length > 0 && (
                  <CustomSearchSelect
                    value={undefined}
                    options={stateOptions()}
                    onChange={(value: string) =>
                      value &&
                      void saveRule(state.id, { transitions: { ...rule.transitions, [value]: { movers: [] } } })
                    }
                    customButton={
                      <span className="flex items-center gap-1 text-body-xs-medium text-accent-primary">
                        <Plus className="size-3.5" />
                        {t("workflows.workflow_states.state_changes.label.default")}
                      </span>
                    }
                    disabled={isSaving}
                    input
                  />
                )}

                <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-subtle pt-3">
                  <Tooltip tooltipContent={t("workflows.settings.requires_tooltip")}>
                    <span className="flex items-center gap-1 text-caption-md-regular text-tertiary">
                      {t("workflows.settings.requires")}
                      <Info className="size-3" />
                    </span>
                  </Tooltip>
                  <CustomSearchSelect
                    multiple
                    value={rule.require}
                    options={requirementOptions}
                    onChange={(require: string[]) => void saveRule(state.id, { require })}
                    label={
                      <span className={cn("truncate", rule.require.length === 0 && "text-placeholder")}>
                        {rule.require.length
                          ? rule.require.map((key) => requirementName(key) ?? "—").join(", ")
                          : t("workflows.settings.requires_none")}
                      </span>
                    }
                    buttonClassName="border-[0.5px] border-subtle-1 px-2 py-1 text-body-xs-regular min-w-36 max-w-80"
                    disabled={disabled}
                    input
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <AlertModalCore
        isOpen={isResetOpen}
        handleClose={() => setIsResetOpen(false)}
        handleSubmit={async () => {
          await save({ rules: {} }, t("workflows.toasts.reset.success.message"));
          setIsResetOpen(false);
        }}
        isSubmitting={isSaving}
        title={t("workflows.confirmation_modals.reset_workflow.title")}
        content={t("workflows.confirmation_modals.reset_workflow.description")}
      />
    </div>
  );
});
