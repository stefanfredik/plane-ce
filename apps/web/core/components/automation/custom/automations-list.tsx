/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Plus, Zap } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EModalPosition, EModalWidth, Input, Loader, ModalCore, TextArea, ToggleSwitch } from "@plane/ui";
import { cn, renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useAppRouter } from "@/hooks/use-app-router";
// services
import type { TAutomation, TAutomationTrigger } from "@/services/automation.service";
import { AutomationService } from "@/services/automation.service";
// local imports
import { errorText, EVENT_TRIGGERS, StatusBadge, defaultTrigger } from "./helpers";
import { ChoiceSelect } from "./select";

const service = new AutomationService();

type Props = { workspaceSlug: string; projectId: string };

/** Settings > Automations: the project's custom automations. */
export const CustomAutomationsList = observer(function CustomAutomationsList({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const { getUserDetails } = useMember();
  const router = useAppRouter();
  const [automations, setAutomations] = useState<TAutomation[] | undefined>(undefined);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    service
      .list(workspaceSlug, projectId)
      .then(setAutomations)
      .catch(() => setAutomations([]));
  }, [workspaceSlug, projectId]);

  const base = `/${workspaceSlug}/settings/projects/${projectId}/automations`;

  const toggle = async (automation: TAutomation, value: boolean) => {
    try {
      const saved = await service.update(workspaceSlug, projectId, automation.id, { is_enabled: value });
      setAutomations((prev) => prev?.map((a) => (a.id === saved.id ? saved : a)));
      const key = value ? "enable" : "disable";
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t(`automations.toasts.${key}.success.title`),
        message: t(`automations.toasts.${key}.success.message`),
      });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t(`automations.toasts.${value ? "enable" : "disable"}.error.title`),
        message: errorText(error, t(`automations.toasts.${value ? "enable" : "disable"}.error.message`)),
      });
    }
  };

  return (
    <div className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-body-md-medium text-primary">{t("automations.settings.title")}</h3>
          <p className="text-caption-md-regular text-tertiary">{t("automations.custom.description")}</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-3.5" />
          {t("automations.settings.create_automation")}
        </Button>
      </div>

      {automations === undefined ? (
        <Loader className="mt-4 space-y-2">
          <Loader.Item height="44px" />
          <Loader.Item height="44px" />
        </Loader>
      ) : automations.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-1 rounded-lg border-[0.5px] border-dashed border-subtle px-4 py-8 text-center">
          <Zap className="size-5 text-placeholder" />
          <p className="text-body-sm-medium text-secondary">{t("automations.empty_state.no_automations.title")}</p>
          <p className="max-w-md text-caption-md-regular text-tertiary">
            {t("automations.empty_state.no_automations.description")}
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border-[0.5px] border-subtle">
          <table className="w-full min-w-[640px] text-left text-body-xs-regular">
            <thead className="bg-layer-1 text-caption-md-medium text-tertiary">
              <tr>
                <th className="px-3 py-2 font-medium">{t("automations.table.title")}</th>
                <th className="px-3 py-2 font-medium">{t("automations.trigger.label")}</th>
                <th className="px-3 py-2 font-medium">{t("automations.table.last_run_on")}</th>
                <th className="px-3 py-2 font-medium">{t("automations.table.last_run_status")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("automations.table.executions")}</th>
                <th className="px-3 py-2 font-medium">{t("automations.table.owner")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {automations.map((automation) => (
                <tr key={automation.id} className="border-t-[0.5px] border-subtle hover:bg-layer-1">
                  <td className="px-3 py-2">
                    <Link
                      href={`${base}/${automation.id}`}
                      className="text-body-xs-medium text-primary hover:underline"
                    >
                      {automation.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {t(`automations.custom.triggers.${automation.trigger.type}`)}
                  </td>
                  <td className="px-3 py-2 text-secondary">
                    {automation.last_run_at
                      ? renderFormattedDate(automation.last_run_at)
                      : t("automations.custom.never")}
                  </td>
                  <td className="px-3 py-2">
                    {automation.last_run_status ? <StatusBadge status={automation.last_run_status} /> : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-secondary tabular-nums">{automation.run_count}</td>
                  <td className="px-3 py-2 text-secondary">
                    {automation.created_by ? (getUserDetails(automation.created_by)?.display_name ?? "—") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <ToggleSwitch
                      value={automation.is_enabled}
                      onChange={(value) => void toggle(automation, value)}
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateAutomationModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={async (data) => {
          const created = await service.create(workspaceSlug, projectId, data);
          setToast({
            type: TOAST_TYPE.SUCCESS,
            title: t("automations.toasts.create.success.title"),
            message: t("automations.toasts.create.success.message"),
          });
          router.push(`${base}/${created.id}`);
        }}
      />
    </div>
  );
});

type TCreateProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: Partial<TAutomation>) => Promise<void>;
};

function CreateAutomationModal({ isOpen, onClose, onCreate }: TCreateProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<TAutomationTrigger["type"]>("state_changed");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nameError, setNameError] = useState(false);

  const close = () => {
    setName("");
    setDescription("");
    setTriggerType("state_changed");
    setNameError(false);
    onClose();
  };

  const submit = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({ name: name.trim(), description, trigger: defaultTrigger(triggerType), actions: [] });
      close();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("automations.toasts.create.error.title"),
        message: errorText(error, t("automations.toasts.create.error.message")),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const triggerChoices = [...EVENT_TRIGGERS, "schedule" as const].map((type) => ({
    value: type,
    label: t(`automations.custom.triggers.${type}`),
  }));

  return (
    <ModalCore isOpen={isOpen} handleClose={close} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h3 className="text-h5-medium text-primary">{t("automations.create_modal.heading.create")}</h3>
        <div className="space-y-1">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(false);
            }}
            placeholder={t("automations.create_modal.title.placeholder")}
            className={cn("w-full", nameError && "border-danger-strong")}
            hasError={nameError}
          />
          {nameError && (
            <p className="text-caption-sm-regular text-danger-primary">
              {t("automations.create_modal.title.required_error")}
            </p>
          )}
        </div>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("automations.create_modal.description.placeholder")}
          className="min-h-20 w-full"
        />
        <div className="space-y-1">
          <p className="text-caption-md-medium text-secondary">{t("automations.trigger.input_label")}</p>
          <ChoiceSelect
            value={triggerType}
            choices={triggerChoices}
            onChange={(value) => setTriggerType(value as TAutomationTrigger["type"])}
            placeholder={t("automations.trigger.input_placeholder")}
            className="w-full max-w-none"
          />
          <p className="text-caption-sm-regular text-tertiary">
            {t("automations.trigger.warning.disabled_trigger_switching")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting}>
            {t("automations.create_modal.submit_button.create")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
}
