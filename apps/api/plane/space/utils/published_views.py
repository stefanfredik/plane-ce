# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public pages can show a whole project or one of its views (deploy board entity "view")."""

# Python imports
from types import SimpleNamespace

# Module imports
from plane.db.models import IssueView
from plane.utils.filters import ComplexFilterBackend, IssueFilterSet

PUBLISHED_ENTITIES = ["project", "view"]


def published_project_id(deploy_board):
    """The project behind a published project or view."""
    return deploy_board.project_id or deploy_board.entity_identifier


def published_view(deploy_board):
    """The view a deploy board publishes, or None for a project board. Raises DoesNotExist when gone."""
    if deploy_board.entity_name != "view":
        return None
    return IssueView.objects.get(
        id=deploy_board.entity_identifier,
        project_id=deploy_board.project_id,
        archived_at__isnull=True,
        access=1,
    )


def apply_view_filters(request, queryset, view):
    """Narrow work items the way the view does: its rich filter expression, then its legacy query."""
    if view is None:
        return queryset
    if view.rich_filters:
        holder = SimpleNamespace(filterset_class=IssueFilterSet)
        queryset = ComplexFilterBackend().filter_queryset(request, queryset, holder, filter_data=view.rich_filters)
    if isinstance(view.query, dict) and view.query:
        queryset = queryset.filter(**view.query)
    return queryset
