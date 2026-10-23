/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useState } from "react";
import { observer } from "mobx-react";
// plane imports
import type { ISearchIssueResponse, TIssue, TIssuePropertyValues, TIssuePropertyValueErrors } from "@plane/types";
// components
import { IssueModalContext } from "@/components/issues/issue-modal/context";
// hooks
import { useUser } from "@/hooks/store/user/user-user";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import type { TWorkItemPropertyValues } from "@/services/work-item-type.service";

export type TIssueModalProviderProps = {
  templateId?: string;
  dataForPreload?: Partial<TIssue>;
  allowedProjectIds?: string[];
  children: React.ReactNode;
};

export const IssueModalProvider = observer(function IssueModalProvider(props: TIssueModalProviderProps) {
  const { children, allowedProjectIds } = props;
  // states
  const [selectedParentIssue, setSelectedParentIssue] = useState<ISearchIssueResponse | null>(null);
  const [issuePropertyValues, setIssuePropertyValues] = useState<TIssuePropertyValues>({});
  const [issuePropertyValueErrors, setIssuePropertyValueErrors] = useState<TIssuePropertyValueErrors>({});
  // store hooks
  const { projectsWithCreatePermissions } = useUser();
  const workItemTypes = useWorkItemType();
  // derived values
  const projectIdsWithCreatePermissions = Object.keys(projectsWithCreatePermissions ?? {});

  return (
    <IssueModalContext.Provider
      // oxlint-disable-next-line react/jsx-no-constructed-context-values
      value={{
        allowedProjectIds: allowedProjectIds ?? projectIdsWithCreatePermissions,
        workItemTemplateId: null,
        setWorkItemTemplateId: () => {},
        isApplyingTemplate: false,
        setIsApplyingTemplate: () => {},
        selectedParentIssue,
        setSelectedParentIssue,
        issuePropertyValues,
        setIssuePropertyValues,
        issuePropertyValueErrors,
        setIssuePropertyValueErrors,
        getIssueTypeIdOnProjectChange: (projectId) => workItemTypes.getDefaultType(projectId)?.id ?? null,
        getActiveAdditionalPropertiesLength: ({ projectId, watch }) =>
          workItemTypes.getActiveProperties(projectId, watch("type_id")).length,
        handlePropertyValuesValidation: ({ projectId, watch }) => {
          const values = issuePropertyValues as TWorkItemPropertyValues;
          const errors: TIssuePropertyValueErrors = {};
          for (const property of workItemTypes.getActiveProperties(projectId, watch("type_id"))) {
            if (property.is_required && !(values[property.id]?.length ?? 0))
              errors[property.id] = property.display_name;
          }
          setIssuePropertyValueErrors(errors);
          return Object.keys(errors).length === 0;
        },
        handleCreateUpdatePropertyValues: async ({ issueId, projectId, workspaceSlug, issueTypeId, isDraft }) => {
          // Drafts live outside the project until moved, so they carry no property values yet.
          if (isDraft || !issueTypeId || !workItemTypes.isEnabled(projectId)) return;
          const properties = workItemTypes.getActiveProperties(projectId, issueTypeId);
          if (properties.length === 0) return;
          const values = issuePropertyValues as TWorkItemPropertyValues;
          const payload = Object.fromEntries(properties.map((p) => [p.id, values[p.id] ?? []]));
          await workItemTypes.saveIssueValues(workspaceSlug, projectId, issueId, payload, true);
          setIssuePropertyValues({});
          setIssuePropertyValueErrors({});
        },
        handleProjectEntitiesFetch: async ({ workItemProjectId, workspaceSlug }) => {
          if (workItemProjectId) await workItemTypes.fetchProjectTypes(workspaceSlug, workItemProjectId);
        },
        handleTemplateChange: () => Promise.resolve(),
        handleConvert: () => Promise.resolve(),
        handleCreateSubWorkItem: () => Promise.resolve(),
      }}
    >
      {children}
    </IssueModalContext.Provider>
  );
});
