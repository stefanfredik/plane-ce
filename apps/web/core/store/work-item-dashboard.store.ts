/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// services
import type {
  TDashboardWidget,
  TWidgetData,
  TWidgetPayload,
  TWorkItemDashboard,
} from "@/services/work-item-dashboard.service";
import { WorkItemDashboardService } from "@/services/work-item-dashboard.service";

export interface IWorkItemDashboardStore {
  dashboards: TWorkItemDashboard[] | undefined;
  details: Record<string, TWorkItemDashboard | undefined>;
  widgetData: Record<string, TWidgetData | { error: string } | undefined>;
  fetchDashboards: (workspaceSlug: string) => Promise<void>;
  fetchDashboard: (workspaceSlug: string, dashboardId: string) => Promise<TWorkItemDashboard>;
  createDashboard: (
    workspaceSlug: string,
    data: Omit<Partial<TWorkItemDashboard>, "widgets"> & { widgets?: TWidgetPayload[] }
  ) => Promise<TWorkItemDashboard>;
  updateDashboard: (workspaceSlug: string, dashboardId: string, data: Partial<TWorkItemDashboard>) => Promise<void>;
  deleteDashboard: (workspaceSlug: string, dashboardId: string) => Promise<void>;
  saveWidget: (
    workspaceSlug: string,
    dashboardId: string,
    data: TWidgetPayload,
    widgetId?: string
  ) => Promise<TDashboardWidget>;
  deleteWidget: (workspaceSlug: string, dashboardId: string, widgetId: string) => Promise<void>;
  fetchWidgetData: (workspaceSlug: string, dashboardId: string, widgetId: string) => Promise<void>;
}

export class WorkItemDashboardStore implements IWorkItemDashboardStore {
  dashboards: TWorkItemDashboard[] | undefined = undefined;
  details: Record<string, TWorkItemDashboard | undefined> = {};
  widgetData: Record<string, TWidgetData | { error: string } | undefined> = {};
  private service = new WorkItemDashboardService();

  constructor() {
    makeObservable(this, {
      dashboards: observable,
      details: observable,
      widgetData: observable,
      fetchDashboards: action,
      fetchDashboard: action,
      createDashboard: action,
      updateDashboard: action,
      deleteDashboard: action,
      saveWidget: action,
      deleteWidget: action,
      fetchWidgetData: action,
    });
  }

  fetchDashboards = async (workspaceSlug: string) => {
    const dashboards = await this.service.list(workspaceSlug);
    runInAction(() => {
      this.dashboards = dashboards;
    });
  };

  fetchDashboard = async (workspaceSlug: string, dashboardId: string) => {
    const dashboard = await this.service.retrieve(workspaceSlug, dashboardId);
    runInAction(() => {
      this.details[dashboardId] = dashboard;
    });
    return dashboard;
  };

  createDashboard = async (
    workspaceSlug: string,
    data: Omit<Partial<TWorkItemDashboard>, "widgets"> & { widgets?: TWidgetPayload[] }
  ) => {
    const dashboard = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      this.details[dashboard.id] = dashboard;
      this.dashboards = [...(this.dashboards ?? []), dashboard];
    });
    return dashboard;
  };

  updateDashboard = async (workspaceSlug: string, dashboardId: string, data: Partial<TWorkItemDashboard>) => {
    const dashboard = await this.service.update(workspaceSlug, dashboardId, data);
    runInAction(() => {
      this.details[dashboardId] = dashboard;
      this.dashboards = this.dashboards?.map((d) => (d.id === dashboardId ? { ...d, ...dashboard } : d));
    });
  };

  deleteDashboard = async (workspaceSlug: string, dashboardId: string) => {
    await this.service.remove(workspaceSlug, dashboardId);
    runInAction(() => {
      this.details[dashboardId] = undefined;
      this.dashboards = this.dashboards?.filter((d) => d.id !== dashboardId);
    });
  };

  saveWidget = async (workspaceSlug: string, dashboardId: string, data: TWidgetPayload, widgetId?: string) => {
    const widget = widgetId
      ? await this.service.updateWidget(workspaceSlug, dashboardId, widgetId, data)
      : await this.service.createWidget(workspaceSlug, dashboardId, data);
    await this.fetchDashboard(workspaceSlug, dashboardId);
    await this.fetchWidgetData(workspaceSlug, dashboardId, widget.id);
    return widget;
  };

  deleteWidget = async (workspaceSlug: string, dashboardId: string, widgetId: string) => {
    await this.service.removeWidget(workspaceSlug, dashboardId, widgetId);
    await this.fetchDashboard(workspaceSlug, dashboardId);
  };

  fetchWidgetData = async (workspaceSlug: string, dashboardId: string, widgetId: string) => {
    try {
      const data = await this.service.widgetData(workspaceSlug, dashboardId, widgetId);
      runInAction(() => {
        this.widgetData[widgetId] = data;
      });
    } catch (error) {
      const message = (error as { errors?: { config?: string } })?.errors?.config ?? "Could not load this widget.";
      runInAction(() => {
        this.widgetData[widgetId] = { error: message };
      });
    }
  };
}
