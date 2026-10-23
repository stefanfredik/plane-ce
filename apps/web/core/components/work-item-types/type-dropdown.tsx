/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CustomSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import { WorkItemTypeIcon } from "./type-icon";

type Props = {
  projectId: string;
  value: string | null | undefined;
  onChange: (typeId: string) => void;
  disabled?: boolean;
  className?: string;
};

/** Picks one of the project's active work item types; renders nothing when types are off. */
export const WorkItemTypeDropdown = observer(function WorkItemTypeDropdown(props: Props) {
  const { projectId, value, onChange, disabled = false, className } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const types = store.getProjectTypes(projectId).filter((type) => type.is_active || type.id === value);
  const current = store.getTypeById(projectId, value) ?? store.getDefaultType(projectId);

  if (!store.isEnabled(projectId) || types.length === 0) return null;

  return (
    <CustomSelect
      value={current?.id}
      onChange={(id: string) => id !== current?.id && onChange(id)}
      disabled={disabled}
      label={
        <span className="flex items-center gap-1.5">
          <WorkItemTypeIcon logoProps={current?.logo_props} />
          <span className="text-body-xs-medium">{current?.name ?? t("wit.type")}</span>
        </span>
      }
      buttonClassName={cn("rounded-sm border-[0.5px] border-subtle-1 px-2 py-0.5", className)}
      noChevron={disabled}
      input
    >
      {types.map((type) => (
        <CustomSelect.Option key={type.id} value={type.id}>
          <span className="flex items-center gap-2">
            <WorkItemTypeIcon logoProps={type.logo_props} />
            {type.name}
          </span>
        </CustomSelect.Option>
      ))}
    </CustomSelect>
  );
});
