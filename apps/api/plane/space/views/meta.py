# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# third party
from rest_framework.permissions import AllowAny
from rest_framework import status
from rest_framework.response import Response

from plane.db.models import IssueView, DeployBoard, Project

from .base import BaseAPIView
from plane.space.serializer.project import ProjectLiteSerializer
from plane.space.utils.published_views import PUBLISHED_ENTITIES, published_project_id, published_view


class ProjectMetaDataEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, anchor):
        try:
            deploy_board = DeployBoard.objects.get(anchor=anchor, entity_name__in=PUBLISHED_ENTITIES)
        except DeployBoard.DoesNotExist:
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        try:
            project = Project.objects.get(id=published_project_id(deploy_board))
            view = published_view(deploy_board)
        except (Project.DoesNotExist, IssueView.DoesNotExist):
            return Response({"error": "Project is not published"}, status=status.HTTP_404_NOT_FOUND)

        data = dict(ProjectLiteSerializer(project).data)
        # Published views also tell the page which view it is showing
        data["view"] = (
            {"id": str(view.id), "name": view.name, "description": view.description, "logo_props": view.logo_props}
            if view
            else None
        )
        return Response(data, status=status.HTTP_200_OK)
