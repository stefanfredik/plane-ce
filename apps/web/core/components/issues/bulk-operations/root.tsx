/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useContext, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { errorMessage } from "@/components/work-item-types/constants";
// hooks
import { useMultipleSelectStore } from "@/hooks/store/use-multiple-select-store";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import type { TSelectionHelper } from "@/hooks/use-multiple-select";
import { StoreContext } from "@/lib/store-context";
import { WorkItemTypeIcon } from "@/components/work-item-types/type-icon";

type Props = {
  className?: string;
  selectionHelpers: TSelectionHelper;
};

/** Actions on the selected work items; changing the type is available in typed projects. */
export const IssueBulkOperationsRoot = observer(function IssueBulkOperationsRoot(props: Props) {
  const { className, selectionHelpers } = props;
  const { workspaceSlug, projectId } = useParams();
  const { t } = useTranslation();
  // store hooks
  const { isSelectionActive, selectedEntityIds } = useMultipleSelectStore();
  const workItemTypes = useWorkItemType();
  const rootStore = useContext(StoreContext);
  const [isSaving, setIsSaving] = useState(false);

  if (!isSelectionActive || selectionHelpers.isSelectionDisabled) return null;

  const project = projectId?.toString();
  const types = project && workItemTypes.isEnabled(project) ? workItemTypes.getProjectTypes(project) : [];
  const activeTypes = types.filter((type) => type.is_active);

  const handleChangeType = async (typeId: string) => {
    if (!workspaceSlug || !project || selectedEntityIds.length === 0) return;
    setIsSaving(true);
    try {
      const updated = await workItemTypes.bulkAssign(workspaceSlug.toString(), project, typeId, selectedEntityIds);
      for (const issueId of selectedEntityIds) rootStore?.issue.issues.updateIssue(issueId, { type_id: typeId });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("wit.saved"),
        message: t("wit.bulk_type_changed", { count: updated }),
      });
      selectionHelpers.handleClearSelection();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn("sticky bottom-0 left-0 z-[2] px-3.5 py-3", className)}>
      <div className="flex w-full flex-wrap items-center gap-3 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 px-3.5 py-2.5 shadow-raised-100">
        <span className="text-body-sm-medium text-primary">
          {t("wit.selected_count", { count: selectedEntityIds.length })}
        </span>
        {activeTypes.length > 0 && (
          <CustomSelect
            value={undefined}
            onChange={(typeId: string) => void handleChangeType(typeId)}
            disabled={isSaving}
            label={<span className="text-body-sm-regular">{isSaving ? t("wit.saving") : t("wit.change_type")}</span>}
            buttonClassName="rounded-md border-[0.5px] border-subtle-1 px-2.5 py-1"
            placement="top-start"
          >
            {activeTypes.map((type) => (
              <CustomSelect.Option key={type.id} value={type.id}>
                <span className="flex items-center gap-2">
                  <WorkItemTypeIcon logoProps={type.logo_props} />
                  {type.name}
                </span>
              </CustomSelect.Option>
            ))}
          </CustomSelect>
        )}
        <button
          type="button"
          onClick={selectionHelpers.handleClearSelection}
          className="ml-auto flex items-center gap-1 rounded-sm px-2 py-1 text-body-sm-regular text-secondary hover:bg-layer-1"
        >
          <X className="size-3.5" />
          {t("wit.clear_selection")}
        </button>
      </div>
    </div>
  );
});
