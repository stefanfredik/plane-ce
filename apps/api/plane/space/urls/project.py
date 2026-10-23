# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path


from plane.space.views import (
    ProjectDeployBoardPublicSettingsEndpoint,
    ProjectIssuesPublicEndpoint,
    WorkspaceProjectAnchorEndpoint,
    ProjectCyclesEndpoint,
    ProjectModulesEndpoint,
    ProjectStatesEndpoint,
    ProjectLabelsEndpoint,
    ProjectMembersEndpoint,
    ProjectMetaDataEndpoint,
    PublishedPropertiesEndpoint,
    PublishedPropertyValuesEndpoint,
    PublicIntakeFormEndpoint,
)

urlpatterns = [
    path(
        "intake-forms/<str:anchor>/",
        PublicIntakeFormEndpoint.as_view(),
        name="public-intake-form",
    ),
    path(
        "anchor/<str:anchor>/properties/",
        PublishedPropertiesEndpoint.as_view(),
        name="published-properties",
    ),
    path(
        "anchor/<str:anchor>/property-values/",
        PublishedPropertyValuesEndpoint.as_view(),
        name="published-property-values",
    ),
    path(
        "anchor/<str:anchor>/meta/",
        ProjectMetaDataEndpoint.as_view(),
        name="project-meta",
    ),
    path(
        "anchor/<str:anchor>/settings/",
        ProjectDeployBoardPublicSettingsEndpoint.as_view(),
        name="project-deploy-board-settings",
    ),
    path(
        "anchor/<str:anchor>/issues/",
        ProjectIssuesPublicEndpoint.as_view(),
        name="project-deploy-board",
    ),
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/anchor/",
        WorkspaceProjectAnchorEndpoint.as_view(),
        name="project-deploy-board",
    ),
    path(
        "anchor/<str:anchor>/cycles/",
        ProjectCyclesEndpoint.as_view(),
        name="project-cycles",
    ),
    path(
        "anchor/<str:anchor>/modules/",
        ProjectModulesEndpoint.as_view(),
        name="project-modules",
    ),
    path(
        "anchor/<str:anchor>/states/",
        ProjectStatesEndpoint.as_view(),
        name="project-states",
    ),
    path(
        "anchor/<str:anchor>/labels/",
        ProjectLabelsEndpoint.as_view(),
        name="project-labels",
    ),
    path(
        "anchor/<str:anchor>/members/",
        ProjectMembersEndpoint.as_view(),
        name="project-members",
    ),
]
