/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import type { TIssueIdentifierProps } from "@plane/types";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { IdentifierText } from "@/components/issues/issue-detail/identifier-text";
import { WorkItemTypeIcon } from "@/components/work-item-types/type-icon";

export const IssueIdentifier = observer(function IssueIdentifier(props: TIssueIdentifierProps) {
  const { projectId, variant, size, displayProperties, enableClickToCopyIdentifier = false } = props;
  // store hooks
  const { getProjectIdentifierById } = useProject();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const { getTypeById, isEnabled } = useWorkItemType();
  // Determine if the component is using store data or not
  const isUsingStoreData = "issueId" in props;
  // derived values
  const issue = isUsingStoreData ? getIssueById(props.issueId) : null;
  const projectIdentifier = isUsingStoreData ? getProjectIdentifierById(projectId) : props.projectIdentifier;
  const issueSequenceId = isUsingStoreData ? issue?.sequence_id : props.issueSequenceId;
  const shouldRenderIssueID = displayProperties ? displayProperties.key : true;
  // Layouts opt in to showing the work item type through the "Work item Type" display property.
  const workItemType =
    displayProperties?.issue_type && isEnabled(projectId) ? getTypeById(projectId, issue?.type_id) : undefined;

  if (!shouldRenderIssueID && !workItemType) return null;

  return (
    <div className="flex shrink-0 items-center space-x-2">
      {workItemType && (
        <span className="flex items-center gap-1 text-caption-sm-medium text-tertiary" title={workItemType.name}>
          <WorkItemTypeIcon logoProps={workItemType.logo_props} />
          {workItemType.name}
        </span>
      )}
      {shouldRenderIssueID && (
        <IdentifierText
          identifier={`${projectIdentifier}-${issueSequenceId}`}
          enableClickToCopyIdentifier={enableClickToCopyIdentifier}
          variant={variant}
          size={size}
        />
      )}
    </div>
  );
});
