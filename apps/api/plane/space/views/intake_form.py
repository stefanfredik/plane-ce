# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

# Module imports
from plane.db.models import IntakeForm
from plane.utils import intake_forms as svc

from .base import BaseAPIView


class IntakeFormSubmitThrottle(AnonRateThrottle):
    """Submissions per visitor IP, to keep spam out of Intake."""

    scope = "intake_form"
    rate = "10/hour"

    def get_rate(self):
        return self.rate


class PublicIntakeFormEndpoint(BaseAPIView):
    permission_classes = [AllowAny]

    def get_throttles(self):
        return [IntakeFormSubmitThrottle()] if self.request.method == "POST" else []

    def _form(self, anchor):
        return (
            IntakeForm.objects.filter(anchor=anchor, is_enabled=True, project__archived_at__isnull=True)
            .select_related("project", "project__workspace")
            .first()
        )

    def get(self, request, anchor):
        form = self._form(anchor)
        if form is None:
            return Response({"error": "This form is not available."}, status=status.HTTP_404_NOT_FOUND)
        return Response(svc.public_form(form))

    def post(self, request, anchor):
        form = self._form(anchor)
        if form is None:
            return Response({"error": "This form is not available."}, status=status.HTTP_404_NOT_FOUND)
        if request.data.get("website"):
            # filled by bots only (the field is hidden from people): pretend it worked
            return Response({"ok": True}, status=status.HTTP_201_CREATED)
        try:
            issue = svc.submit(form, request.data)
        except svc.IntakeFormError as e:
            return Response({"error": "Invalid data", "errors": e.errors}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"ok": True, "reference": f"{form.project.identifier}-{issue.sequence_id}"},
            status=status.HTTP_201_CREATED,
        )
