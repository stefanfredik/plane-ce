/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TDashboardWidgetType } from "@/services/work-item-dashboard.service";

export const WIDGET_TYPES: TDashboardWidgetType[] = ["NUMBER", "BAR", "PIE", "LINE", "TABLE"];
export const GROUP_BY_OPTIONS = [
  "state_group",
  "state",
  "priority",
  "assignee",
  "label",
  "module",
  "cycle",
  "project",
  "type",
  "created_by",
  "sla_status",
] as const;
export const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"];
export const PRIORITIES = ["urgent", "high", "medium", "low", "none"];
export const TABLE_ORDERS = ["-created_at", "created_at", "-updated_at", "priority", "target_date"];
/** Fallback colours for groups that have none (assignees, labels without colour...). */
export const PALETTE = ["#3f76ff", "#f59e0b", "#16a34a", "#dc2626", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

export const errorMessage = (error: unknown, fallback: string) => {
  const data = error as { errors?: Record<string, unknown>; error?: string } | undefined;
  if (data?.errors) return Object.values(data.errors).map(String).join(" ");
  return data?.error ?? fallback;
};
