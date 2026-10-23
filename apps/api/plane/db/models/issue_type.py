# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .project import ProjectBaseModel
from .base import BaseModel
from .workspace import WorkspaceBaseModel


class IssueType(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="issue_types", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    logo_props = models.JSONField(default=dict)
    is_epic = models.BooleanField(default=False)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    level = models.FloatField(default=0)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        verbose_name = "Issue Type"
        verbose_name_plural = "Issue Types"
        db_table = "issue_types"

    def __str__(self):
        return self.name


class ProjectIssueType(ProjectBaseModel):
    issue_type = models.ForeignKey("db.IssueType", related_name="project_issue_types", on_delete=models.CASCADE)
    level = models.PositiveIntegerField(default=0)
    is_default = models.BooleanField(default=False)

    class Meta:
        unique_together = ["project", "issue_type", "deleted_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["project", "issue_type"],
                condition=Q(deleted_at__isnull=True),
                name="project_issue_type_unique_project_issue_type_when_deleted_at_null",
            )
        ]
        verbose_name = "Project Issue Type"
        verbose_name_plural = "Project Issue Types"
        db_table = "project_issue_types"
        ordering = ("project", "issue_type")

    def __str__(self):
        return f"{self.project} - {self.issue_type}"


class IssuePropertyType(models.TextChoices):
    TEXT = "TEXT", "Text"
    PARAGRAPH = "PARAGRAPH", "Paragraph"
    NUMBER = "NUMBER", "Number"
    OPTION = "OPTION", "Option"
    BOOLEAN = "BOOLEAN", "Boolean"
    DATE = "DATE", "Date"
    URL = "URL", "URL"
    MEMBER = "MEMBER", "Member"
    EMAIL = "EMAIL", "Email"
    # An attachment of the work item itself
    FILE = "FILE", "File"
    # Read-only number computed from other number properties (settings.formula)
    FORMULA = "FORMULA", "Formula"
    # Two-level dropdown: options with a parent option
    CASCADING = "CASCADING", "Cascading"
    RICH_TEXT = "RICH_TEXT", "Rich text"
    # Another work item of the workspace
    RELATION = "RELATION", "Work item relation"


# Property types that may hold several values on one work item.
MULTI_VALUE_PROPERTY_TYPES = {
    IssuePropertyType.OPTION,
    IssuePropertyType.MEMBER,
    IssuePropertyType.FILE,
    IssuePropertyType.RELATION,
}


class IssueProperty(ProjectBaseModel):
    """A custom field in a project's property pool, e.g. "Severity".

    Properties are linked to the types that use them (IssueTypeProperty), so one
    property can be shared by several types of the project.
    """

    display_name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    property_type = models.CharField(max_length=32, choices=IssuePropertyType.choices)
    is_multi = models.BooleanField(default=False)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.FloatField(default=65535)
    # Values pre-filled on new work items, as the same shape the API accepts.
    default_value = models.JSONField(default=list, blank=True)
    settings = models.JSONField(default=dict, blank=True)
    logo_props = models.JSONField(default=dict, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        verbose_name = "Issue Property"
        verbose_name_plural = "Issue Properties"
        db_table = "issue_properties"
        ordering = ("sort_order", "created_at")

    def __str__(self):
        return self.display_name


class IssueTypeProperty(WorkspaceBaseModel):
    """A property of the pool used by a work item type, with its position on that type."""

    issue_type = models.ForeignKey("db.IssueType", related_name="property_links", on_delete=models.CASCADE)
    property = models.ForeignKey("db.IssueProperty", related_name="type_links", on_delete=models.CASCADE)
    sort_order = models.FloatField(default=65535)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["issue_type", "property"],
                condition=Q(deleted_at__isnull=True),
                name="issue_type_property_unique_when_deleted_at_null",
            )
        ]
        verbose_name = "Issue Type Property"
        verbose_name_plural = "Issue Type Properties"
        db_table = "issue_type_properties"
        ordering = ("sort_order", "created_at")


class IssuePropertyOption(ProjectBaseModel):
    property = models.ForeignKey("db.IssueProperty", related_name="options", on_delete=models.CASCADE)
    # Second-level options of a cascading property point at their first-level option.
    parent = models.ForeignKey("self", related_name="children", on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=32, blank=True)
    sort_order = models.FloatField(default=65535)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["property", "parent", "name"],
                condition=Q(deleted_at__isnull=True),
                name="issue_property_option_unique_parent_name_when_deleted_at_null",
                nulls_distinct=False,
            )
        ]
        verbose_name = "Issue Property Option"
        verbose_name_plural = "Issue Property Options"
        db_table = "issue_property_options"
        ordering = ("sort_order", "created_at")

    def __str__(self):
        return f"{self.property} - {self.name}"


class IssuePropertyValue(ProjectBaseModel):
    """One value of a property on a work item; multi-value properties keep one row per value."""

    issue = models.ForeignKey("db.Issue", related_name="property_values", on_delete=models.CASCADE)
    property = models.ForeignKey("db.IssueProperty", related_name="values", on_delete=models.CASCADE)
    value_text = models.TextField(null=True, blank=True)
    value_number = models.DecimalField(max_digits=30, decimal_places=10, null=True, blank=True)
    value_boolean = models.BooleanField(null=True, blank=True)
    value_date = models.DateField(null=True, blank=True)
    value_option = models.ForeignKey(
        "db.IssuePropertyOption", related_name="values", on_delete=models.CASCADE, null=True, blank=True
    )
    value_member = models.ForeignKey(
        "db.User", related_name="issue_property_values", on_delete=models.CASCADE, null=True, blank=True
    )
    value_issue = models.ForeignKey(
        "db.Issue", related_name="referenced_by_property_values", on_delete=models.CASCADE, null=True, blank=True
    )
    value_asset = models.ForeignKey(
        "db.FileAsset", related_name="property_values", on_delete=models.CASCADE, null=True, blank=True
    )

    class Meta:
        indexes = [models.Index(fields=["issue", "property"], name="issue_prop_val_issue_prop_idx")]
        verbose_name = "Issue Property Value"
        verbose_name_plural = "Issue Property Values"
        db_table = "issue_property_values"
        ordering = ("created_at",)

    def __str__(self):
        return f"{self.issue_id} - {self.property_id}"
