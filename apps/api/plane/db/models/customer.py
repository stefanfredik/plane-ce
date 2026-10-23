# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db import models
from django.db.models import Q

# Module imports
from .base import BaseModel


class Customer(BaseModel):
    """An organisation the workspace serves (e.g. an ISP partner); work items can be linked to it."""

    workspace = models.ForeignKey("db.Workspace", related_name="customers", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description_html = models.TextField(blank=True, default="<p></p>")
    email = models.CharField(max_length=255, blank=True, null=True)
    website_url = models.CharField(max_length=800, blank=True, null=True)
    domain = models.CharField(max_length=255, blank=True, null=True)
    employees = models.PositiveIntegerField(null=True, blank=True)
    stage = models.CharField(max_length=64, blank=True, null=True)
    contract_status = models.CharField(max_length=64, blank=True, null=True)
    revenue = models.CharField(max_length=64, blank=True, null=True)
    logo_props = models.JSONField(default=dict, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "name"],
                condition=Q(deleted_at__isnull=True),
                name="customer_unique_workspace_name_when_deleted_at_null",
            )
        ]
        verbose_name = "Customer"
        verbose_name_plural = "Customers"
        db_table = "customers"
        ordering = ("name",)

    def __str__(self):
        return self.name


class CustomerProperty(BaseModel):
    """A workspace-wide custom field of customers (e.g. "Region", "Account manager")."""

    workspace = models.ForeignKey("db.Workspace", related_name="customer_properties", on_delete=models.CASCADE)
    display_name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    property_type = models.CharField(max_length=32)
    is_multi = models.BooleanField(default=False)
    is_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    sort_order = models.FloatField(default=65535)
    settings = models.JSONField(default=dict, blank=True)
    logo_props = models.JSONField(default=dict, blank=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "display_name"],
                condition=Q(deleted_at__isnull=True),
                name="customer_property_unique_name_when_deleted_at_null",
            )
        ]
        verbose_name = "Customer Property"
        verbose_name_plural = "Customer Properties"
        db_table = "customer_properties"
        ordering = ("sort_order", "created_at")


class CustomerPropertyOption(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="customer_property_options", on_delete=models.CASCADE)
    property = models.ForeignKey("db.CustomerProperty", related_name="options", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=32, blank=True)
    sort_order = models.FloatField(default=65535)
    is_default = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "Customer Property Option"
        verbose_name_plural = "Customer Property Options"
        db_table = "customer_property_options"
        ordering = ("sort_order", "created_at")


class CustomerPropertyValue(BaseModel):
    workspace = models.ForeignKey("db.Workspace", related_name="customer_property_values", on_delete=models.CASCADE)
    customer = models.ForeignKey("db.Customer", related_name="property_values", on_delete=models.CASCADE)
    property = models.ForeignKey("db.CustomerProperty", related_name="values", on_delete=models.CASCADE)
    value_text = models.TextField(null=True, blank=True)
    value_number = models.DecimalField(max_digits=30, decimal_places=10, null=True, blank=True)
    value_boolean = models.BooleanField(null=True, blank=True)
    value_date = models.DateField(null=True, blank=True)
    value_option = models.ForeignKey(
        "db.CustomerPropertyOption", related_name="values", on_delete=models.CASCADE, null=True, blank=True
    )
    value_member = models.ForeignKey(
        "db.User", related_name="customer_property_values", on_delete=models.CASCADE, null=True, blank=True
    )

    class Meta:
        verbose_name = "Customer Property Value"
        verbose_name_plural = "Customer Property Values"
        db_table = "customer_property_values"
        ordering = ("created_at",)


class CustomerRequest(BaseModel):
    """Something a customer asked for or reported; it can point at the work items that address it."""

    workspace = models.ForeignKey("db.Workspace", related_name="customer_requests", on_delete=models.CASCADE)
    customer = models.ForeignKey("db.Customer", related_name="requests", on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    description_html = models.TextField(blank=True, default="<p></p>")
    link = models.CharField(max_length=800, blank=True, null=True)
    external_source = models.CharField(max_length=255, null=True, blank=True)
    external_id = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        verbose_name = "Customer Request"
        verbose_name_plural = "Customer Requests"
        db_table = "customer_requests"
        ordering = ("-created_at",)


class CustomerIssue(BaseModel):
    """A work item linked to a customer, optionally through one of its requests."""

    workspace = models.ForeignKey("db.Workspace", related_name="customer_issues", on_delete=models.CASCADE)
    customer = models.ForeignKey("db.Customer", related_name="customer_issues", on_delete=models.CASCADE)
    issue = models.ForeignKey("db.Issue", related_name="customer_links", on_delete=models.CASCADE)
    customer_request = models.ForeignKey(
        "db.CustomerRequest", related_name="request_issues", on_delete=models.CASCADE, null=True, blank=True
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "issue", "customer_request"],
                condition=Q(deleted_at__isnull=True),
                name="customer_issue_unique_link_when_deleted_at_null",
                nulls_distinct=False,
            )
        ]
        verbose_name = "Customer Work Item"
        verbose_name_plural = "Customer Work Items"
        db_table = "customer_issues"
        ordering = ("-created_at",)
