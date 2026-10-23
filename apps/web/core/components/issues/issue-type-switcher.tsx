/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
// store hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// components
import { IssueIdentifier } from "@/components/issues/issue-detail/issue-identifier";
import { errorMessage } from "@/components/work-item-types/constants";
import { WorkItemTypeDropdown } from "@/components/work-item-types/type-dropdown";

export type TIssueTypeSwitcherProps = {
  issueId: string;
  disabled: boolean;
};

export const IssueTypeSwitcher = observer(function IssueTypeSwitcher(props: TIssueTypeSwitcherProps) {
  const { issueId, disabled } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  // store hooks
  const {
    issue: { getIssueById, updateIssue },
  } = useIssueDetail();
  const { fetchIssueValues } = useWorkItemType();
  // derived values
  const issue = getIssueById(issueId);

  if (!issue || !issue.project_id) return <></>;
  const projectId = issue.project_id;

  const handleTypeChange = async (typeId: string) => {
    if (!workspaceSlug) return;
    try {
      await updateIssue(workspaceSlug.toString(), projectId, issueId, { type_id: typeId });
      await fetchIssueValues(workspaceSlug.toString(), projectId, issueId);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("wit.saved"), message: t("wit.change_type_hint") });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <WorkItemTypeDropdown
        projectId={projectId}
        value={issue.type_id}
        onChange={(typeId) => void handleTypeChange(typeId)}
        disabled={disabled}
      />
      <IssueIdentifier issueId={issueId} projectId={projectId} size="md" enableClickToCopyIdentifier />
    </div>
  );
});
