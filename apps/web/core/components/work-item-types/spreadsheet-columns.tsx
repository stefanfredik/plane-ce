/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import type { IIssueDisplayProperties, TIssue } from "@plane/types";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TPropertyColumn } from "@/store/work-item-type.store";
import { isCustomPropertyShown } from "./display-helpers";
import { PropertyValueField } from "./property-value-field";
import { WorkItemPropertyIcon } from "./property-icon";

/** One column per property of the project's pool in use (shared properties appear once), unless switched off. */
const useCustomColumns = (
  projectId: string | undefined,
  displayProperties: IIssueDisplayProperties
): TPropertyColumn[] => {
  const store = useWorkItemType();
  if (!projectId || !store.isEnabled(projectId)) return [];
  return store
    .getProjectPropertyColumns(projectId)
    .filter(({ property }) => isCustomPropertyShown(displayProperties, property.id));
};

type THeaderProps = { displayProperties: IIssueDisplayProperties };

export const SpreadsheetCustomPropertyHeaders = observer(function SpreadsheetCustomPropertyHeaders(
  props: THeaderProps
) {
  const { displayProperties } = props;
  const { workspaceSlug, projectId } = useParams();
  const store = useWorkItemType();
  const project = projectId?.toString();
  const columns = useCustomColumns(project, displayProperties);

  useEffect(() => {
    if (!workspaceSlug || !project) return;
    void store.fetchProjectTypes(workspaceSlug.toString(), project);
    void store.fetchProjectValues(workspaceSlug.toString(), project);
  }, [store, workspaceSlug, project]);

  return (
    <>
      {columns.map(({ property }) => (
        <th
          key={property.id}
          className="h-11 min-w-44 items-center border border-t-0 border-b-0 border-subtle bg-layer-1 px-4 py-1 text-left text-13 font-medium"
          title={property.description || property.display_name}
        >
          <span className="flex items-center gap-1.5">
            <WorkItemPropertyIcon property={property} className="text-tertiary" />
            <span className="truncate">{property.display_name}</span>
          </span>
        </th>
      ))}
    </>
  );
});

type TCellProps = {
  displayProperties: IIssueDisplayProperties;
  issue: TIssue;
  disabled: boolean;
};

export const SpreadsheetCustomPropertyCells = observer(function SpreadsheetCustomPropertyCells(props: TCellProps) {
  const { displayProperties, issue, disabled } = props;
  const { workspaceSlug, projectId } = useParams();
  const store = useWorkItemType();
  const columns = useCustomColumns(projectId?.toString(), displayProperties);
  if (columns.length === 0) return null;

  const values = store.issueValues[issue.id] ?? {};
  const save = (propertyId: string, next: string[]) =>
    workspaceSlug &&
    issue.project_id &&
    store.saveIssueValues(workspaceSlug.toString(), issue.project_id, issue.id, { [propertyId]: next }).catch(() => {
      void store.fetchIssueValues(workspaceSlug.toString(), issue.project_id as string, issue.id);
    });

  return (
    <>
      {columns.map(({ property, typeIds }) => {
        const appliesToIssue = !!issue.type_id && typeIds.includes(issue.type_id);
        const value = values[property.id] ?? [];
        return (
          <td
            key={property.id}
            className="h-11 max-w-60 min-w-44 border-r-[1px] border-subtle text-13 after:absolute after:bottom-[-1px] after:w-full after:border after:border-subtle"
          >
            {/* the row line is drawn by this wrapper, like the built-in columns */}
            <div className="flex h-11 items-center border-b-[0.5px] border-subtle">
              <div className="w-full min-w-0 px-2">
                {!appliesToIssue ? null : property.property_type === "PARAGRAPH" ? (
                  // Long text is read here and edited in the work item itself.
                  <span className="block truncate px-2 text-secondary" title={value[0] ?? ""}>
                    {value[0] ?? ""}
                  </span>
                ) : (
                  <PropertyValueField
                    property={property}
                    projectId={issue.project_id as string}
                    value={value}
                    onChange={(next) => void save(property.id, next)}
                    issueId={issue.id}
                    mode="inline"
                    disabled={disabled}
                  />
                )}
              </div>
            </div>
          </td>
        );
      })}
    </>
  );
});
