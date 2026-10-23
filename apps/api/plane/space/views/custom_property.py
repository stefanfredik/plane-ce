# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom properties on published pages: only properties marked public, read-only, as display text."""

# Python imports
import uuid

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

# Module imports
from plane.db.models import (
    DeployBoard,
    Issue,
    IssueProperty,
    IssuePropertyOption,
    IssuePropertyType,
    IssuePropertyValue,
    IssueView,
    User,
)
from plane.space.utils.published_views import (
    PUBLISHED_ENTITIES,
    apply_view_filters,
    published_project_id,
    published_view,
)
from plane.utils.work_item_types import PUBLIC_KINDS, VALUE_COLUMNS, project_issue_types

from .base import BaseAPIView

MAX_BATCH = 200
PARAGRAPH_PREVIEW = 200


def _board(anchor):
    """(project id, view) of a published board, or None when it is not (or no longer) public."""
    board = DeployBoard.objects.filter(anchor=anchor, entity_name__in=PUBLISHED_ENTITIES).first()
    if board is None:
        return None
    try:
        return published_project_id(board), published_view(board)
    except IssueView.DoesNotExist:
        return None


def public_properties(project_id):
    """Active properties marked public that an active type of the project uses."""
    types = project_issue_types(project_id).filter(is_active=True)
    return (
        IssueProperty.objects.filter(
            type_links__issue_type__in=types,
            type_links__deleted_at__isnull=True,
            is_public=True,
            is_active=True,
            property_type__in=PUBLIC_KINDS,
        )
        .distinct()
        .order_by("sort_order", "created_at")
    )


class PublishedPropertiesEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get(self, request, anchor):
        board = _board(anchor)
        if board is None:
            return Response({"error": "Not published"}, status=status.HTTP_404_NOT_FOUND)
        project_id, _view = board
        props = list(public_properties(project_id))
        colors = {}
        for prop_id, name, color in IssuePropertyOption.objects.filter(
            property_id__in=[p.id for p in props], property__property_type=IssuePropertyType.OPTION
        ).values_list("property_id", "name", "color"):
            colors.setdefault(prop_id, []).append({"name": name, "color": color})
        return Response(
            [
                {
                    "id": str(p.id),
                    "name": p.display_name,
                    "description": p.description,
                    "property_type": p.property_type,
                    "is_multi": p.is_multi,
                    "logo_props": p.logo_props or {},
                    "options": colors.get(p.id, []),
                }
                for p in props
            ]
        )


class PublishedPropertyValuesEndpoint(BaseAPIView):
    """Display text of public property values for work items shown on the published page."""

    permission_classes = [AllowAny]

    def get(self, request, anchor):
        board = _board(anchor)
        if board is None:
            return Response({"error": "Not published"}, status=status.HTTP_404_NOT_FOUND)
        project_id, view = board
        raw = [i for i in (request.GET.get("issue_ids") or "").split(",") if i]
        if len(raw) > MAX_BATCH:
            return Response({"error": f"Ask for at most {MAX_BATCH} work items."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ids = [uuid.UUID(i) for i in raw]
        except ValueError:
            return Response({"error": "Work item ids must be UUIDs."}, status=status.HTTP_400_BAD_REQUEST)
        # only items the published page itself would list
        visible = apply_view_filters(request, Issue.issue_objects.filter(project_id=project_id, id__in=ids), view)
        visible_ids = list(visible.values_list("id", flat=True))
        props = {p.id: p for p in public_properties(project_id)}
        rows = list(
            IssuePropertyValue.objects.filter(issue_id__in=visible_ids, property_id__in=props.keys())
            .order_by("created_at")
            .values_list("issue_id", "property_id", *VALUE_COLUMNS)
        )
        option_ids = {r[6] for r in rows if r[6]}
        member_ids = {r[7] for r in rows if r[7]}
        options = {
            o.id: (f"{o.parent.name} › {o.name}" if o.parent_id else o.name)
            for o in IssuePropertyOption.all_objects.filter(id__in=option_ids).select_related("parent")
        }
        members = dict(User.objects.filter(id__in=member_ids).values_list("id", "display_name"))
        result = {str(i): {} for i in visible_ids}
        for issue_id, prop_id, text, number, boolean, day, option, member, _asset, _issue, _customer in rows:
            kind = props[prop_id].property_type
            if kind in (IssuePropertyType.OPTION, IssuePropertyType.CASCADING):
                label = options.get(option)
            elif kind == IssuePropertyType.MEMBER:
                label = members.get(member)
            elif kind in (IssuePropertyType.NUMBER, IssuePropertyType.FORMULA):
                label = None if number is None else format(number.normalize(), "f")
            elif kind == IssuePropertyType.BOOLEAN:
                label = None if boolean is None else ("true" if boolean else "false")
            elif kind == IssuePropertyType.DATE:
                label = day.isoformat() if day else None
            elif kind == IssuePropertyType.PARAGRAPH:
                label = text if not text or len(text) <= PARAGRAPH_PREVIEW else text[:PARAGRAPH_PREVIEW] + "…"
            else:
                label = text
            if label:
                result[str(issue_id)].setdefault(str(prop_id), []).append(label)
        return Response(result)
