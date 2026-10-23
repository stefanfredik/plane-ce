# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.work_item_type import (
    WorkItemAllPropertyValuesAPIEndpoint,
    WorkItemProjectPropertyListAPIEndpoint,
    WorkItemPropertyDetailAPIEndpoint,
    WorkItemPropertyListCreateAPIEndpoint,
    WorkItemPropertyOptionDetailAPIEndpoint,
    WorkItemPropertyOptionListCreateAPIEndpoint,
    WorkItemPropertyValueAPIEndpoint,
    WorkItemTypeDetailAPIEndpoint,
    WorkItemTypeImportAPIEndpoint,
    WorkItemTypeListCreateAPIEndpoint,
)

PROJECT = "workspaces/<str:slug>/projects/<uuid:project_id>"

urlpatterns = [
    path(
        f"{PROJECT}/import-work-item-types/",
        WorkItemTypeImportAPIEndpoint.as_view(),
        name="work-item-types-import",
    ),
    path(f"{PROJECT}/work-item-types/", WorkItemTypeListCreateAPIEndpoint.as_view(), name="work-item-types"),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/",
        WorkItemTypeDetailAPIEndpoint.as_view(),
        name="work-item-type",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/work-item-properties/",
        WorkItemPropertyListCreateAPIEndpoint.as_view(),
        name="work-item-type-properties",
    ),
    path(
        f"{PROJECT}/work-item-types/<uuid:type_id>/work-item-properties/<uuid:property_id>/",
        WorkItemPropertyDetailAPIEndpoint.as_view(),
        name="work-item-type-property",
    ),
    path(
        f"{PROJECT}/work-item-properties/",
        WorkItemProjectPropertyListAPIEndpoint.as_view(),
        name="work-item-properties",
    ),
    path(
        f"{PROJECT}/work-item-properties/<uuid:property_id>/options/",
        WorkItemPropertyOptionListCreateAPIEndpoint.as_view(),
        name="work-item-property-options",
    ),
    path(
        f"{PROJECT}/work-item-properties/<uuid:property_id>/options/<uuid:option_id>/",
        WorkItemPropertyOptionDetailAPIEndpoint.as_view(),
        name="work-item-property-option",
    ),
    path(
        f"{PROJECT}/work-items/<uuid:work_item_id>/work-item-properties/<uuid:property_id>/values/",
        WorkItemPropertyValueAPIEndpoint.as_view(),
        name="work-item-property-values",
    ),
    path(
        f"{PROJECT}/work-items/<uuid:work_item_id>/property-values/",
        WorkItemAllPropertyValuesAPIEndpoint.as_view(),
        name="work-item-all-property-values",
    ),
]
