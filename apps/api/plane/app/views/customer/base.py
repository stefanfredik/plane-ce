# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
from django.db.models import Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Customer, CustomerProperty, CustomerRequest, Issue, Workspace
from plane.utils import customers as svc

MEMBERS = [ROLE.ADMIN, ROLE.MEMBER]


def _bad_request(errors):
    return Response({"error": "Invalid data", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


def _not_found(what="Customer"):
    return Response({"error": f"{what} not found"}, status=status.HTTP_404_NOT_FOUND)


def _customer(slug, customer_id):
    return Customer.objects.filter(workspace__slug=slug, id=customer_id).first()


class CustomerEndpoint(BaseAPIView):
    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug):
        customers = Customer.objects.filter(workspace__slug=slug)
        if request.GET.get("archived") != "true":
            customers = customers.filter(archived_at__isnull=True)
        search = (request.GET.get("search") or "").strip()
        if search:
            customers = customers.filter(
                Q(name__icontains=search) | Q(domain__icontains=search) | Q(email__icontains=search)
            )
        customers = svc.with_counts(customers, request.user).order_by("name")
        return Response([svc.serialize_customer(c, request.user) for c in customers])

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        try:
            customer = svc.create_customer(workspace.id, request.user, request.data)
            if isinstance(request.data.get("property_values"), dict):
                svc.save_property_values(customer, request.data["property_values"], request.user)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_customer(customer, request.user), status=status.HTTP_201_CREATED)


class CustomerDetailEndpoint(BaseAPIView):
    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        data = svc.serialize_customer(customer, request.user)
        data["property_values"] = svc.property_values(customer)
        return Response(data)

    @allow_permission(MEMBERS, level="WORKSPACE")
    def patch(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        try:
            svc.update_customer(customer, request.user, request.data)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_customer(customer, request.user))

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        svc.delete_customer(customer)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerPropertyEndpoint(BaseAPIView):
    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug):
        props = CustomerProperty.objects.filter(workspace__slug=slug).prefetch_related("options")
        return Response([svc.serialize_property(p) for p in props])

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def post(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        try:
            prop = svc.create_property(workspace.id, request.user, request.data)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_property(prop), status=status.HTTP_201_CREATED)


class CustomerPropertyDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def patch(self, request, slug, property_id):
        prop = CustomerProperty.objects.filter(workspace__slug=slug, id=property_id).first()
        if prop is None:
            return _not_found("Property")
        try:
            prop = svc.update_property(prop, request.user, request.data)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_property(prop))

    @allow_permission([ROLE.ADMIN], level="WORKSPACE")
    def delete(self, request, slug, property_id):
        prop = CustomerProperty.objects.filter(workspace__slug=slug, id=property_id).first()
        if prop is None:
            return _not_found("Property")
        svc.delete_property(prop)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerPropertyValuesEndpoint(BaseAPIView):
    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        return Response(svc.property_values(customer)) if customer else _not_found()

    @allow_permission(MEMBERS, level="WORKSPACE")
    def put(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        try:
            return Response(svc.save_property_values(customer, request.data.get("values", {}), request.user))
        except svc.CustomerError as e:
            return _bad_request(e.errors)


class CustomerRequestEndpoint(BaseAPIView):
    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        return Response([svc.serialize_request(r, request.user) for r in customer.requests.all()])

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        try:
            item = svc.create_request(customer, request.user, request.data)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_request(item, request.user), status=status.HTTP_201_CREATED)


class CustomerRequestDetailEndpoint(BaseAPIView):
    def _request(self, slug, customer_id, request_id):
        return CustomerRequest.objects.filter(workspace__slug=slug, customer_id=customer_id, id=request_id).first()

    @allow_permission(MEMBERS, level="WORKSPACE")
    def patch(self, request, slug, customer_id, request_id):
        item = self._request(slug, customer_id, request_id)
        if item is None:
            return _not_found("Request")
        try:
            svc.update_request(item, request.user, request.data)
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response(svc.serialize_request(item, request.user))

    @allow_permission(MEMBERS, level="WORKSPACE")
    def delete(self, request, slug, customer_id, request_id):
        item = self._request(slug, customer_id, request_id)
        if item is None:
            return _not_found("Request")
        item.request_issues.all().delete(soft=False)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerIssuesEndpoint(BaseAPIView):
    """Work items linked to a customer (only those the viewer can see)."""

    @allow_permission(MEMBERS, level="WORKSPACE")
    def get(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        issues = svc.customer_work_items(customer, request.user, request.GET.get("search"))
        return Response([svc.serialize_work_item(i) for i in issues])

    @allow_permission(MEMBERS, level="WORKSPACE")
    def post(self, request, slug, customer_id):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        try:
            issues = svc.link_issues(customer, request.user, request.data.get("issue_ids") or [])
        except svc.CustomerError as e:
            return _bad_request(e.errors)
        return Response({"linked_work_items": [svc.serialize_work_item(i) for i in issues]})

    @allow_permission(MEMBERS, level="WORKSPACE")
    def delete(self, request, slug, customer_id, issue_id=None):
        customer = _customer(slug, customer_id)
        if customer is None:
            return _not_found()
        svc.unlink_issue(customer, issue_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class IssueCustomersEndpoint(BaseAPIView):
    """Customers of one work item, for the work item sidebar."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        issue = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, id=issue_id).first()
        return Response(svc.issue_customers(issue)) if issue else _not_found("Work item")

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def put(self, request, slug, project_id, issue_id):
        """Set the work item's customers to exactly this list."""
        issue = Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, id=issue_id).first()
        if issue is None:
            return _not_found("Work item")
        wanted = {str(i) for i in request.data.get("customer_ids") or []}
        customers = {str(c.id): c for c in Customer.objects.filter(workspace__slug=slug, id__in=wanted)}
        if set(customers) != wanted:
            return _bad_request({"customer_ids": "Unknown customer."})
        current = {c["id"] for c in svc.issue_customers(issue)}
        for customer_id in current - wanted:
            svc.unlink_issue(Customer.objects.get(id=customer_id), issue.id)
        for customer_id in wanted - current:
            svc.link_issues(customers[customer_id], request.user, [issue.id])
        return Response(svc.issue_customers(issue))
