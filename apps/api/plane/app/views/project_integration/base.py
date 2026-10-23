# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project, ProjectIntegration
from plane.utils import integrations as svc
from plane.utils.exception_logger import log_exception


class ProjectIntegrationEndpoint(BaseAPIView):
    """A project's GitLab or Sentry connection (project admins)."""

    def _get(self, slug, project_id, provider, user):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        return svc.get_or_create(project, provider, user)

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id, provider):
        if provider not in svc.PROVIDERS:
            return Response({"error": "Unknown integration."}, status=status.HTTP_404_NOT_FOUND)
        return Response(svc.serialize(self._get(slug, project_id, provider, request.user)))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, provider):
        if provider not in svc.PROVIDERS:
            return Response({"error": "Unknown integration."}, status=status.HTTP_404_NOT_FOUND)
        integration = self._get(slug, project_id, provider, request.user)
        try:
            integration = svc.update(integration, request.user, request.data)
        except svc.IntegrationError as e:
            return Response({"error": e.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize(integration))


class IntegrationWebhookThrottle(AnonRateThrottle):
    rate = "600/minute"
    scope = "integration_webhook"


class IntegrationWebhookEndpoint(APIView):
    """Where GitLab and Sentry deliver their webhooks; the URL's anchor picks the project."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [IntegrationWebhookThrottle]

    def post(self, request, provider, anchor):
        integration = (
            ProjectIntegration.objects.filter(provider=provider, anchor=anchor, is_enabled=True)
            .select_related("project")
            .first()
        )
        if integration is None:
            return Response({"error": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        raw = request.body
        try:
            result = svc.receive(integration, request.headers, raw)
        except svc.IntegrationError as e:
            return Response({"error": e.message}, status=e.status)
        except Exception as e:
            log_exception(e)
            return Response({"error": "Could not process the webhook."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response(result)
