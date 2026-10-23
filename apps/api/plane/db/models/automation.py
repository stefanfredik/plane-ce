# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models

# Module imports
from .project import ProjectBaseModel


class Automation(ProjectBaseModel):
    """If <trigger> and the work item matches <conditions>, then run <actions>.

    ``trigger``: ``{"type": event or "schedule", ...}``; a schedule adds
    ``frequency`` (daily | weekly | monthly), ``time`` ("HH:MM"), ``days`` (0 = Monday),
    ``day`` (day of month) and ``timezone``.
    ``conditions``: list of ``{"field", "operator", "value"}``, joined by ``match`` (all | any).
    ``actions``: list of ``{"type", ...config}``, run in order.
    """

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_enabled = models.BooleanField(default=False)
    trigger = models.JSONField(default=dict)
    match = models.CharField(max_length=8, default="all")
    conditions = models.JSONField(default=list, blank=True)
    actions = models.JSONField(default=list, blank=True)
    # the last scheduled time a schedule trigger fired for
    schedule_cursor = models.DateTimeField(null=True, blank=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_run_status = models.CharField(max_length=16, blank=True)
    run_count = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Automation"
        verbose_name_plural = "Automations"
        db_table = "automations"
        ordering = ("-created_at",)


class AutomationRun(ProjectBaseModel):
    """One run of an automation on one work item (or a scheduled run that matched nothing)."""

    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    automation = models.ForeignKey(Automation, on_delete=models.CASCADE, related_name="runs")
    issue = models.ForeignKey("db.Issue", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    event = models.CharField(max_length=64)
    status = models.CharField(max_length=16, choices=Status.choices)
    # one line per action: what it did or why it failed
    details = models.JSONField(default=list, blank=True)
    duration_ms = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "Automation Run"
        verbose_name_plural = "Automation Runs"
        db_table = "automation_runs"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["automation", "-created_at"], name="automation_run_recent_idx")]
