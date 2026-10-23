# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Project
from plane.utils import workflows as svc


class ProjectWorkflowEndpoint(BaseAPIView):
    """State transition rules. Members read them (the UI hides moves they cannot make); admins edit."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        return Response(svc.serialize_workflow(svc.get_workflow(project_id), project_id, request.user))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        try:
            workflow = svc.update_workflow(project, request.user, request.data)
        except svc.WorkflowError as e:
            return Response({"error": e.message}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_workflow(workflow, project_id, request.user))
