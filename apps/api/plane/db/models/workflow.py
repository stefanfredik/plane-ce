# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


class ProjectWorkflow(ProjectBaseModel):
    """State transition rules for a project's work items.

    ``rules`` maps a state id to its settings::

        {
            "allow_creation": bool,
            "transitions": {state id moved to: {"movers": [user ids]}},
            "require": [field keys or property ids],
        }

    ``transitions`` lists the permitted moves out of the state (none listed: any move);
    ``movers`` are the reviewers allowed to make that move (none listed: anyone).
    ``require`` must be filled before a work item enters the state.
    """

    is_enabled = models.BooleanField(default=False)
    rules = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project"],
                condition=Q(deleted_at__isnull=True),
                name="project_workflow_unique_project_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Workflow"
        verbose_name_plural = "Project Workflows"
        db_table = "project_workflows"
        ordering = ("-created_at",)
