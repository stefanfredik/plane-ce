# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.api.views.customer import (
    CustomerDetailAPIEndpoint,
    CustomerIssuesAPIEndpoint,
    CustomerListCreateAPIEndpoint,
    CustomerPropertyDetailAPIEndpoint,
    CustomerPropertyListCreateAPIEndpoint,
    CustomerPropertyValuesAPIEndpoint,
    CustomerRequestDetailAPIEndpoint,
    CustomerRequestListCreateAPIEndpoint,
)

WS = "workspaces/<str:slug>"
C = f"{WS}/customers/<uuid:customer_id>"

urlpatterns = [
    path(f"{WS}/customers/", CustomerListCreateAPIEndpoint.as_view(), name="api-customers"),
    path(f"{C}/", CustomerDetailAPIEndpoint.as_view(), name="api-customer"),
    path(f"{WS}/customer-properties/", CustomerPropertyListCreateAPIEndpoint.as_view(), name="api-customer-properties"),
    path(
        f"{WS}/customer-properties/<uuid:property_id>/",
        CustomerPropertyDetailAPIEndpoint.as_view(),
        name="api-customer-property",
    ),
    path(f"{C}/property-values/", CustomerPropertyValuesAPIEndpoint.as_view(), name="api-customer-property-values"),
    path(
        f"{C}/property-values/<uuid:property_id>/",
        CustomerPropertyValuesAPIEndpoint.as_view(),
        name="api-customer-property-value",
    ),
    path(f"{C}/requests/", CustomerRequestListCreateAPIEndpoint.as_view(), name="api-customer-requests"),
    path(f"{C}/requests/<uuid:request_id>/", CustomerRequestDetailAPIEndpoint.as_view(), name="api-customer-request"),
    path(f"{C}/issues/", CustomerIssuesAPIEndpoint.as_view(), name="api-customer-issues"),
    path(f"{C}/issues/<uuid:issue_id>/", CustomerIssuesAPIEndpoint.as_view(), name="api-customer-issue"),
]
