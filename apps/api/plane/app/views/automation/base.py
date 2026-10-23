# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Automation, AutomationRun, Issue, Project
from plane.utils import automations as svc

MAX_RUNS = 100


class AutomationEndpoint(BaseAPIView):
    """A project's custom automations (project admins)."""

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id):
        rows = Automation.objects.filter(workspace__slug=slug, project_id=project_id).order_by("created_at")
        return Response([svc.serialize_automation(a) for a in rows])

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        try:
            automation = svc.save_automation(project, request.user, request.data)
        except svc.AutomationError as e:
            return Response({"error": "Invalid data", "errors": e.errors}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_automation(automation), status=status.HTTP_201_CREATED)


class AutomationDetailEndpoint(BaseAPIView):
    def _get(self, slug, project_id, pk):
        return Automation.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id, pk):
        return Response(svc.serialize_automation(self._get(slug, project_id, pk)))

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, pk):
        automation = self._get(slug, project_id, pk)
        try:
            automation = svc.save_automation(automation.project, request.user, request.data, automation)
        except svc.AutomationError as e:
            return Response({"error": "Invalid data", "errors": e.errors}, status=status.HTTP_400_BAD_REQUEST)
        return Response(svc.serialize_automation(automation))

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, pk):
        automation = self._get(slug, project_id, pk)
        if automation.is_enabled:
            return Response(
                {"error": "Automation must be disabled before deleting it."}, status=status.HTTP_400_BAD_REQUEST
            )
        automation.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class AutomationRunEndpoint(BaseAPIView):
    """Run history, and running an automation now to try it out."""

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id, pk):
        runs = AutomationRun.objects.filter(
            workspace__slug=slug, project_id=project_id, automation_id=pk
        ).select_related("issue__project")
        if request.GET.get("status") in AutomationRun.Status.values:
            runs = runs.filter(status=request.GET["status"])
        return Response([svc.serialize_run(r) for r in runs.order_by("-created_at")[:MAX_RUNS]])

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, pk):
        automation = Automation.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if not automation.actions:
            return Response({"error": "Add at least one action first."}, status=status.HTTP_400_BAD_REQUEST)
        if automation.trigger.get("type") == "schedule":
            matched = svc.run_schedule(automation)
            return Response({"matched": matched})
        issue = (
            Issue.issue_objects.filter(project_id=project_id, pk=request.data.get("issue_id"))
            .select_related("state", "project", "workspace")
            .first()
        )
        if issue is None:
            return Response({"error": "Choose a work item to run it on."}, status=status.HTTP_400_BAD_REQUEST)
        # a manual run skips the trigger and the conditions
        run = svc.run(automation, issue, "manual")
        return Response(svc.serialize_run(run))
