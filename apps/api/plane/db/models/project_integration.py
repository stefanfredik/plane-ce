# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import secrets

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel


def _anchor():
    return secrets.token_urlsafe(24)


class ProjectIntegration(ProjectBaseModel):
    """A webhook-based integration (GitLab, Sentry) connected to one project.

    ``anchor`` is the unguessable part of the webhook URL; ``secret`` is the GitLab
    secret token or the Sentry client secret used to check signatures.
    """

    class Provider(models.TextChoices):
        GITLAB = "gitlab", "GitLab"
        SENTRY = "sentry", "Sentry"

    provider = models.CharField(max_length=16, choices=Provider.choices)
    anchor = models.CharField(max_length=64, unique=True, default=_anchor, db_index=True)
    secret = models.CharField(max_length=255, blank=True)
    is_enabled = models.BooleanField(default=False)
    config = models.JSONField(default=dict, blank=True)
    last_event_at = models.DateTimeField(null=True, blank=True)
    last_event = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["project", "provider"],
                condition=Q(deleted_at__isnull=True),
                name="project_integration_unique_provider_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Integration"
        verbose_name_plural = "Project Integrations"
        db_table = "project_integrations"
        ordering = ("-created_at",)


class IntegrationLink(ProjectBaseModel):
    """A work item tied to something outside Plane: a Sentry issue or a GitLab merge request."""

    integration = models.ForeignKey(ProjectIntegration, on_delete=models.CASCADE, related_name="links")
    issue = models.ForeignKey("db.Issue", on_delete=models.CASCADE, related_name="integration_links")
    # "sentry_issue:123", "gitlab_mr:<project>!<iid>", "gitlab_commit:<sha>"
    external_key = models.CharField(max_length=255)
    url = models.TextField(blank=True)
    title = models.CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["integration", "external_key", "issue"],
                condition=Q(deleted_at__isnull=True),
                name="integration_link_unique_when_deleted_at_null",
            )
        ]
        verbose_name = "Integration Link"
        verbose_name_plural = "Integration Links"
        db_table = "integration_links"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["integration", "external_key"], name="integration_link_key_idx")]
