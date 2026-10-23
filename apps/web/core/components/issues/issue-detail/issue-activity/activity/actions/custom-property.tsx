/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { Layers, ListPlus } from "lucide-react";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// components
import { IssueActivityBlockComponent } from "./";

type TProps = { activityId: string; ends: "top" | "bottom" | undefined };

/** A custom property value changed; the property name travels in `comment`. */
export const IssueCustomPropertyActivity = observer(function IssueCustomPropertyActivity(props: TProps) {
  const { activityId, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return <></>;

  const name = <span className="font-medium text-primary">{activity.comment}</span>;
  return (
    <IssueActivityBlockComponent
      icon={<ListPlus className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      {activity.new_value ? (
        <>
          selected <span className="font-medium whitespace-pre-line text-primary">{activity.new_value}</span> as
          value(s) for {name}.
        </>
      ) : (
        <>removed the value(s) of {name}.</>
      )}
    </IssueActivityBlockComponent>
  );
});

/** The work item moved to another type. */
export const IssueTypeActivity = observer(function IssueTypeActivity(props: TProps) {
  const { activityId, ends } = props;
  const {
    activity: { getActivityById },
  } = useIssueDetail();
  const activity = getActivityById(activityId);
  if (!activity) return <></>;

  return (
    <IssueActivityBlockComponent
      icon={<Layers className="h-3.5 w-3.5 text-secondary" aria-hidden="true" />}
      activityId={activityId}
      ends={ends}
    >
      <>
        changed the type to <span className="font-medium text-primary">{activity.new_value}</span>
        {activity.old_value ? (
          <>
            {" "}
            from <span className="font-medium text-primary">{activity.old_value}</span>
          </>
        ) : null}
        .
      </>
    </IssueActivityBlockComponent>
  );
});
