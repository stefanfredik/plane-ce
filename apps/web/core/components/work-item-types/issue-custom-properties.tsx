/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import { errorMessage } from "./constants";
import { useCanSeeCustomers, visibleToViewer } from "./display-helpers";
import { PropertyValueField } from "./property-value-field";
import { WorkItemPropertyIcon } from "./property-icon";

type Props = {
  workspaceSlug: string;
  projectId: string;
  issueId: string;
  typeId: string | null | undefined;
  disabled: boolean;
  /** "sidebar" lines label and field up like the built-in properties; "stack" puts the label above. */
  layout?: "sidebar" | "stack";
};

/** The custom properties of a work item's type, editable in place. */
export const IssueCustomProperties = observer(function IssueCustomProperties(props: Props) {
  const { workspaceSlug, projectId, issueId, typeId, disabled, layout = "sidebar" } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const issueType = store.getTypeById(projectId, typeId);
  const canSeeCustomers = useCanSeeCustomers();
  const properties = visibleToViewer(store.getActiveProperties(projectId, typeId), canSeeCustomers);
  const values = store.issueValues[issueId];
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    void store.fetchProjectTypes(workspaceSlug, projectId);
  }, [store, workspaceSlug, projectId]);

  useEffect(() => {
    if (typeId) void store.fetchIssueValues(workspaceSlug, projectId, issueId);
  }, [store, workspaceSlug, projectId, issueId, typeId]);

  if (!store.isEnabled(projectId) || !issueType || properties.length === 0) return null;

  const save = async (propertyId: string, next: string[]) => {
    try {
      await store.saveIssueValues(workspaceSlug, projectId, issueId, { [propertyId]: next });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
      // put the stored value back into the field
      void store.fetchIssueValues(workspaceSlug, projectId, issueId);
    }
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex items-center gap-1 py-1 text-body-xs-medium text-primary"
      >
        {t("wit.custom_properties")}
        <ChevronDown className={cn("size-3.5 transition-transform", !isOpen && "-rotate-90")} />
      </button>
      {isOpen &&
        properties.map((property) => {
          const value = values?.[property.id] ?? [];
          const isWide = property.property_type === "PARAGRAPH" || layout === "stack";
          return (
            <div key={property.id} className={cn(isWide ? "space-y-1" : "flex min-h-8 items-start gap-2")}>
              <div
                className={cn(
                  "flex shrink-0 items-center gap-1 text-body-xs-regular text-tertiary",
                  isWide ? "" : "w-2/5 pt-1.5"
                )}
                title={property.display_name}
              >
                <WorkItemPropertyIcon property={property} />
                <span className="truncate">{property.display_name}</span>
                {property.is_required && <span className="text-danger-primary">*</span>}
                {property.description && (
                  <Tooltip tooltipContent={property.description}>
                    <Info className="size-3 shrink-0 text-placeholder" />
                  </Tooltip>
                )}
              </div>
              <div className={cn("min-w-0", isWide ? "w-full" : "w-3/5 grow")}>
                <PropertyValueField
                  property={property}
                  projectId={projectId}
                  value={value}
                  onChange={(next) => void save(property.id, next)}
                  issueId={issueId}
                  mode="inline"
                  disabled={disabled}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
});
