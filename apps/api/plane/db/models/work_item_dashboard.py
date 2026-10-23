# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.conf import settings
from django.db import models

# Module imports
from .base import BaseModel


class WorkItemDashboard(BaseModel):
    """A board of widgets summarising work items across the projects a viewer can see."""

    class Access(models.IntegerChoices):
        PRIVATE = 0, "Private"
        WORKSPACE = 1, "Workspace"

    workspace = models.ForeignKey("db.Workspace", related_name="work_item_dashboards", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    owned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="work_item_dashboards", on_delete=models.CASCADE
    )
    access = models.PositiveSmallIntegerField(choices=Access.choices, default=Access.PRIVATE)
    logo_props = models.JSONField(default=dict, blank=True)
    sort_order = models.FloatField(default=65535)

    class Meta:
        verbose_name = "Work Item Dashboard"
        verbose_name_plural = "Work Item Dashboards"
        db_table = "work_item_dashboards"
        ordering = ("sort_order", "-created_at")

    def __str__(self):
        return self.name


class WorkItemDashboardWidget(BaseModel):
    class WidgetType(models.TextChoices):
        NUMBER = "NUMBER", "Number"
        BAR = "BAR", "Bar chart"
        PIE = "PIE", "Pie chart"
        LINE = "LINE", "Line chart"
        TABLE = "TABLE", "Table"

    workspace = models.ForeignKey("db.Workspace", related_name="work_item_dashboard_widgets", on_delete=models.CASCADE)
    dashboard = models.ForeignKey("db.WorkItemDashboard", related_name="widgets", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    widget_type = models.CharField(max_length=16, choices=WidgetType.choices)
    # What to measure: projects, filters, grouping, metric, period... (see utils/work_item_dashboards.py)
    config = models.JSONField(default=dict, blank=True)
    # Columns out of 3 the widget spans
    width = models.PositiveSmallIntegerField(default=1)
    sort_order = models.FloatField(default=65535)

    class Meta:
        verbose_name = "Work Item Dashboard Widget"
        verbose_name_plural = "Work Item Dashboard Widgets"
        db_table = "work_item_dashboard_widgets"
        ordering = ("sort_order", "created_at")

    def __str__(self):
        return f"{self.dashboard_id} - {self.name}"
