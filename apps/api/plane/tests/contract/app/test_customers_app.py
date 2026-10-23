# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Customers: records, custom properties, requests and linked work items."""

import json
from uuid import uuid4

import pytest
from django.core.cache import cache
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember


@pytest.fixture(autouse=True)
def reset_api_throttle():
    """API key calls share one rate-limit bucket; start every test with a fresh one."""
    cache.clear()
    yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    return project


@pytest.fixture
def issues(project, workspace, create_user):
    return [
        Issue.objects.create(name=n, workspace=workspace, project=project, created_by=create_user) for n in ("a", "b")
    ]


def ws(workspace, suffix=""):
    return f"/api/workspaces/{workspace.slug}/{suffix}"


@pytest.fixture
def customer(session_client, workspace):
    response = session_client.post(
        ws(workspace, "customers/"),
        {"name": "PT Akses", "email": "NOC@akses.id", "website_url": "https://akses.id", "stage": "Active"},
        format="json",
    )
    assert response.status_code == status.HTTP_201_CREATED
    return response.data


def member(workspace, role=15):
    user = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


@pytest.mark.contract
class TestCustomers:
    def test_create_normalises_and_validates(self, session_client, workspace, customer):
        duplicate = session_client.post(ws(workspace, "customers/"), {"name": "PT Akses"}, format="json")
        invalid = session_client.post(
            ws(workspace, "customers/"), {"name": "X", "email": "nope", "website_url": "ftp://x"}, format="json"
        )

        assert customer["email"] == "noc@akses.id"
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST
        assert set(invalid.data["errors"]) == {"email", "website_url"}

    def test_search_and_archive(self, session_client, workspace, customer):
        session_client.post(ws(workspace, "customers/"), {"name": "Jaga Network"}, format="json")
        session_client.patch(ws(workspace, f"customers/{customer['id']}/"), {"archived": True}, format="json")

        listed = [c["name"] for c in session_client.get(ws(workspace, "customers/")).data]
        found = [c["name"] for c in session_client.get(ws(workspace, "customers/"), {"search": "jaga"}).data]

        assert listed == ["Jaga Network"]
        assert found == ["Jaga Network"]

    def test_guests_cannot_see_customers(self, api_client, workspace, customer):
        api_client.force_authenticate(user=member(workspace, role=5))

        assert api_client.get(ws(workspace, "customers/")).status_code == status.HTTP_403_FORBIDDEN

    def test_only_admins_delete(self, api_client, workspace, customer, create_user):
        # api_client and session_client are the same client object, so switch users explicitly
        api_client.force_authenticate(user=member(workspace))
        assert api_client.delete(ws(workspace, f"customers/{customer['id']}/")).status_code == 403

        api_client.force_authenticate(user=create_user)
        assert api_client.delete(ws(workspace, f"customers/{customer['id']}/")).status_code == 204


@pytest.mark.contract
class TestCustomerProperties:
    def test_property_values(self, session_client, workspace, customer):
        region = session_client.post(
            ws(workspace, "customer-properties/"),
            {"display_name": "Region", "property_type": "OPTION", "options": [{"name": "Bali"}, {"name": "NTT"}]},
            format="json",
        ).data
        seats = session_client.post(
            ws(workspace, "customer-properties/"), {"display_name": "Seats", "property_type": "NUMBER"}, format="json"
        ).data
        bali = region["options"][0]["id"]

        saved = session_client.put(
            ws(workspace, f"customers/{customer['id']}/property-values/"),
            {"values": {region["id"]: [bali], seats["id"]: ["12"]}},
            format="json",
        )
        bad = session_client.put(
            ws(workspace, f"customers/{customer['id']}/property-values/"),
            {"values": {seats["id"]: ["many"]}},
            format="json",
        )

        assert saved.status_code == status.HTTP_200_OK
        assert saved.data[region["id"]] == [bali]
        assert saved.data[seats["id"]] == ["12"]
        assert bad.status_code == status.HTTP_400_BAD_REQUEST

    def test_members_cannot_manage_properties(self, api_client, workspace):
        api_client.force_authenticate(user=member(workspace))

        response = api_client.post(
            ws(workspace, "customer-properties/"), {"display_name": "Region", "property_type": "TEXT"}, format="json"
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestCustomerWorkItems:
    def test_requests_link_work_items(self, session_client, workspace, customer, issues):
        response = session_client.post(
            ws(workspace, f"customers/{customer['id']}/requests/"),
            {"name": "ONT offline", "link": "https://wa.me/1", "work_item_ids": [str(issues[0].id)]},
            format="json",
        )

        linked = session_client.get(ws(workspace, f"customers/{customer['id']}/issues/")).data
        detail = session_client.get(ws(workspace, f"customers/{customer['id']}/")).data

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["work_item_ids"] == [str(issues[0].id)]
        assert [i["name"] for i in linked] == ["a"]
        assert detail["work_item_count"] == 1
        assert detail["customer_request_count"] == 1

    def test_issue_sidebar_sets_customers(self, session_client, workspace, project, customer, issues):
        url = ws(workspace, f"projects/{project.id}/issues/{issues[1].id}/customers/")

        set_response = session_client.put(url, {"customer_ids": [customer["id"]]}, format="json")
        cleared = session_client.put(url, {"customer_ids": []}, format="json")

        assert [c["name"] for c in set_response.data] == ["PT Akses"]
        assert cleared.data == []

    def test_cannot_link_items_the_user_cannot_see(self, session_client, api_client, workspace, customer, issues):
        outsider = member(workspace)
        api_client.force_authenticate(user=outsider)

        response = api_client.post(
            ws(workspace, f"customers/{customer['id']}/issues/"), {"issue_ids": [str(issues[0].id)]}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_filter_work_items_by_customer(self, session_client, workspace, project, customer, issues):
        session_client.post(
            ws(workspace, f"customers/{customer['id']}/issues/"), {"issue_ids": [str(issues[1].id)]}, format="json"
        )

        rows = session_client.get(
            ws(workspace, f"projects/{project.id}/issues/"),
            {"filters": json.dumps({"customer_id__in": customer["id"]})},
        ).data
        rows = rows["results"] if isinstance(rows, dict) else rows

        assert [r["name"] for r in rows] == ["b"]


@pytest.mark.contract
class TestPublicCustomerApi:
    def test_sdk_paths(self, api_key_client, workspace, issues):
        base = f"/api/v1/workspaces/{workspace.slug}"
        created = api_key_client.post(
            f"{base}/customers/", {"name": "Binar", "external_source": "crm", "external_id": "42"}, format="json"
        )
        cid = created.data["id"]
        linked = api_key_client.post(
            f"{base}/customers/{cid}/issues/", {"issue_ids": [str(issues[0].id)]}, format="json"
        )
        listed = api_key_client.get(f"{base}/customers/{cid}/issues/")
        removed = api_key_client.delete(f"{base}/customers/?external_source=crm&external_id=42")

        assert created.status_code == status.HTTP_201_CREATED
        assert [w["name"] for w in linked.data["linked_work_items"]] == ["a"]
        assert listed.data[0]["project__identifier"] == "BUG"
        assert removed.status_code == status.HTTP_204_NO_CONTENT
        assert api_key_client.get(f"{base}/customers/{cid}/").status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestCustomerProperty:
    """A "Customer" work item property is kept in step with the customer's linked work items."""

    @pytest.fixture
    def prop(self, session_client, workspace, project):
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        task = session_client.post(f"{base}/work-item-types/enable/", {}, format="json").data["types"][0]["id"]
        response = session_client.post(
            f"{base}/work-item-types/{task}/properties/",
            {"display_name": "Customer", "property_type": "CUSTOMER"},
            format="json",
        )
        assert response.status_code == status.HTTP_201_CREATED
        return response.data

    def values_url(self, workspace, project, issue):
        return ws(workspace, f"projects/{project.id}/issues/{issue.id}/property-values/")

    def items(self, session_client, workspace, customer):
        return [i["name"] for i in session_client.get(ws(workspace, f"customers/{customer['id']}/issues/")).data]

    def test_choosing_and_clearing_links_the_work_item(
        self, session_client, workspace, project, customer, issues, prop
    ):
        url = self.values_url(workspace, project, issues[0])

        chosen = session_client.put(url, {"values": {prop["id"]: [customer["id"]]}}, format="json")
        linked = self.items(session_client, workspace, customer)
        session_client.put(url, {"values": {prop["id"]: []}}, format="json")

        assert chosen.status_code == status.HTTP_200_OK
        assert linked == ["a"]
        assert self.items(session_client, workspace, customer) == []

    def test_unlinking_from_the_customer_clears_the_property(
        self, session_client, workspace, project, customer, issues, prop
    ):
        url = self.values_url(workspace, project, issues[0])
        session_client.put(url, {"values": {prop["id"]: [customer["id"]]}}, format="json")

        session_client.delete(ws(workspace, f"customers/{customer['id']}/issues/{issues[0].id}/"))

        assert session_client.get(url).data[prop["id"]] == []

    def test_request_links_survive_clearing_the_property(
        self, session_client, workspace, project, customer, issues, prop
    ):
        session_client.post(
            ws(workspace, f"customers/{customer['id']}/requests/"),
            {"name": "ONT offline", "work_item_ids": [str(issues[0].id)]},
            format="json",
        )
        url = self.values_url(workspace, project, issues[0])
        session_client.put(url, {"values": {prop["id"]: [customer["id"]]}}, format="json")

        session_client.put(url, {"values": {prop["id"]: []}}, format="json")

        assert self.items(session_client, workspace, customer) == ["a"]

    def test_archived_customers_cannot_be_chosen(self, session_client, workspace, project, customer, issues, prop):
        session_client.patch(ws(workspace, f"customers/{customer['id']}/"), {"archived": True}, format="json")

        response = session_client.put(
            self.values_url(workspace, project, issues[0]), {"values": {prop["id"]: [customer["id"]]}}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_guests_do_not_see_customer_values(
        self, session_client, api_client, workspace, project, customer, issues, prop
    ):
        url = self.values_url(workspace, project, issues[0])
        session_client.put(url, {"values": {prop["id"]: [customer["id"]]}}, format="json")
        guest = member(workspace, role=5)
        ProjectMember.objects.create(project=project, member=guest, role=5, is_active=True)
        api_client.force_authenticate(user=guest)

        single = api_client.get(url).data
        batch = api_client.get(
            ws(workspace, f"projects/{project.id}/property-values/"), {"issue_ids": str(issues[0].id)}
        ).data

        assert prop["id"] not in single
        assert prop["id"] not in batch.get(str(issues[0].id), {})

    def test_filter_and_group_by_customer(self, session_client, workspace, project, customer, issues, prop):
        session_client.put(
            self.values_url(workspace, project, issues[1]), {"values": {prop["id"]: [customer["id"]]}}, format="json"
        )
        list_url = ws(workspace, f"projects/{project.id}/issues/")

        filtered = session_client.get(
            list_url, {"filters": json.dumps({f"customproperty_{prop['id']}__in": customer["id"]})}
        ).data
        grouped = session_client.get(list_url, {"group_by": f"customproperty_{prop['id']}", "per_page": 50}).data

        rows = filtered["results"] if isinstance(filtered, dict) else filtered
        assert [r["name"] for r in rows] == ["b"]
        assert grouped["results"][customer["id"]]["total_results"] == 1

    def test_list_by_ids_and_limit(self, session_client, workspace, customer):
        other = session_client.post(ws(workspace, "customers/"), {"name": "Jaga"}, format="json").data

        by_ids = session_client.get(ws(workspace, "customers/"), {"ids": other["id"]}).data
        limited = session_client.get(ws(workspace, "customers/"), {"limit": 1}).data

        assert [c["name"] for c in by_ids] == ["Jaga"]
        assert len(limited) == 1
