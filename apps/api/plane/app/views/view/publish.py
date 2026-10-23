# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Publishing a project view: a read-only public page in the Space app, at /views/<anchor>."""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import DeployBoard, IssueView, ProjectMember

SETTINGS = ("is_comments_enabled", "is_reactions_enabled", "is_votes_enabled", "view_props")
DEFAULT_VIEW_PROPS = {"list": True, "kanban": True, "calendar": False, "gantt": False, "spreadsheet": False}


def serialize_publish(board):
    return {
        "id": str(board.id),
        "anchor": board.anchor,
        "entity_name": board.entity_name,
        "entity_identifier": str(board.entity_identifier),
        "project": str(board.project_id),
        "workspace": str(board.workspace_id),
        "is_comments_enabled": board.is_comments_enabled,
        "is_reactions_enabled": board.is_reactions_enabled,
        "is_votes_enabled": board.is_votes_enabled,
        "view_props": board.view_props or DEFAULT_VIEW_PROPS,
    }


class IssueViewPublishEndpoint(BaseAPIView):
    def _view(self, slug, project_id, view_id):
        return IssueView.objects.filter(workspace__slug=slug, project_id=project_id, id=view_id).first()

    def _board(self, view):
        return DeployBoard.objects.filter(entity_name="view", entity_identifier=view.id).first()

    def _can_manage(self, request, view):
        """The view's owner or a project admin may publish it."""
        if view.owned_by_id == request.user.id:
            return True
        return ProjectMember.objects.filter(
            project_id=view.project_id, member=request.user, role=ROLE.ADMIN.value, is_active=True
        ).exists()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, view_id):
        view = self._view(slug, project_id, view_id)
        if view is None:
            return Response({"error": "View not found"}, status=status.HTTP_404_NOT_FOUND)
        board = self._board(view)
        if board is None:
            return Response({"error": "View is not published"}, status=status.HTTP_404_NOT_FOUND)
        return Response(serialize_publish(board))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id, view_id):
        view = self._view(slug, project_id, view_id)
        if view is None:
            return Response({"error": "View not found"}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage(request, view):
            return Response({"error": "Only the view's owner or a project admin can publish it."}, status=403)
        if view.access != 1:
            return Response({"error": "Make the view public in the project before publishing it."}, status=400)
        board, _created = DeployBoard.objects.get_or_create(
            entity_name="view",
            entity_identifier=view.id,
            project_id=view.project_id,
            defaults={"view_props": DEFAULT_VIEW_PROPS},
        )
        return self._apply(board, request.data, created=_created)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def patch(self, request, slug, project_id, view_id):
        view = self._view(slug, project_id, view_id)
        board = self._board(view) if view else None
        if board is None:
            return Response({"error": "View is not published"}, status=status.HTTP_404_NOT_FOUND)
        if not self._can_manage(request, view):
            return Response({"error": "Only the view's owner or a project admin can change publishing."}, status=403)
        return self._apply(board, request.data)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def delete(self, request, slug, project_id, view_id):
        view = self._view(slug, project_id, view_id)
        board = self._board(view) if view else None
        if board is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        if not self._can_manage(request, view):
            return Response({"error": "Only the view's owner or a project admin can unpublish it."}, status=403)
        board.delete(soft=False)
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _apply(self, board, data, created=False):
        for key in SETTINGS:
            if key not in data:
                continue
            if key == "view_props":
                props = data[key] if isinstance(data[key], dict) else {}
                board.view_props = {layout: bool(props.get(layout)) for layout in DEFAULT_VIEW_PROPS}
                if not any(board.view_props.values()):
                    board.view_props["list"] = True
            else:
                setattr(board, key, bool(data[key]))
        board.save()
        return Response(serialize_publish(board), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
