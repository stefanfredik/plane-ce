# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.issue_type import (
    IssuePropertyValueEndpoint,
    WorkItemTypeDetailEndpoint,
    WorkItemTypeEnableEndpoint,
    WorkItemTypeEndpoint,
    PropertyRelationDetailsEndpoint,
    ProjectPropertyValuesEndpoint,
    WorkItemTypeBulkAssignEndpoint,
    WorkItemTypeImportEndpoint,
    WorkspaceWorkItemTypeEndpoint,
    WorkItemTypePropertyDetailEndpoint,
    WorkItemTypePropertyEndpoint,
    WorkItemTypePropertyLinkEndpoint,
    ProjectPropertyPoolEndpoint,
    ProjectPropertyPoolDetailEndpoint,
)

PROJECT = "workspaces/<str:slug>/projects/<uuid:project_id>"

urlpatterns = [
    path(
        "workspaces/<str:slug>/work-item-types/",
        WorkspaceWorkItemTypeEndpoint.as_view(),
        name="workspace-work-item-types",
    ),
    path(f"{PROJECT}/property-values/", ProjectPropertyValuesEndpoint.as_view(), name="project-property-values"),
    path(
        f"{PROJECT}/property-values/relations/",
        PropertyRelationDetailsEndpoint.as_view(),
        name="project-property-relation-details",
    ),
    path(
        f"{PROJECT}/work-item-types/import/",
        WorkItemTypeImportEndpoint.as_view(),
        name="project-work-item-types-import",
    ),
    path(
        f"{PROJECT}/work-item-types/bulk-assign/",
        WorkItemTypeBulkAssignEndpoint.as_view(),
        name="project-work-item-types-bulk-assign",
    ),
    path(f"{PROJECT}/work-item-types/", WorkItemTypeEndpoint.as_view(), name="project-work-item-types"),
    path(
        f"{PROJECT}/work-item-types/enable/",
        WorkItemTypeEnableEndpoint.as_view(),
        name="project-work-item-types-enable",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/",
        WorkItemTypeDetailEndpoint.as_view(),
        name="project-work-item-type",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/properties/",
        WorkItemTypePropertyEndpoint.as_view(),
        name="project-work-item-type-properties",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/properties/link/",
        WorkItemTypePropertyLinkEndpoint.as_view(),
        name="project-work-item-type-properties-link",
    ),
    path(
        f"{PROJECT}/work-item-properties/", ProjectPropertyPoolEndpoint.as_view(), name="project-work-item-properties"
    ),
    path(
        f"{PROJECT}/work-item-properties/<uuid:property_id>/",
        ProjectPropertyPoolDetailEndpoint.as_view(),
        name="project-work-item-property",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/properties/<uuid:property_id>/",
        WorkItemTypePropertyDetailEndpoint.as_view(),
        name="project-work-item-type-property",
    ),
    path(
        f"{PROJECT}/issues/<uuid:issue_id>/property-values/",
        IssuePropertyValueEndpoint.as_view(),
        name="project-issue-property-values",
    ),
]
