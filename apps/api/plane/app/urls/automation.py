# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.automation import AutomationDetailEndpoint, AutomationEndpoint, AutomationRunEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automations/",
        AutomationEndpoint.as_view(),
        name="project-automations",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automations/<uuid:pk>/",
        AutomationDetailEndpoint.as_view(),
        name="project-automation",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/automations/<uuid:pk>/runs/",
        AutomationRunEndpoint.as_view(),
        name="project-automation-runs",
    ),
]
