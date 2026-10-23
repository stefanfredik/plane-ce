# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views.customer import (
    CustomerDetailEndpoint,
    CustomerEndpoint,
    CustomerIssuesEndpoint,
    CustomerPropertyDetailEndpoint,
    CustomerPropertyEndpoint,
    CustomerPropertyValuesEndpoint,
    CustomerRequestDetailEndpoint,
    CustomerRequestEndpoint,
    IssueCustomersEndpoint,
)

WS = "workspaces/<str:slug>"

urlpatterns = [
    path(f"{WS}/customers/", CustomerEndpoint.as_view(), name="customers"),
    path(f"{WS}/customers/<uuid:customer_id>/", CustomerDetailEndpoint.as_view(), name="customer"),
    path(f"{WS}/customer-properties/", CustomerPropertyEndpoint.as_view(), name="customer-properties"),
    path(
        f"{WS}/customer-properties/<uuid:property_id>/",
        CustomerPropertyDetailEndpoint.as_view(),
        name="customer-property",
    ),
    path(
        f"{WS}/customers/<uuid:customer_id>/property-values/",
        CustomerPropertyValuesEndpoint.as_view(),
        name="customer-property-values",
    ),
    path(f"{WS}/customers/<uuid:customer_id>/requests/", CustomerRequestEndpoint.as_view(), name="customer-requests"),
    path(
        f"{WS}/customers/<uuid:customer_id>/requests/<uuid:request_id>/",
        CustomerRequestDetailEndpoint.as_view(),
        name="customer-request",
    ),
    path(f"{WS}/customers/<uuid:customer_id>/issues/", CustomerIssuesEndpoint.as_view(), name="customer-issues"),
    path(
        f"{WS}/customers/<uuid:customer_id>/issues/<uuid:issue_id>/",
        CustomerIssuesEndpoint.as_view(),
        name="customer-issue",
    ),
    path(
        f"{WS}/projects/<uuid:project_id>/issues/<uuid:issue_id>/customers/",
        IssueCustomersEndpoint.as_view(),
        name="issue-customers",
    ),
]
