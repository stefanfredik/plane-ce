# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.intake_form import ProjectIntakeFormEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/intake-form/",
        ProjectIntakeFormEndpoint.as_view(),
        name="project-intake-form",
    ),
]
