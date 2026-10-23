# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public (API key) customer endpoints, following Plane's published REST shape (SDK `customers`)."""

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.api.views.base import BaseAPIView
from plane.db.models import Customer, CustomerProperty, CustomerRequest, Workspace, WorkspaceMember
from plane.utils import customers as svc


def _member(user, slug, admin=False):
    roles = [20] if admin else [15, 20]
    return WorkspaceMember.objects.filter(member=user, workspace__slug=slug, role__in=roles, is_active=True).exists()


def _forbidden():
    return Response({"error": "You don't have the required permissions."}, status=status.HTTP_403_FORBIDDEN)


def _bad(errors):
    return Response({"error": "Invalid data", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


def _missing(what="Customer"):
    return Response({"error": f"{what} not found"}, status=status.HTTP_404_NOT_FOUND)


class CustomerListCreateAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def get(self, request, slug):
        if not _member(request.user, slug):
            return _forbidden()
        customers = Customer.objects.filter(workspace__slug=slug, archived_at__isnull=True).order_by("name")
        return Response([svc.serialize_customer(c, request.user) for c in customers])

    def post(self, request, slug):
        if not _member(request.user, slug):
            return _forbidden()
        workspace = Workspace.objects.get(slug=slug)
        try:
            customer = svc.create_customer(workspace.id, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_customer(customer, request.user), status=status.HTTP_201_CREATED)

    def delete(self, request, slug):
        """Delete by external reference (external_source + external_id); no match is not an error."""
        if not _member(request.user, slug, admin=True):
            return _forbidden()
        source, ext_id = request.GET.get("external_source"), request.GET.get("external_id")
        if not (source and ext_id):
            return _bad({"external_id": "Pass external_source and external_id."})
        for customer in Customer.objects.filter(workspace__slug=slug, external_source=source, external_id=ext_id):
            svc.delete_customer(customer)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerDetailAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def _get(self, slug, customer_id):
        return Customer.objects.filter(workspace__slug=slug, id=customer_id).first()

    def get(self, request, slug, customer_id):
        if not _member(request.user, slug):
            return _forbidden()
        customer = self._get(slug, customer_id)
        return Response(svc.serialize_customer(customer, request.user)) if customer else _missing()

    def patch(self, request, slug, customer_id):
        if not _member(request.user, slug):
            return _forbidden()
        customer = self._get(slug, customer_id)
        if customer is None:
            return _missing()
        try:
            svc.update_customer(customer, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_customer(customer, request.user))

    def delete(self, request, slug, customer_id):
        if not _member(request.user, slug, admin=True):
            return _forbidden()
        customer = self._get(slug, customer_id)
        if customer is None:
            return _missing()
        svc.delete_customer(customer)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerPropertyListCreateAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def get(self, request, slug):
        if not _member(request.user, slug):
            return _forbidden()
        props = CustomerProperty.objects.filter(workspace__slug=slug).prefetch_related("options")
        return Response([svc.serialize_property(p) for p in props])

    def post(self, request, slug):
        if not _member(request.user, slug, admin=True):
            return _forbidden()
        workspace = Workspace.objects.get(slug=slug)
        try:
            prop = svc.create_property(workspace.id, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_property(prop), status=status.HTTP_201_CREATED)


class CustomerPropertyDetailAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def _get(self, slug, property_id):
        return CustomerProperty.objects.filter(workspace__slug=slug, id=property_id).first()

    def get(self, request, slug, property_id):
        if not _member(request.user, slug):
            return _forbidden()
        prop = self._get(slug, property_id)
        return Response(svc.serialize_property(prop)) if prop else _missing("Property")

    def patch(self, request, slug, property_id):
        if not _member(request.user, slug, admin=True):
            return _forbidden()
        prop = self._get(slug, property_id)
        if prop is None:
            return _missing("Property")
        try:
            prop = svc.update_property(prop, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_property(prop))

    def delete(self, request, slug, property_id):
        if not _member(request.user, slug, admin=True):
            return _forbidden()
        prop = self._get(slug, property_id)
        if prop is None:
            return _missing("Property")
        svc.delete_property(prop)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerPropertyValuesAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def _customer(self, slug, customer_id):
        return Customer.objects.filter(workspace__slug=slug, id=customer_id).first()

    def get(self, request, slug, customer_id, property_id=None):
        if not _member(request.user, slug):
            return _forbidden()
        customer = self._customer(slug, customer_id)
        if customer is None:
            return _missing()
        values = svc.property_values(customer)
        return Response(values.get(str(property_id), []) if property_id else values)

    def post(self, request, slug, customer_id, property_id=None):
        if not _member(request.user, slug):
            return _forbidden()
        customer = self._customer(slug, customer_id)
        if customer is None:
            return _missing()
        if property_id:
            payload = {str(property_id): request.data.get("values", request.data.get("value"))}
        else:
            payload = request.data.get("customer_property_values", request.data.get("values", {}))
        try:
            values = svc.save_property_values(customer, payload, request.user)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(values.get(str(property_id), []) if property_id else values)

    patch = post


class CustomerRequestListCreateAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def get(self, request, slug, customer_id):
        if not _member(request.user, slug):
            return _forbidden()
        customer = Customer.objects.filter(workspace__slug=slug, id=customer_id).first()
        if customer is None:
            return _missing()
        return Response([svc.serialize_request(r, request.user) for r in customer.requests.all()])

    def post(self, request, slug, customer_id):
        if not _member(request.user, slug):
            return _forbidden()
        customer = Customer.objects.filter(workspace__slug=slug, id=customer_id).first()
        if customer is None:
            return _missing()
        try:
            item = svc.create_request(customer, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_request(item, request.user), status=status.HTTP_201_CREATED)


class CustomerRequestDetailAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def _get(self, slug, customer_id, request_id):
        return CustomerRequest.objects.filter(workspace__slug=slug, customer_id=customer_id, id=request_id).first()

    def get(self, request, slug, customer_id, request_id):
        if not _member(request.user, slug):
            return _forbidden()
        item = self._get(slug, customer_id, request_id)
        return Response(svc.serialize_request(item, request.user)) if item else _missing("Request")

    def patch(self, request, slug, customer_id, request_id):
        if not _member(request.user, slug):
            return _forbidden()
        item = self._get(slug, customer_id, request_id)
        if item is None:
            return _missing("Request")
        try:
            svc.update_request(item, request.user, request.data)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(svc.serialize_request(item, request.user))

    def delete(self, request, slug, customer_id, request_id):
        if not _member(request.user, slug):
            return _forbidden()
        item = self._get(slug, customer_id, request_id)
        if item is None:
            return _missing("Request")
        item.request_issues.all().delete(soft=False)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomerIssuesAPIEndpoint(BaseAPIView):
    use_read_replica = False

    def get(self, request, slug, customer_id, issue_id=None):
        if not _member(request.user, slug):
            return _forbidden()
        customer = Customer.objects.filter(workspace__slug=slug, id=customer_id).first()
        if customer is None:
            return _missing()
        issues = svc.customer_work_items(customer, request.user, request.GET.get("search"))
        if request.GET.get("customer_request_id"):
            issues = issues.filter(customer_links__customer_request_id=request.GET["customer_request_id"])
        return Response([svc.serialize_work_item(i) for i in issues])

    def post(self, request, slug, customer_id, issue_id=None):
        if not _member(request.user, slug):
            return _forbidden()
        customer = Customer.objects.filter(workspace__slug=slug, id=customer_id).first()
        if customer is None:
            return _missing()
        req = None
        if request.GET.get("customer_request_id"):
            req = customer.requests.filter(id=request.GET["customer_request_id"]).first()
            if req is None:
                return _missing("Request")
        try:
            issues = svc.link_issues(customer, request.user, request.data.get("issue_ids") or [], req)
        except svc.CustomerError as e:
            return _bad(e.errors)
        return Response(
            {"message": "Work items linked", "linked_work_items": [svc.serialize_work_item(i) for i in issues]}
        )

    def delete(self, request, slug, customer_id, issue_id=None):
        if not _member(request.user, slug):
            return _forbidden()
        customer = Customer.objects.filter(workspace__slug=slug, id=customer_id).first()
        if customer is None or issue_id is None:
            return _missing()
        req = (
            customer.requests.filter(id=request.GET.get("customer_request_id")).first()
            if request.GET.get("customer_request_id")
            else None
        )
        svc.unlink_issue(customer, issue_id, req)
        return Response(status=status.HTTP_204_NO_CONTENT)
