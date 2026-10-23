/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Fragment } from "react";
import { observer } from "mobx-react";
import { Link } from "react-router";
import { useSearchParams } from "next/navigation";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { GroupByColumnTypes, TGroupedIssues } from "@plane/types";
import { cn } from "@plane/utils";
// components
import { IssueLayoutHOC } from "@/components/issues/issue-layouts/issue-layout-HOC";
// helpers
import { queryParamGenerator } from "@/helpers/query-param-generator";
// hooks
import { usePublish } from "@/hooks/store/publish";
import { useCycle } from "@/hooks/store/use-cycle";
import { useIssue } from "@/hooks/store/use-issue";
import { useIssueDetails } from "@/hooks/store/use-issue-details";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useStates } from "@/hooks/store/use-state";
// local
import { IssueBlockCycle } from "../properties/cycle";
import { IssueBlockDate } from "../properties/due-date";
import { IssueBlockLabels } from "../properties/labels";
import { IssueBlockMembers } from "../properties/member";
import { IssueBlockModules } from "../properties/modules";
import { IssueBlockPriority } from "../properties/priority";
import { IssueBlockState } from "../properties/state";
import { getGroupByColumns } from "../utils";
import { PublishedCustomValue } from "./custom-value";
import { usePublishedProperties } from "./use-published-properties";

type Props = { anchor: string };

/** Keeps the shared property chips at their list height inside taller table rows. */
const Chip = ({ children }: { children: React.ReactNode }) => (
  <div className="inline-flex h-5 max-w-60">{children}</div>
);

const CELL = "h-11 border-b-[0.5px] border-r-[0.5px] border-subtle px-3 align-middle whitespace-nowrap";

/** Read-only table of a published project or view, grouped by state like the list layout. */
export const IssueSpreadsheetLayoutRoot = observer(function IssueSpreadsheetLayoutRoot({ anchor }: Props) {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const board = searchParams.get("board");
  const issueStore = useIssue();
  const { getIssueById, setPeekId, getIsIssuePeeked } = useIssueDetails();
  const { project_details } = usePublish(anchor);
  const member = useMember();
  const label = useLabel();
  const cycle = useCycle();
  const modules = useModule();
  const state = useStates();

  const groupedIssueIds = (issueStore.groupedIssueIds ?? {}) as TGroupedIssues;
  const groups =
    getGroupByColumns("state" as GroupByColumnTypes, cycle, modules, label, state, member, true)?.filter(
      (group) => (issueStore.getGroupIssueCount(group.id, undefined, false) ?? 0) > 0
    ) ?? [];
  const loadedIds = groups.flatMap((group) => groupedIssueIds[group.id] ?? []);
  const { properties, values } = usePublishedProperties(anchor, loadedIds);

  const columns = [
    t("common.state"),
    t("common.priority"),
    t("common.assignees"),
    t("common.labels"),
    t("common.order_by.start_date"),
    t("common.order_by.due_date"),
    t("common.modules"),
    t("common.cycle"),
  ];
  const columnCount = 2 + columns.length + properties.length;

  return (
    <IssueLayoutHOC getGroupIssueCount={issueStore.getGroupIssueCount} getIssueLoader={issueStore.getIssueLoader}>
      <div className="vertical-scrollbar horizontal-scrollbar scrollbar-lg size-full overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-13">
          <thead className="sticky top-0 z-[2] bg-layer-1 text-left text-12 font-medium text-secondary">
            <tr>
              <th className={cn(CELL, "sticky left-0 z-[3] bg-layer-1")}>ID</th>
              <th className={cn(CELL, "min-w-72")}>{t("common.work_item")}</th>
              {columns.map((name) => (
                <th key={name} className={CELL}>
                  {name}
                </th>
              ))}
              {properties.map((property) => (
                <th key={property.id} className={CELL} title={property.description || property.name}>
                  {property.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const ids = groupedIssueIds[group.id] ?? [];
              const total = issueStore.getGroupIssueCount(group.id, undefined, false) ?? 0;
              const isLoadingMore = !!issueStore.getIssueLoader(group.id);
              return (
                <Fragment key={group.id}>
                  <tr className="bg-surface-2">
                    <td colSpan={columnCount} className="border-b-[0.5px] border-subtle px-3 py-2">
                      <span className="sticky left-3 flex items-center gap-2 text-13 font-medium text-primary">
                        {group.icon}
                        {group.name}
                        <span className="text-12 text-tertiary">{total}</span>
                      </span>
                    </td>
                  </tr>
                  {ids.map((issueId) => {
                    const issue = getIssueById(issueId);
                    if (!issue) return null;
                    const { queryParam } = queryParamGenerator(
                      board ? { board, peekId: issue.id } : { peekId: issue.id }
                    );
                    return (
                      <tr
                        key={issue.id}
                        className={cn("hover:bg-layer-transparent-hover", {
                          "bg-layer-transparent-active": getIsIssuePeeked(issue.id),
                        })}
                      >
                        <td className={cn(CELL, "sticky left-0 z-[1] bg-surface-1 text-11 font-medium text-tertiary")}>
                          {project_details?.identifier}-{issue.sequence_id}
                        </td>
                        <td className={cn(CELL, "max-w-96")}>
                          <Link
                            to={`?${queryParam}`}
                            onClick={() => setPeekId(issue.id)}
                            className="block truncate text-primary hover:underline"
                            title={issue.name}
                          >
                            {issue.name}
                          </Link>
                        </td>
                        <td className={CELL}>
                          {issue.state_id && (
                            <Chip>
                              <IssueBlockState stateId={issue.state_id} />
                            </Chip>
                          )}
                        </td>
                        <td className={CELL}>
                          <Chip>
                            <IssueBlockPriority priority={issue.priority} />
                          </Chip>
                        </td>
                        <td className={CELL}>
                          <Chip>
                            <IssueBlockMembers memberIds={issue.assignee_ids} />
                          </Chip>
                        </td>
                        <td className={CELL}>
                          <Chip>
                            <IssueBlockLabels labelIds={issue.label_ids} />
                          </Chip>
                        </td>
                        <td className={CELL}>
                          {issue.start_date && (
                            <Chip>
                              <IssueBlockDate
                                due_date={issue.start_date}
                                stateId={issue.state_id ?? undefined}
                                shouldHighLight={false}
                              />
                            </Chip>
                          )}
                        </td>
                        <td className={CELL}>
                          {issue.target_date && (
                            <Chip>
                              <IssueBlockDate due_date={issue.target_date} stateId={issue.state_id ?? undefined} />
                            </Chip>
                          )}
                        </td>
                        <td className={CELL}>
                          {issue.module_ids?.length ? (
                            <Chip>
                              <IssueBlockModules moduleIds={issue.module_ids} />
                            </Chip>
                          ) : null}
                        </td>
                        <td className={CELL}>
                          {issue.cycle_id && (
                            <Chip>
                              <IssueBlockCycle cycleId={issue.cycle_id} />
                            </Chip>
                          )}
                        </td>
                        {properties.map((property) => (
                          <td key={property.id} className={cn(CELL, "max-w-64")}>
                            <PublishedCustomValue property={property} values={values[issue.id]?.[property.id]} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                  {ids.length < total && (
                    <tr>
                      <td colSpan={columnCount} className="border-b-[0.5px] border-subtle px-3 py-2">
                        <button
                          type="button"
                          disabled={isLoadingMore}
                          onClick={() => issueStore.fetchNextPublicIssues(anchor, group.id)}
                          className="sticky left-3 text-13 font-medium text-accent-primary hover:underline disabled:opacity-60"
                        >
                          {t("common.load_more")} ↓
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </IssueLayoutHOC>
  );
});
