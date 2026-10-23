# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.project_integration import IntegrationWebhookEndpoint, ProjectIntegrationEndpoint

urlpatterns = [
    path(
        "workspaces/<str:slug>/projects/<uuid:project_id>/integrations/<str:provider>/",
        ProjectIntegrationEndpoint.as_view(),
        name="project-integration",
    ),
    path(
        "integrations/<str:provider>/<str:anchor>/",
        IntegrationWebhookEndpoint.as_view(),
        name="integration-webhook",
    ),
]
