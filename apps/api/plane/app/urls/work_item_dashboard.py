# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.work_item_dashboard import (
    WorkItemDashboardDetailEndpoint,
    WorkItemDashboardEndpoint,
    WorkItemDashboardWidgetDataEndpoint,
    WorkItemDashboardWidgetDetailEndpoint,
    WorkItemDashboardWidgetEndpoint,
)

BASE = "workspaces/<str:slug>/work-item-dashboards"

urlpatterns = [
    path(f"{BASE}/", WorkItemDashboardEndpoint.as_view(), name="work-item-dashboards"),
    path(f"{BASE}/<uuid:dashboard_id>/", WorkItemDashboardDetailEndpoint.as_view(), name="work-item-dashboard"),
    path(
        f"{BASE}/<uuid:dashboard_id>/widgets/",
        WorkItemDashboardWidgetEndpoint.as_view(),
        name="work-item-dashboard-widgets",
    ),
    path(
        f"{BASE}/<uuid:dashboard_id>/widgets/<uuid:widget_id>/",
        WorkItemDashboardWidgetDetailEndpoint.as_view(),
        name="work-item-dashboard-widget",
    ),
    path(
        f"{BASE}/<uuid:dashboard_id>/widgets/<uuid:widget_id>/data/",
        WorkItemDashboardWidgetDataEndpoint.as_view(),
        name="work-item-dashboard-widget-data",
    ),
]
