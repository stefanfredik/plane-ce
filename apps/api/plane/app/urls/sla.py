# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.sla import IssueSlaEndpoint, ProjectSlaEndpoint, SlaSummaryEndpoint

urlpatterns = [
    path("workspaces/<str:slug>/projects/<uuid:project_id>/sla/", ProjectSlaEndpoint.as_view(), name="project-sla"),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/sla/summary/",
        SlaSummaryEndpoint.as_view(),
        name="project-sla-summary",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/issues/<uuid:issue_id>/sla/",
        IssueSlaEndpoint.as_view(),
        name="issue-sla",
    ),
]
