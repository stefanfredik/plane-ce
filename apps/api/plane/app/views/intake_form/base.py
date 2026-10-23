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
from plane.utils import intake_forms as svc


class ProjectIntakeFormEndpoint(BaseAPIView):
    """The project's public intake form settings (project admins)."""

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        return Response(svc.serialize_form(svc.get_or_create_form(project, request.user)))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        form = svc.get_or_create_form(project, request.user)
        try:
            form = svc.update_form(form, request.data, request.user)
        except svc.IntakeFormError as e:
            return Response({"error": "Invalid data", "errors": e.errors}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_form(form))
