/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWidgetPayload } from "@/services/work-item-dashboard.service";
import type { TWorkItemType } from "@/services/work-item-type.service";

const OPEN = ["backlog", "unstarted", "started"];

/** Widgets of the ready-made bug dashboard for one project; uses its Bug type and Severity when they exist. */
export const bugDashboardWidgets = (
  projectId: string,
  types: TWorkItemType[],
  t: (key: string) => string
): TWidgetPayload[] => {
  const bug = types.find((type) => type.name.toLowerCase() === "bug");
  const severity = bug?.properties.find(
    (p) =>
      p.display_name.toLowerCase() === "severity" && (p.property_type === "OPTION" || p.property_type === "CASCADING")
  );
  const typeFilter = bug ? { type_ids: [bug.id] } : {};
  const scope = { project_ids: [projectId] };
  return [
    {
      name: t("dash.tpl_open"),
      widget_type: "NUMBER",
      width: 1,
      config: { ...scope, filters: { ...typeFilter, state_groups: OPEN } },
    },
    {
      name: t("dash.tpl_mttr"),
      widget_type: "NUMBER",
      width: 1,
      config: { ...scope, metric: "avg_resolution_days", filters: { ...typeFilter } },
    },
    {
      name: t("dash.tpl_state"),
      widget_type: "PIE",
      width: 1,
      config: { ...scope, group_by: "state_group", filters: { ...typeFilter } },
    },
    {
      name: t("dash.tpl_critical"),
      widget_type: "BAR",
      width: 1,
      config: {
        ...scope,
        group_by: severity ? `customproperty_${severity.id}` : "priority",
        filters: { ...typeFilter, state_groups: OPEN },
      },
    },
    {
      name: t("dash.tpl_trend"),
      widget_type: "LINE",
      width: 2,
      config: { ...scope, period: "week", periods: 12, filters: { ...typeFilter } },
    },
    {
      name: t("dash.tpl_assignee"),
      widget_type: "BAR",
      width: 1,
      config: { ...scope, group_by: "assignee", filters: { ...typeFilter, state_groups: OPEN } },
    },
    {
      name: t("dash.tpl_latest"),
      widget_type: "TABLE",
      width: 2,
      config: { ...scope, order_by: "priority", limit: 10, filters: { ...typeFilter, state_groups: OPEN } },
    },
  ];
};
