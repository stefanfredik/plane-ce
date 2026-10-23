# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from uuid import uuid4

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


def _anchor():
    return uuid4().hex


class IntakeForm(ProjectBaseModel):
    """A public form that files work items into the project's Intake for triage."""

    anchor = models.CharField(max_length=255, unique=True, default=_anchor, db_index=True)
    is_enabled = models.BooleanField(default=False)
    title = models.CharField(max_length=255, blank=True)
    description = models.TextField(blank=True)
    # The type submitted work items get; the project's default type when empty.
    issue_type = models.ForeignKey("db.IssueType", on_delete=models.SET_NULL, null=True, blank=True)
    # Custom properties shown on the form, in order.
    property_ids = models.JSONField(default=list, blank=True)
    require_email = models.BooleanField(default=True)
    success_message = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="intake_form_unique_project_when_deleted_at_null",
            )
        ]
        verbose_name = "Intake Form"
        verbose_name_plural = "Intake Forms"
        db_table = "intake_forms"
        ordering = ("-created_at",)
