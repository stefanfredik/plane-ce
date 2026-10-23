/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Copy, ExternalLink } from "lucide-react";
// plane imports
import { SPACE_BASE_PATH, SPACE_BASE_URL } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Checkbox, CustomSelect, Input, Loader, TextArea, ToggleSwitch } from "@plane/ui";
import { copyTextToClipboard } from "@plane/utils";
// components
import { WorkItemPropertyIcon } from "@/components/work-item-types/property-icon";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// services
import type { TIntakeFormSettings } from "@/services/intake-form.service";
import { IntakeFormService } from "@/services/intake-form.service";

const service = new IntakeFormService();
/** Kinds a visitor can fill in (the server enforces the same list). */
const FORM_KINDS = new Set(["TEXT", "PARAGRAPH", "NUMBER", "OPTION", "BOOLEAN", "DATE", "URL", "EMAIL", "CASCADING"]);

const errorText = (error: unknown, fallback: string) => {
  const data = error as { errors?: Record<string, unknown>; error?: string } | undefined;
  return data?.errors ? Object.values(data.errors).map(String).join(" ") : (data?.error ?? fallback);
};

type Props = { workspaceSlug: string; projectId: string };

/** Settings > Intake: a public form whose submissions land in Intake for triage. */
export const IntakeFormSettings = observer(function IntakeFormSettings({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const typeStore = useWorkItemType();
  const { fetchProjectDetails } = useProject();
  const [form, setForm] = useState<TIntakeFormSettings | null>(null);
  const [draft, setDraft] = useState<TIntakeFormSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void typeStore.fetchProjectTypes(workspaceSlug, projectId);
    service
      .retrieve(workspaceSlug, projectId)
      .then((data) => {
        setForm(data);
        setDraft(data);
        return data;
      })
      .catch(() => setForm(null));
  }, [typeStore, workspaceSlug, projectId]);

  if (!draft || !form)
    return (
      <Loader className="mt-6">
        <Loader.Item height="120px" />
      </Loader>
    );

  const typesEnabled = typeStore.isEnabled(projectId);
  const types = typeStore.getProjectTypes(projectId).filter((type) => type.is_active);
  const formType = types.find((type) => type.id === draft.issue_type_id) ?? types.find((type) => type.is_default);
  const fields = (formType?.properties ?? []).filter((p) => p.is_active && FORM_KINDS.has(p.property_type));
  const appUrl = (SPACE_BASE_URL.trim() === "" ? window.location.origin : SPACE_BASE_URL) + SPACE_BASE_PATH;
  const link = `${appUrl}/intake/${form.anchor}`;
  const isDirty = JSON.stringify(draft) !== JSON.stringify(form);

  const save = async (changes: Partial<TIntakeFormSettings>) => {
    setIsSaving(true);
    try {
      const saved = await service.update(workspaceSlug, projectId, changes);
      setForm(saved);
      setDraft(saved);
      // turning the form on turns Intake on too
      if (saved.is_enabled) void fetchProjectDetails(workspaceSlug, projectId);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("intake_form.saved") });
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("intake_form.error"),
        message: errorText(error, t("intake_form.error")),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleField = (id: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            property_ids: prev.property_ids.includes(id)
              ? prev.property_ids.filter((p) => p !== id)
              : [...prev.property_ids, id],
          }
        : prev
    );

  return (
    <div className="mt-6 space-y-4 rounded-lg border-[0.5px] border-subtle p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-body-md-medium text-primary">{t("intake_form.title")}</h3>
          <p className="text-caption-md-regular text-tertiary">{t("intake_form.description")}</p>
        </div>
        <ToggleSwitch
          value={form.is_enabled}
          onChange={(value) => void save({ is_enabled: value })}
          disabled={isSaving}
        />
      </div>

      {form.is_enabled && (
        <div className="flex items-center gap-2 rounded-md border-[0.5px] border-strong py-1 pr-1 pl-3">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-body-sm-regular text-secondary"
          >
            {link}
          </a>
          <div className="ml-auto flex shrink-0 gap-1">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("intake_form.open")}
              className="grid size-7 place-items-center rounded-sm bg-layer-3 hover:bg-layer-3-hover"
            >
              <ExternalLink className="size-3.5" />
            </a>
            <button
              type="button"
              aria-label={t("intake_form.copy")}
              className="grid size-7 place-items-center rounded-sm bg-layer-3 hover:bg-layer-3-hover"
              onClick={() =>
                void copyTextToClipboard(link).then(() =>
                  setToast({ type: TOAST_TYPE.SUCCESS, title: t("intake_form.copied") })
                )
              }
            >
              <Copy className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-caption-md-medium text-primary" htmlFor="intake-form-title">
            {t("intake_form.form_title")}
          </label>
          <Input
            id="intake-form-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full"
            maxLength={255}
          />
        </div>
        {typesEnabled && (
          <div className="space-y-1">
            <span className="text-caption-md-medium text-primary">{t("intake_form.type")}</span>
            <CustomSelect
              value={draft.issue_type_id ?? ""}
              onChange={(value: string) => setDraft({ ...draft, issue_type_id: value || null, property_ids: [] })}
              label={<span>{formType?.name ?? "—"}</span>}
              buttonClassName="w-full justify-between"
              className="w-full"
              input
            >
              {types.map((type) => (
                <CustomSelect.Option key={type.id} value={type.id}>
                  {type.name}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
        )}
      </div>
      <div className="space-y-1">
        <label className="text-caption-md-medium text-primary" htmlFor="intake-form-description">
          {t("intake_form.intro")}
        </label>
        <TextArea
          id="intake-form-description"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className="min-h-16 w-full"
        />
      </div>
      {fields.length > 0 && (
        <div className="space-y-1">
          <span className="text-caption-md-medium text-primary">{t("intake_form.fields")}</span>
          <p className="text-caption-sm-regular text-tertiary">{t("intake_form.fields_hint")}</p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {fields.map((property) => (
              <label
                key={property.id}
                htmlFor={`intake-field-${property.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer-1"
              >
                <Checkbox
                  id={`intake-field-${property.id}`}
                  checked={draft.property_ids.includes(property.id)}
                  onChange={() => toggleField(property.id)}
                />
                <WorkItemPropertyIcon property={property} className="text-tertiary" />
                <span className="truncate text-body-sm-regular text-primary">{property.display_name}</span>
                {property.is_required && <span className="text-danger-primary">*</span>}
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1">
        <label className="text-caption-md-medium text-primary" htmlFor="intake-form-success">
          {t("intake_form.success_message")}
        </label>
        <Input
          id="intake-form-success"
          value={draft.success_message}
          onChange={(e) => setDraft({ ...draft, success_message: e.target.value })}
          placeholder={t("intake_form.success_placeholder")}
          className="w-full"
        />
      </div>
      <label
        htmlFor="intake-form-email"
        className="flex cursor-pointer items-center gap-2 text-body-sm-regular text-secondary"
      >
        <Checkbox
          id="intake-form-email"
          checked={draft.require_email}
          onChange={(e) => setDraft({ ...draft, require_email: e.target.checked })}
        />
        {t("intake_form.require_email")}
      </label>
      <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-3">
        <Button variant="secondary" onClick={() => setDraft(form)} disabled={!isDirty || isSaving}>
          {t("intake_form.reset")}
        </Button>
        <Button variant="primary" onClick={() => void save(draft)} loading={isSaving} disabled={!isDirty || isSaving}>
          {t("intake_form.save")}
        </Button>
      </div>
    </div>
  );
});
