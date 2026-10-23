# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


class SlaPolicy(ProjectBaseModel):
    """Response and resolution targets per priority, or per option of a dropdown property.

    ``targets`` maps a priority (or option id) to ``{"response": minutes, "resolution": minutes}``;
    either may be null.
    """

    is_enabled = models.BooleanField(default=False)
    # "priority" or the id of a dropdown property
    based_on = models.CharField(max_length=64, default="priority")
    targets = models.JSONField(default=dict, blank=True)
    # a target is at risk once this share of its time is left
    at_risk_percent = models.PositiveSmallIntegerField(default=25)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="sla_policy_unique_project_when_deleted_at_null",
            )
        ]
        verbose_name = "SLA Policy"
        verbose_name_plural = "SLA Policies"
        db_table = "sla_policies"
        ordering = ("-created_at",)


class IssueSla(ProjectBaseModel):
    """The SLA clock of one work item."""

    issue = models.OneToOneField("db.Issue", on_delete=models.CASCADE, related_name="sla")
    # the priority or option the targets came from
    key = models.CharField(max_length=64)
    started_at = models.DateTimeField()
    response_due_at = models.DateTimeField(null=True, blank=True)
    resolution_due_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    response_breached_at = models.DateTimeField(null=True, blank=True)
    resolution_breached_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Work Item SLA"
        verbose_name_plural = "Work Item SLAs"
        db_table = "issue_slas"
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["resolution_due_at"], name="issue_sla_resolution_due_idx"),
            models.Index(fields=["response_due_at"], name="issue_sla_response_due_idx"),
        ]
