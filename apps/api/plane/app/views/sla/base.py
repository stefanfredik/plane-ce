# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import IssueSla, Project
from plane.utils import sla as svc


class ProjectSlaEndpoint(BaseAPIView):
    """The project's SLA targets (project admins)."""

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id):
        return Response(svc.serialize_policy(svc.get_policy(project_id), project_id))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        try:
            policy = svc.update_policy(project, request.user, request.data)
        except svc.SlaError as e:
            return Response({"error": e.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_policy(policy, project_id))


class SlaSummaryEndpoint(BaseAPIView):
    """Open work items by SLA status, for the project overview."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        policy = svc.get_policy(project_id)
        data = svc.summary([project_id])
        data["is_enabled"] = bool(policy and policy.is_enabled)
        return Response(data)


class IssueSlaEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        policy = svc.get_policy(project_id)
        if not policy or not policy.is_enabled:
            return Response(None)
        row = IssueSla.objects.filter(project_id=project_id, issue_id=issue_id).first()
        return Response(svc.serialize_issue_sla(row, policy))
