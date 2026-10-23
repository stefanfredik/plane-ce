# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Max, Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import WorkItemDashboard, WorkItemDashboardWidget, Workspace, WorkspaceMember
from plane.utils.work_item_dashboards import WidgetConfigError, widget_data

WIDGET_TYPES = set(WorkItemDashboardWidget.WidgetType.values)
WIDGET_FIELDS = ("name", "widget_type", "config", "width", "sort_order")


def _bad_request(errors):
    return Response({"error": "Invalid data", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


def _not_found():
    return Response({"error": "Dashboard not found"}, status=status.HTTP_404_NOT_FOUND)


def _visible_dashboards(slug, user):
    """Own dashboards plus the ones shared with the workspace."""
    return WorkItemDashboard.objects.filter(workspace__slug=slug).filter(
        Q(owned_by=user) | Q(access=WorkItemDashboard.Access.WORKSPACE)
    )


def _can_edit(dashboard, user):
    if dashboard.owned_by_id == user.id:
        return True
    return WorkspaceMember.objects.filter(
        workspace_id=dashboard.workspace_id, member=user, role=ROLE.ADMIN.value, is_active=True
    ).exists()


def serialize_widget(widget):
    return {
        "id": str(widget.id),
        "dashboard_id": str(widget.dashboard_id),
        "name": widget.name,
        "widget_type": widget.widget_type,
        "config": widget.config or {},
        "width": widget.width,
        "sort_order": widget.sort_order,
    }


def serialize_dashboard(dashboard, user, with_widgets=False):
    data = {
        "id": str(dashboard.id),
        "name": dashboard.name,
        "description": dashboard.description,
        "access": dashboard.access,
        "logo_props": dashboard.logo_props or {},
        "owned_by": str(dashboard.owned_by_id),
        "can_edit": _can_edit(dashboard, user),
        "widget_count": dashboard.widgets.count(),
        "created_at": dashboard.created_at.isoformat(),
        "updated_at": dashboard.updated_at.isoformat(),
    }
    if with_widgets:
        data["widgets"] = [serialize_widget(w) for w in dashboard.widgets.all().order_by("sort_order", "created_at")]
    return data


def _clean_widget(data, partial=False):
    errors, clean = {}, {}
    for key in WIDGET_FIELDS:
        if key in data:
            clean[key] = data[key]
    if not partial or "name" in clean:
        if not str(clean.get("name") or "").strip():
            errors["name"] = "Name is required."
        else:
            clean["name"] = str(clean["name"]).strip()[:255]
    if not partial or "widget_type" in clean:
        if clean.get("widget_type") not in WIDGET_TYPES:
            errors["widget_type"] = "Unknown widget type."
    if "width" in clean:
        try:
            clean["width"] = max(1, min(int(clean["width"]), 3))
        except (TypeError, ValueError):
            errors["width"] = "Width is 1, 2 or 3 columns."
    if "config" in clean and not isinstance(clean["config"], dict):
        errors["config"] = "Config must be an object."
    return clean, errors


class WorkItemDashboardEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        dashboards = _visible_dashboards(slug, request.user).order_by("sort_order", "-created_at")
        return Response([serialize_dashboard(d, request.user) for d in dashboards])

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        name = str(request.data.get("name") or "").strip()
        if not name:
            return _bad_request({"name": "Name is required."})
        access = request.data.get("access", WorkItemDashboard.Access.PRIVATE)
        if access not in WorkItemDashboard.Access.values:
            return _bad_request({"access": "Access is 0 (private) or 1 (workspace)."})
        workspace = Workspace.objects.get(slug=slug)
        dashboard = WorkItemDashboard.objects.create(
            workspace=workspace,
            name=name[:255],
            description=request.data.get("description") or "",
            access=access,
            logo_props=request.data.get("logo_props") or {},
            owned_by=request.user,
        )
        widgets = request.data.get("widgets") or []
        for index, raw in enumerate(widgets if isinstance(widgets, list) else []):
            clean, errors = _clean_widget(raw)
            if errors:
                dashboard.delete()
                return _bad_request({f"widgets.{index}": errors})
            WorkItemDashboardWidget.objects.create(
                workspace=workspace, dashboard=dashboard, sort_order=(index + 1) * 10000, **clean
            )
        return Response(serialize_dashboard(dashboard, request.user, True), status=status.HTTP_201_CREATED)


class WorkItemDashboardDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, dashboard_id):
        dashboard = _visible_dashboards(slug, request.user).filter(id=dashboard_id).first()
        return Response(serialize_dashboard(dashboard, request.user, True)) if dashboard else _not_found()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, dashboard_id):
        dashboard = _visible_dashboards(slug, request.user).filter(id=dashboard_id).first()
        if dashboard is None:
            return _not_found()
        if not _can_edit(dashboard, request.user):
            return Response({"error": "Only the owner or a workspace admin can change this dashboard."}, status=403)
        if "name" in request.data:
            name = str(request.data.get("name") or "").strip()
            if not name:
                return _bad_request({"name": "Name is required."})
            dashboard.name = name[:255]
        if "access" in request.data:
            if request.data["access"] not in WorkItemDashboard.Access.values:
                return _bad_request({"access": "Access is 0 (private) or 1 (workspace)."})
            dashboard.access = request.data["access"]
        for key in ("description", "logo_props", "sort_order"):
            if key in request.data:
                setattr(dashboard, key, request.data[key])
        dashboard.save()
        return Response(serialize_dashboard(dashboard, request.user, True))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, dashboard_id):
        dashboard = _visible_dashboards(slug, request.user).filter(id=dashboard_id).first()
        if dashboard is None:
            return _not_found()
        if not _can_edit(dashboard, request.user):
            return Response({"error": "Only the owner or a workspace admin can delete this dashboard."}, status=403)
        WorkItemDashboardWidget.objects.filter(dashboard=dashboard).delete()
        dashboard.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemDashboardWidgetEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug, dashboard_id):
        dashboard = _visible_dashboards(slug, request.user).filter(id=dashboard_id).first()
        if dashboard is None:
            return _not_found()
        if not _can_edit(dashboard, request.user):
            return Response({"error": "Only the owner or a workspace admin can change this dashboard."}, status=403)
        clean, errors = _clean_widget(request.data)
        if errors:
            return _bad_request(errors)
        last = dashboard.widgets.aggregate(m=Max("sort_order"))["m"] or 0
        clean.setdefault("sort_order", last + 10000)
        widget = WorkItemDashboardWidget.objects.create(
            workspace_id=dashboard.workspace_id, dashboard=dashboard, **clean
        )
        return Response(serialize_widget(widget), status=status.HTTP_201_CREATED)


class WorkItemDashboardWidgetDetailEndpoint(BaseAPIView):
    def _widget(self, slug, user, dashboard_id, widget_id):
        dashboard = _visible_dashboards(slug, user).filter(id=dashboard_id).first()
        widget = dashboard.widgets.filter(id=widget_id).first() if dashboard else None
        return dashboard, widget

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def patch(self, request, slug, dashboard_id, widget_id):
        dashboard, widget = self._widget(slug, request.user, dashboard_id, widget_id)
        if widget is None:
            return _not_found()
        if not _can_edit(dashboard, request.user):
            return Response({"error": "Only the owner or a workspace admin can change this dashboard."}, status=403)
        clean, errors = _clean_widget(request.data, partial=True)
        if errors:
            return _bad_request(errors)
        for key, value in clean.items():
            setattr(widget, key, value)
        widget.save()
        return Response(serialize_widget(widget))

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def delete(self, request, slug, dashboard_id, widget_id):
        dashboard, widget = self._widget(slug, request.user, dashboard_id, widget_id)
        if widget is None:
            return _not_found()
        if not _can_edit(dashboard, request.user):
            return Response({"error": "Only the owner or a workspace admin can change this dashboard."}, status=403)
        widget.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemDashboardWidgetDataEndpoint(BaseAPIView):
    """A widget's numbers, computed for the person viewing it."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, dashboard_id, widget_id):
        dashboard = _visible_dashboards(slug, request.user).filter(id=dashboard_id).first()
        widget = dashboard.widgets.filter(id=widget_id).first() if dashboard else None
        if widget is None:
            return _not_found()
        try:
            return Response(widget_data(widget, request.user))
        except WidgetConfigError as e:
            return _bad_request({"config": str(e)})
