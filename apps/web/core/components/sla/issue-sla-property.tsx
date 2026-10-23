/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Timer } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Tooltip } from "@plane/propel/tooltip";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
// services
import type { TIssueSla } from "@/services/sla.service";
import { SlaService } from "@/services/sla.service";
// local imports
import { SlaStatusBadge, formatMinutes, minutesBetween } from "./helpers";

const service = new SlaService();
/** The worker updates the clock after a change; wait a moment before asking again. */
const REFRESH_DELAY_MS = 1500;

type Props = { workspaceSlug: string; projectId: string; issueId: string };

/** The work item's SLA clock in the properties sidebar; hidden when the project has no SLA for it. */
export const IssueSlaProperty = observer(function IssueSlaProperty({ workspaceSlug, projectId, issueId }: Props) {
  const { t } = useTranslation();
  const {
    issue: { getIssueById },
  } = useIssueDetail();
  const issue = getIssueById(issueId);
  const [sla, setSla] = useState<TIssueSla | null>(null);
  const [now, setNow] = useState(() => new Date());
  const stateId = issue?.state_id;
  const priority = issue?.priority;

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      service
        .issueSla(workspaceSlug, projectId, issueId)
        .then((data) => !cancelled && setSla(data))
        .catch(() => undefined);
    void load();
    const timer = setTimeout(() => void load(), REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceSlug, projectId, issueId, stateId, priority]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  if (!sla?.status) return null;

  const describe = (target: TIssueSla["response"]) => {
    if (!target.due_at || !target.status) return null;
    const due = new Date(target.due_at);
    if (target.done_at) return t("sla.issue.done", { time: new Date(target.done_at).toLocaleString() });
    const left = minutesBetween(now, due);
    return left >= 0
      ? t("sla.issue.left", { time: formatMinutes(left) })
      : t("sla.issue.over", { time: formatMinutes(-left) });
  };

  const lines = (["response", "resolution"] as const)
    .map((key) => ({ key, target: sla[key], text: describe(sla[key]) }))
    .filter((line) => line.text);

  return (
    <SidebarPropertyListItem icon={Timer} label={t("sla.label")}>
      <div className="flex w-full flex-col gap-1 px-2 py-1">
        {lines.map(({ key, target, text }) => (
          <Tooltip
            key={key}
            tooltipContent={target.due_at ? t("sla.issue.due", { time: new Date(target.due_at).toLocaleString() }) : ""}
          >
            <div className="flex items-center gap-2 text-body-xs-regular">
              {target.status && <SlaStatusBadge status={target.status} />}
              <span className="text-tertiary">{t(`sla.issue.${key}`)}</span>
              <span className="truncate text-secondary tabular-nums">{text}</span>
            </div>
          </Tooltip>
        ))}
      </div>
    </SidebarPropertyListItem>
  );
});
