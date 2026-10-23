/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TDashboardWidgetType = "NUMBER" | "BAR" | "PIE" | "LINE" | "TABLE";

export type TDashboardWidgetConfig = {
  project_ids?: string[];
  filters?: {
    type_ids?: string[];
    state_groups?: string[];
    priorities?: string[];
    label_ids?: string[];
    assignee_ids?: string[];
    property_option_ids?: string[];
    created_within_days?: number | null;
  };
  group_by?: string;
  metric?: "count" | "avg_resolution_days";
  period?: "week" | "month";
  periods?: number;
  limit?: number;
  order_by?: string;
};

export type TDashboardWidget = {
  id: string;
  dashboard_id: string;
  name: string;
  widget_type: TDashboardWidgetType;
  config: TDashboardWidgetConfig;
  width: number;
  sort_order: number;
};

export type TWorkItemDashboard = {
  id: string;
  name: string;
  description: string;
  access: 0 | 1;
  logo_props: Record<string, unknown>;
  owned_by: string;
  can_edit: boolean;
  widget_count: number;
  created_at: string;
  updated_at: string;
  widgets?: TDashboardWidget[];
};

export type TWidgetGroupItem = { key: string; label: string; value: number | null; color?: string | null };
export type TWidgetData =
  | { metric: string; value: number | null }
  | { group_by: string; metric: string; items: TWidgetGroupItem[] }
  | { period: string; points: { period: string; created: number; completed: number }[] }
  | {
      rows: {
        id: string;
        project_id: string;
        identifier: string;
        name: string;
        priority: string;
        state_name: string | null;
        state_group: string | null;
        state_color: string | null;
        type_name: string | null;
        created_at: string;
        target_date: string | null;
      }[];
    };

export type TWidgetPayload = Partial<Omit<TDashboardWidget, "id" | "dashboard_id">>;

export class WorkItemDashboardService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}/work-item-dashboards`;
  }

  private unwrap = <T>(promise: Promise<{ data: T }>): Promise<T> =>
    promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });

  list(workspaceSlug: string) {
    return this.unwrap<TWorkItemDashboard[]>(this.get(`${this.base(workspaceSlug)}/`));
  }

  retrieve(workspaceSlug: string, dashboardId: string) {
    return this.unwrap<TWorkItemDashboard>(this.get(`${this.base(workspaceSlug)}/${dashboardId}/`));
  }

  create(workspaceSlug: string, data: Omit<Partial<TWorkItemDashboard>, "widgets"> & { widgets?: TWidgetPayload[] }) {
    return this.unwrap<TWorkItemDashboard>(this.post(`${this.base(workspaceSlug)}/`, data));
  }

  update(workspaceSlug: string, dashboardId: string, data: Partial<TWorkItemDashboard>) {
    return this.unwrap<TWorkItemDashboard>(this.patch(`${this.base(workspaceSlug)}/${dashboardId}/`, data));
  }

  remove(workspaceSlug: string, dashboardId: string) {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug)}/${dashboardId}/`));
  }

  createWidget(workspaceSlug: string, dashboardId: string, data: TWidgetPayload) {
    return this.unwrap<TDashboardWidget>(this.post(`${this.base(workspaceSlug)}/${dashboardId}/widgets/`, data));
  }

  updateWidget(workspaceSlug: string, dashboardId: string, widgetId: string, data: TWidgetPayload) {
    return this.unwrap<TDashboardWidget>(
      this.patch(`${this.base(workspaceSlug)}/${dashboardId}/widgets/${widgetId}/`, data)
    );
  }

  removeWidget(workspaceSlug: string, dashboardId: string, widgetId: string) {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug)}/${dashboardId}/widgets/${widgetId}/`));
  }

  widgetData(workspaceSlug: string, dashboardId: string, widgetId: string) {
    return this.unwrap<TWidgetData>(this.get(`${this.base(workspaceSlug)}/${dashboardId}/widgets/${widgetId}/data/`));
  }
}
