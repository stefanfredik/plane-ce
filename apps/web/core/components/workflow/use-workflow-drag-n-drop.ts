/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { TIssueGroupByOptions } from "@plane/types";
// hooks
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkflow } from "@/hooks/store/use-workflow";

/** Blocks dropping a work item into a state group the project's workflow does not allow. */
export const useWorkFlowFDragNDrop = (groupBy: TIssueGroupByOptions | undefined, subGroupBy?: TIssueGroupByOptions) => {
  const { workspaceSlug, projectId } = useParams();
  const { getStateById } = useProjectState();
  const { ensureWorkflow, isCreationBlocked, isMoveAllowed } = useWorkflow();
  // name of the state the dragged work item cannot leave for this group
  const [blockedSource, setBlockedSource] = useState<string | undefined>(undefined);
  const isByState = groupBy === "state" || subGroupBy === "state";

  useEffect(() => {
    if (isByState && workspaceSlug && projectId) void ensureWorkflow(workspaceSlug.toString(), projectId.toString());
  }, [ensureWorkflow, isByState, workspaceSlug, projectId]);

  const handleWorkFlowState = useCallback(
    (sourceGroupId: string, destinationGroupId: string, sourceSubGroupId?: string, destinationSubGroupId?: string) => {
      const [from, to] =
        groupBy === "state"
          ? [sourceGroupId, destinationGroupId]
          : subGroupBy === "state"
            ? [sourceSubGroupId, destinationSubGroupId]
            : [undefined, undefined];
      const blocked = !!projectId && !isMoveAllowed(projectId.toString(), from, to);
      setBlockedSource(blocked && from ? (getStateById(from)?.name ?? from) : undefined);
    },
    [getStateById, groupBy, isMoveAllowed, projectId, subGroupBy]
  );

  return {
    workflowDisabledSource: blockedSource,
    isWorkflowDropDisabled: !!blockedSource,
    getIsWorkflowWorkItemCreationDisabled: (groupId: string, subGroupId?: string) =>
      !!projectId &&
      isCreationBlocked(
        projectId.toString(),
        groupBy === "state" ? groupId : subGroupBy === "state" ? subGroupId : undefined
      ),
    handleWorkFlowState,
  };
};
