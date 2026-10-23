/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { Tooltip } from "@plane/propel/tooltip";
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
import { renderFormattedDate } from "@plane/utils";
// hooks
import { useMember } from "@/hooks/store/use-member";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemProperty } from "@/services/work-item-type.service";
import { isCustomPropertyShown } from "./display-helpers";
import { WorkItemPropertyIcon } from "./property-icon";

const CHIP_TYPES = new Set(["OPTION", "CASCADING", "MEMBER", "BOOLEAN", "DATE", "NUMBER", "FORMULA"]);
const MAX_CHIPS = 4;

type Props = { issue: TIssue; displayProperties: IIssueDisplayProperties | undefined };

/** Short custom property values on kanban cards and list rows (each follows its own display switch). */
export const IssueCustomPropertyChips = observer(function IssueCustomPropertyChips(props: Props) {
  const { issue, displayProperties } = props;
  const { workspaceSlug } = useParams();
  const store = useWorkItemType();
  const { getUserDetails } = useMember();
  const projectId = issue.project_id ?? undefined;
  const enabled = !!projectId && store.isEnabled(projectId);

  useEffect(() => {
    if (enabled && workspaceSlug && projectId) store.ensureProjectValues(workspaceSlug.toString(), projectId);
  }, [enabled, store, workspaceSlug, projectId]);

  if (!enabled) return null;
  const values = store.issueValues[issue.id];
  if (!values) return null;

  const text = (property: TWorkItemProperty, raw: string[]): string => {
    switch (property.property_type) {
      case "OPTION":
      case "CASCADING":
        return raw.map((id) => property.options.find((o) => o.id === id)?.name ?? "").join(", ");
      case "MEMBER":
        return raw.map((id) => getUserDetails(id)?.display_name ?? "").join(", ");
      case "BOOLEAN":
        return raw[0] === "true" ? property.display_name : "";
      case "DATE":
        return raw[0] ? (renderFormattedDate(raw[0]) ?? raw[0]) : "";
      default:
        return raw.join(", ");
    }
  };

  const chips = store
    .getActiveProperties(projectId, issue.type_id)
    .filter((property) => CHIP_TYPES.has(property.property_type))
    .filter((property) => isCustomPropertyShown(displayProperties, property.id))
    .map((property) => {
      const raw = values[property.id] ?? [];
      const option = property.property_type === "OPTION" ? property.options.find((o) => o.id === raw[0]) : undefined;
      return { property, label: text(property, raw), color: option?.color };
    })
    .filter((chip) => chip.label)
    .slice(0, MAX_CHIPS);

  return (
    <>
      {chips.map(({ property, label, color }) => (
        <Tooltip key={property.id} tooltipHeading={property.display_name} tooltipContent={label}>
          <div className="flex h-5 max-w-40 items-center gap-1 rounded-sm border-[0.5px] border-strong px-1.5 text-caption-sm-regular text-secondary">
            <WorkItemPropertyIcon property={property} className="size-3" />
            {color && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
            <span className="truncate">{label}</span>
          </div>
        </Tooltip>
      ))}
    </>
  );
});
