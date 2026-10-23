/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef } from "react";
import { observer } from "mobx-react";
import type { UseFormSetValue } from "react-hook-form";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TIssue } from "@plane/types";
import { cn } from "@plane/utils";
// hooks
import { useIssueModal } from "@/hooks/context/use-issue-modal";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemPropertyValues } from "@/services/work-item-type.service";
import { PropertyValueField } from "./property-value-field";
import { useCanSeeCustomers, visibleToViewer } from "./display-helpers";
import { WorkItemTypeDropdown } from "./type-dropdown";
import { WorkItemPropertyIcon } from "./property-icon";

type TTypeProps = {
  workspaceSlug: string;
  projectId: string | null | undefined;
  /** Passed as a value (not read through watch) so this memoised observer re-renders on change. */
  typeId: string | null | undefined;
  setValue: UseFormSetValue<TIssue>;
  disabled?: boolean;
};

/** Type picker in the modal header; keeps type_id valid for the selected project. */
export const IssueModalTypeSelect = observer(function IssueModalTypeSelect(props: TTypeProps) {
  const { workspaceSlug, projectId, typeId, setValue, disabled } = props;
  const store = useWorkItemType();

  useEffect(() => {
    if (workspaceSlug && projectId) void store.fetchProjectTypes(workspaceSlug, projectId);
  }, [store, workspaceSlug, projectId]);

  const isEnabled = store.isEnabled(projectId);
  const isTypeValid = !!typeId && !!store.getTypeById(projectId, typeId);
  const fallbackTypeId = store.getDefaultType(projectId)?.id;
  useEffect(() => {
    if (!projectId || !isEnabled || isTypeValid || !fallbackTypeId) return;
    setValue("type_id", fallbackTypeId, { shouldDirty: false });
  }, [projectId, isEnabled, isTypeValid, fallbackTypeId, setValue]);

  if (!projectId) return null;
  return (
    <WorkItemTypeDropdown
      projectId={projectId}
      value={typeId}
      onChange={(id) => setValue("type_id", id, { shouldDirty: true })}
      disabled={disabled}
      className="h-7"
    />
  );
});

type TFieldsProps = {
  workspaceSlug: string;
  projectId: string | null | undefined;
  issueId: string | undefined;
  typeId: string | null | undefined;
};

/** The selected type's custom properties inside the create/edit work item form. */
export const IssueModalCustomProperties = observer(function IssueModalCustomProperties(props: TFieldsProps) {
  const { workspaceSlug, projectId, issueId, typeId } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const { issuePropertyValues, setIssuePropertyValues, issuePropertyValueErrors, setIssuePropertyValueErrors } =
    useIssueModal();
  const values = issuePropertyValues as TWorkItemPropertyValues;
  const canSeeCustomers = useCanSeeCustomers();
  const properties = visibleToViewer(store.getActiveProperties(projectId, typeId), canSeeCustomers);
  const loadedFor = useRef<string | null>(null);

  // Start from the saved values when editing, or from the type's defaults when creating.
  useEffect(() => {
    if (!projectId || !typeId) return;
    const key = `${issueId ?? "new"}:${typeId}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setIssuePropertyValueErrors({});
    if (issueId) {
      store
        .fetchIssueValues(workspaceSlug, projectId, issueId)
        .then((saved) => setIssuePropertyValues(saved))
        .catch(() => setIssuePropertyValues({}));
    } else {
      setIssuePropertyValues(
        Object.fromEntries(
          store
            .getActiveProperties(projectId, typeId)
            .filter((p) => p.default_value.length > 0)
            .map((p) => [p.id, p.default_value])
        )
      );
    }
  }, [store, workspaceSlug, projectId, issueId, typeId, setIssuePropertyValues, setIssuePropertyValueErrors]);

  if (!projectId || properties.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {properties.map((property) => {
        const hasError = !!issuePropertyValueErrors[property.id];
        return (
          <div key={property.id} className={cn("space-y-1", property.property_type === "PARAGRAPH" && "sm:col-span-2")}>
            <label className="flex items-center gap-1 text-caption-md-medium text-secondary">
              <WorkItemPropertyIcon property={property} />
              {property.display_name}
              {property.is_required && <span className="text-danger-primary">*</span>}
            </label>
            <PropertyValueField
              property={property}
              projectId={projectId}
              value={values[property.id] ?? []}
              issueId={issueId}
              mode="form"
              hasError={hasError}
              onChange={(next) => {
                setIssuePropertyValues((prev) => ({ ...prev, [property.id]: next }));
                if (hasError && next.length)
                  setIssuePropertyValueErrors((prev) => {
                    const { [property.id]: _removed, ...rest } = prev;
                    return rest;
                  });
              }}
            />
            {hasError && (
              <p className="text-caption-sm-regular text-danger-primary">
                {t("wit.required_error", { name: property.display_name })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
});
