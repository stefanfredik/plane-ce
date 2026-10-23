# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work item types and custom properties (web app API)."""

from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueProperty,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    return project


@pytest.fixture
def existing_issue(db, workspace, project, create_user):
    return Issue.objects.create(name="Old bug", workspace=workspace, project=project, created_by=create_user)


def url(workspace, project, suffix=""):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/{suffix}"


@pytest.fixture
def enabled(session_client, workspace, project):
    response = session_client.post(url(workspace, project, "work-item-types/enable/"))
    assert response.status_code == status.HTTP_200_OK
    return response.data


@pytest.fixture
def bug_type(session_client, workspace, project, enabled):
    response = session_client.post(url(workspace, project, "work-item-types/"), {"name": "Bug"}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return response.data


def add_property(client, workspace, project, type_id, **body):
    return client.post(url(workspace, project, f"work-item-types/{type_id}/properties/"), body, format="json")


@pytest.mark.contract
class TestEnableTypes:
    def test_enable_creates_default_type_and_types_existing_items(
        self, session_client, workspace, project, existing_issue
    ):
        response = session_client.post(url(workspace, project, "work-item-types/enable/"))

        assert response.status_code == status.HTTP_200_OK
        assert response.data["is_enabled"] is True
        [default] = response.data["types"]
        assert default["is_default"] is True
        assert default["issue_count"] == 1
        existing_issue.refresh_from_db()
        assert str(existing_issue.type_id) == default["id"]
        project.refresh_from_db()
        assert project.is_issue_type_enabled is True

    def test_enable_twice_keeps_one_default(self, session_client, workspace, project):
        session_client.post(url(workspace, project, "work-item-types/enable/"))
        response = session_client.post(url(workspace, project, "work-item-types/enable/"))

        assert [t["is_default"] for t in response.data["types"]] == [True]

    def test_cannot_add_type_before_enabling(self, session_client, workspace, project):
        response = session_client.post(url(workspace, project, "work-item-types/"), {"name": "Bug"}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_type_names_are_unique_per_project(self, session_client, workspace, project, bug_type):
        response = session_client.post(url(workspace, project, "work-item-types/"), {"name": "bug"}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_default_type_cannot_be_deleted(self, session_client, workspace, project, enabled):
        default_id = enabled["types"][0]["id"]
        response = session_client.delete(url(workspace, project, f"work-item-types/{default_id}/"))

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestProperties:
    def test_option_property_needs_options(self, session_client, workspace, project, bug_type):
        response = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Severity", property_type="OPTION"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "options" in response.data["errors"]

    def test_only_option_and_member_can_be_multi(self, session_client, workspace, project, bug_type):
        response = add_property(
            session_client,
            workspace,
            project,
            bug_type["id"],
            display_name="Steps",
            property_type="TEXT",
            is_multi=True,
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_property_type_is_fixed(self, session_client, workspace, project, bug_type):
        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Build", property_type="TEXT"
        ).data
        response = session_client.patch(
            url(workspace, project, f"work-item-types/{bug_type['id']}/properties/{prop['id']}/"),
            {"property_type": "NUMBER"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_options_sync_keeps_ids_and_drops_removed(self, session_client, workspace, project, bug_type):
        prop = add_property(
            session_client,
            workspace,
            project,
            bug_type["id"],
            display_name="Severity",
            property_type="OPTION",
            options=[{"name": "Low"}, {"name": "High"}],
        ).data
        low, high = prop["options"]
        response = session_client.patch(
            url(workspace, project, f"work-item-types/{bug_type['id']}/properties/{prop['id']}/"),
            {"options": [{"id": high["id"], "name": "High"}, {"name": "Critical"}]},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        names = [o["name"] for o in response.data["options"]]
        assert names == ["High", "Critical"]
        assert response.data["options"][0]["id"] == high["id"]

    def test_members_cannot_manage_types(self, api_client, workspace, project, bug_type):
        member = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
        api_client.force_authenticate(user=member)

        response = add_property(
            api_client, workspace, project, bug_type["id"], display_name="Build", property_type="TEXT"
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestPropertyValues:
    @pytest.fixture
    def bug_fields(self, session_client, workspace, project, bug_type):
        base = (session_client, workspace, project, bug_type["id"])
        severity = add_property(
            *base,
            display_name="Severity",
            property_type="OPTION",
            is_required=True,
            options=[{"name": "Minor"}, {"name": "Major"}],
        ).data
        steps = add_property(*base, display_name="Steps to reproduce", property_type="PARAGRAPH").data
        page = add_property(*base, display_name="Page URL", property_type="URL").data
        hits = add_property(*base, display_name="Affected users", property_type="NUMBER").data
        return {"severity": severity, "steps": steps, "page": page, "hits": hits}

    @pytest.fixture
    def bug(self, session_client, workspace, project, bug_type):
        response = session_client.post(
            url(workspace, project, "issues/"), {"name": "Login fails", "type_id": bug_type["id"]}, format="json"
        )
        assert response.status_code == status.HTTP_201_CREATED
        return Issue.objects.get(id=response.data["id"])

    def values_url(self, workspace, project, issue):
        return url(workspace, project, f"issues/{issue.id}/property-values/")

    def test_new_item_without_type_gets_default(self, session_client, workspace, project, enabled):
        response = session_client.post(url(workspace, project, "issues/"), {"name": "Untyped"}, format="json")

        assert response.status_code == status.HTTP_201_CREATED
        assert Issue.objects.get(id=response.data["id"]).type_id is not None
        assert str(response.data["type_id"]) == enabled["types"][0]["id"]

    def test_type_from_another_project_is_rejected(self, session_client, workspace, project, bug_type, create_user):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=create_user)
        ProjectMember.objects.create(project=other, member=create_user, role=20, is_active=True)

        response = session_client.post(
            url(workspace, other, "issues/"), {"name": "Cross", "type_id": bug_type["id"]}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_create_requires_required_properties(self, session_client, workspace, project, bug, bug_fields):
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["steps"]["id"]: ["1. open login"]}, "check_required": True},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert bug_fields["severity"]["id"] in response.data["errors"]

    def test_save_and_read_values(self, session_client, workspace, project, bug, bug_fields):
        major = bug_fields["severity"]["options"][1]["id"]
        values = {
            bug_fields["severity"]["id"]: [major],
            bug_fields["steps"]["id"]: ["1. open login\n2. submit"],
            bug_fields["page"]["id"]: ["https://infra.jinom.net/login"],
            bug_fields["hits"]["id"]: ["12.50"],
        }
        response = session_client.put(
            self.values_url(workspace, project, bug), {"values": values, "check_required": True}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        read = session_client.get(self.values_url(workspace, project, bug)).data
        assert read[bug_fields["severity"]["id"]] == [major]
        assert read[bug_fields["hits"]["id"]] == ["12.5"]
        assert read[bug_fields["page"]["id"]] == ["https://infra.jinom.net/login"]
        activity = IssueActivity.objects.filter(issue=bug, field="custom_property")
        assert activity.filter(new_value="Major").exists()

    @pytest.mark.parametrize(
        "field,value",
        [("page", "javascript:alert(1)"), ("hits", "many"), ("severity", "00000000-0000-0000-0000-000000000000")],
    )
    def test_invalid_values_are_rejected(self, session_client, workspace, project, bug, bug_fields, field, value):
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields[field]["id"]: [value]}},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_single_value_property_rejects_lists(self, session_client, workspace, project, bug, bug_fields):
        minor, major = (o["id"] for o in bug_fields["severity"]["options"])
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["severity"]["id"]: [minor, major]}},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_required_property_cannot_be_cleared(self, session_client, workspace, project, bug, bug_fields):
        minor = bug_fields["severity"]["options"][0]["id"]
        session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["severity"]["id"]: [minor]}},
            format="json",
        )
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["severity"]["id"]: []}},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_editing_one_property_leaves_required_others_alone(
        self, session_client, workspace, project, bug, bug_fields
    ):
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["steps"]["id"]: ["only steps"]}},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK

    def test_property_of_another_type_is_rejected(self, session_client, workspace, project, bug, enabled):
        default_id = enabled["types"][0]["id"]
        other_prop = add_property(
            session_client, workspace, project, default_id, display_name="Notes", property_type="TEXT"
        ).data
        response = session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {other_prop["id"]: ["x"]}},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_deleting_type_moves_items_to_default_and_hides_values(
        self, session_client, workspace, project, bug, bug_fields, bug_type, enabled
    ):
        session_client.put(
            self.values_url(workspace, project, bug),
            {"values": {bug_fields["steps"]["id"]: ["x"]}},
            format="json",
        )
        response = session_client.delete(url(workspace, project, f"work-item-types/{bug_type['id']}/"))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        bug.refresh_from_db()
        assert str(bug.type_id) == enabled["types"][0]["id"]
        # the default type uses none of Bug's properties, which stay in the project's pool
        assert session_client.get(self.values_url(workspace, project, bug)).data == {}
        assert IssueProperty.objects.filter(id=bug_fields["steps"]["id"]).exists()

    def test_list_payload_carries_type_id(self, session_client, workspace, project, bug, bug_type):
        response = session_client.get(url(workspace, project, "issues/"))

        assert response.status_code == status.HTTP_200_OK
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        assert any(str(r.get("type_id")) == bug_type["id"] for r in rows)


@pytest.fixture
def other_project(db, workspace, create_user):
    project = Project.objects.create(name="Car", identifier="CAR", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    return project


@pytest.mark.contract
class TestSharedTypes:
    def test_import_shares_type_and_properties(self, session_client, workspace, project, other_project, bug_type):
        add_property(session_client, workspace, project, bug_type["id"], display_name="Build", property_type="TEXT")

        listed = session_client.get(f"/api/workspaces/{workspace.slug}/work-item-types/").data
        response = session_client.post(
            url(workspace, other_project, "work-item-types/import/"), {"type_ids": [bug_type["id"]]}, format="json"
        )

        assert [t["name"] for t in listed] == ["Bug"]
        assert response.status_code == status.HTTP_200_OK
        assert response.data["imported"] == ["Bug"]
        shared = next(t for t in response.data["types"] if t["name"] == "Bug")
        assert shared["id"] == bug_type["id"]
        assert [p["display_name"] for p in shared["properties"]] == ["Build"]
        assert sorted(shared["project_ids"]) == sorted([str(project.id), str(other_project.id)])

    def test_removing_shared_type_only_unlinks_it(self, session_client, workspace, project, other_project, bug_type):
        session_client.post(
            url(workspace, other_project, "work-item-types/import/"), {"type_ids": [bug_type["id"]]}, format="json"
        )
        response = session_client.delete(url(workspace, other_project, f"work-item-types/{bug_type['id']}/"))

        assert response.status_code == status.HTTP_204_NO_CONTENT
        names = [t["name"] for t in session_client.get(url(workspace, project, "work-item-types/")).data["types"]]
        assert "Bug" in names

    def test_values_on_shared_type_validate_members_of_the_items_project(
        self, session_client, workspace, project, other_project, bug_type, create_user
    ):
        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Reporter", property_type="MEMBER"
        ).data
        session_client.post(
            url(workspace, other_project, "work-item-types/import/"), {"type_ids": [bug_type["id"]]}, format="json"
        )
        car_bug = Issue.objects.create(
            name="x", workspace=workspace, project=other_project, type_id=bug_type["id"], created_by=create_user
        )

        response = session_client.put(
            url(workspace, other_project, f"issues/{car_bug.id}/property-values/"),
            {"values": {prop["id"]: [str(create_user.id)]}},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK


@pytest.mark.contract
class TestBulkAndFilters:
    @pytest.fixture
    def setup(self, session_client, workspace, project, bug_type, create_user):
        base = (session_client, workspace, project, bug_type["id"])
        reporter = add_property(*base, display_name="Reporter", property_type="MEMBER").data
        found = add_property(*base, display_name="Found on", property_type="DATE").data
        regression = add_property(*base, display_name="Regression", property_type="BOOLEAN").data
        issues = [
            Issue.objects.create(name=f"bug {i}", workspace=workspace, project=project, created_by=create_user)
            for i in range(3)
        ]
        return {"reporter": reporter, "found": found, "regression": regression, "issues": issues}

    def test_bulk_assign_moves_items_and_records_activity(self, session_client, workspace, project, bug_type, setup):
        ids = [str(i.id) for i in setup["issues"]]
        response = session_client.post(
            url(workspace, project, "work-item-types/bulk-assign/"),
            {"type_id": bug_type["id"], "issue_ids": ids},
            format="json",
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["updated"] == 3
        assert Issue.objects.filter(id__in=ids, type_id=bug_type["id"]).count() == 3
        assert IssueActivity.objects.filter(issue_id__in=ids, field="type", new_value="Bug").count() == 3

    def test_bulk_assign_rejects_foreign_type(self, session_client, workspace, project, other_project, setup):
        session_client.post(url(workspace, other_project, "work-item-types/enable/"))
        foreign = session_client.get(url(workspace, other_project, "work-item-types/")).data["types"][0]["id"]

        response = session_client.post(
            url(workspace, project, "work-item-types/bulk-assign/"),
            {"type_id": foreign, "issue_ids": [str(setup["issues"][0].id)]},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def _filter(self, client, workspace, project, expression):
        import json as _json

        response = client.get(url(workspace, project, "issues/"), {"filters": _json.dumps(expression)})
        assert response.status_code == status.HTTP_200_OK, response.data
        rows = response.data["results"] if isinstance(response.data, dict) else response.data
        return {r["name"] for r in rows}

    def test_filters_on_member_date_and_boolean_properties(
        self, session_client, workspace, project, bug_type, setup, create_user
    ):
        a, b, c = setup["issues"]
        Issue.objects.filter(id__in=[a.id, b.id, c.id]).update(type_id=bug_type["id"])
        for issue, values in [
            (a, {setup["reporter"]["id"]: [str(create_user.id)], setup["found"]["id"]: ["2026-10-01"]}),
            (b, {setup["found"]["id"]: ["2026-10-20"], setup["regression"]["id"]: ["true"]}),
        ]:
            session_client.put(
                url(workspace, project, f"issues/{issue.id}/property-values/"), {"values": values}, format="json"
            )
        key = lambda name, op: f"customproperty_{setup[name]['id']}__{op}"  # noqa: E731

        assert self._filter(session_client, workspace, project, {key("reporter", "in"): str(create_user.id)}) == {
            "bug 0"
        }
        assert self._filter(session_client, workspace, project, {key("found", "range"): "2026-10-15,2026-10-31"}) == {
            "bug 1"
        }
        assert self._filter(session_client, workspace, project, {key("regression", "in"): "true"}) == {"bug 1"}
        assert self._filter(session_client, workspace, project, {key("regression", "in"): "false"}) == {
            "bug 0",
            "bug 2",
        }
        assert self._filter(
            session_client,
            workspace,
            project,
            {"and": [{key("found", "range"): "2026-10-01,2026-10-31"}, {"state_group__in": "unstarted,backlog"}]},
        ) == {"bug 0", "bug 1"}

    def test_unsupported_custom_filter_is_rejected(self, session_client, workspace, project, setup):
        response = session_client.get(
            url(workspace, project, "issues/"),
            {"filters": '{"customproperty_%s__range": "a,b"}' % setup["reporter"]["id"]},
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_project_values_endpoint(self, session_client, workspace, project, bug_type, setup, create_user):
        a = setup["issues"][0]
        Issue.objects.filter(id=a.id).update(type_id=bug_type["id"])
        session_client.put(
            url(workspace, project, f"issues/{a.id}/property-values/"),
            {"values": {setup["found"]["id"]: ["2026-10-01"]}},
            format="json",
        )

        response = session_client.get(url(workspace, project, "property-values/"))

        assert response.data == {str(a.id): {setup["found"]["id"]: ["2026-10-01"]}}

    def test_property_change_notifies_subscribers(
        self, session_client, workspace, project, bug_type, setup, monkeypatch, django_capture_on_commit_callbacks
    ):
        from plane.bgtasks import notification_task

        calls = []
        monkeypatch.setattr(notification_task.notifications, "delay", lambda **kw: calls.append(kw))
        a = setup["issues"][0]
        Issue.objects.filter(id=a.id).update(type_id=bug_type["id"])

        with django_capture_on_commit_callbacks(execute=True):
            session_client.put(
                url(workspace, project, f"issues/{a.id}/property-values/"),
                {"values": {setup["found"]["id"]: ["2026-10-01"]}},
                format="json",
            )

        assert len(calls) == 1
        assert calls[0]["issue_id"] == str(a.id)
        assert '"custom_property"' in calls[0]["issue_activities_created"]


@pytest.mark.contract
class TestMoreKinds:
    @pytest.fixture
    def bug(self, workspace, project, bug_type, create_user):
        return Issue.objects.create(
            name="Crash", workspace=workspace, project=project, type_id=bug_type["id"], created_by=create_user
        )

    def put_values(self, client, workspace, project, issue, values):
        return client.put(
            url(workspace, project, f"issues/{issue.id}/property-values/"), {"values": values}, format="json"
        )

    def test_formula_is_computed_and_read_only(self, session_client, workspace, project, bug_type, bug):
        base = (session_client, workspace, project, bug_type["id"])
        impact = add_property(*base, display_name="Impact", property_type="NUMBER").data
        likelihood = add_property(*base, display_name="Likelihood", property_type="NUMBER").data
        bad = add_property(*base, display_name="Bad", property_type="FORMULA", settings={"formula": "{Nope} * 2"})
        risk = add_property(
            *base, display_name="Risk", property_type="FORMULA", settings={"formula": "{Impact} * {Likelihood} + 1"}
        ).data

        response = self.put_values(
            session_client, workspace, project, bug, {impact["id"]: ["3"], likelihood["id"]: ["4"]}
        )
        written = self.put_values(session_client, workspace, project, bug, {risk["id"]: ["99"]})

        assert bad.status_code == status.HTTP_400_BAD_REQUEST
        assert response.data[risk["id"]] == ["13"]
        assert written.status_code == status.HTTP_400_BAD_REQUEST

    def test_formula_rejects_code(self, session_client, workspace, project, bug_type):
        add_property(session_client, workspace, project, bug_type["id"], display_name="Impact", property_type="NUMBER")
        response = add_property(
            session_client,
            workspace,
            project,
            bug_type["id"],
            display_name="Evil",
            property_type="FORMULA",
            settings={"formula": "__import__('os').system('id') + {Impact}"},
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_cascading_needs_a_leaf_and_filters_by_parent(self, session_client, workspace, project, bug_type, bug):
        prop = add_property(
            session_client,
            workspace,
            project,
            bug_type["id"],
            display_name="Area",
            property_type="CASCADING",
            options=[{"name": "Network", "children": [{"name": "OLT"}, {"name": "ONT"}]}, {"name": "Billing"}],
        ).data
        network = next(o for o in prop["options"] if o["name"] == "Network")
        olt = next(o for o in prop["options"] if o["name"] == "OLT")
        billing = next(o for o in prop["options"] if o["name"] == "Billing")

        parent_only = self.put_values(session_client, workspace, project, bug, {prop["id"]: [network["id"]]})
        leaf = self.put_values(session_client, workspace, project, bug, {prop["id"]: [olt["id"]]})
        childless = self.put_values(session_client, workspace, project, bug, {prop["id"]: [billing["id"]]})

        assert olt["parent_id"] == network["id"]
        assert parent_only.status_code == status.HTTP_400_BAD_REQUEST
        assert leaf.status_code == status.HTTP_200_OK
        assert childless.status_code == status.HTTP_200_OK
        self.put_values(session_client, workspace, project, bug, {prop["id"]: [olt["id"]]})
        rows = session_client.get(
            url(workspace, project, "issues/"),
            {"filters": '{"customproperty_%s__in": "%s"}' % (prop["id"], network["id"])},
        ).data
        rows = rows["results"] if isinstance(rows, dict) else rows
        assert [r["name"] for r in rows] == ["Crash"]

    def test_email_relation_and_rich_text(self, session_client, workspace, project, bug_type, bug, create_user):
        base = (session_client, workspace, project, bug_type["id"])
        email = add_property(*base, display_name="Reporter email", property_type="EMAIL").data
        related = add_property(*base, display_name="Duplicate of", property_type="RELATION", is_multi=True).data
        notes = add_property(*base, display_name="Notes", property_type="RICH_TEXT").data
        other = Issue.objects.create(name="Other", workspace=workspace, project=project, created_by=create_user)

        assert self.put_values(session_client, workspace, project, bug, {email["id"]: ["nope"]}).status_code == 400
        assert (
            self.put_values(session_client, workspace, project, bug, {related["id"]: [str(bug.id)]}).status_code == 400
        )
        response = self.put_values(
            session_client,
            workspace,
            project,
            bug,
            {
                email["id"]: ["CS@Jinom.net"],
                related["id"]: [str(other.id)],
                notes["id"]: ["<p>Seen on <strong>OLT-3</strong></p><script>alert(1)</script>"],
            },
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data[email["id"]] == ["cs@jinom.net"]
        assert response.data[related["id"]] == [str(other.id)]
        assert "<script" not in response.data[notes["id"]][0]
        assert IssueActivity.objects.filter(
            issue=bug, comment="Duplicate of", new_value="BUG-%s" % other.sequence_id
        ).exists()

    def test_file_must_be_an_attachment_of_the_item(self, session_client, workspace, project, bug_type, bug):
        from plane.db.models import FileAsset

        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Screenshot", property_type="FILE"
        ).data
        asset = FileAsset.objects.create(
            workspace=workspace,
            project=project,
            issue=bug,
            entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            asset="x/shot.png",
            attributes={"name": "shot.png"},
            is_uploaded=True,
        )
        stranger = FileAsset.objects.create(
            workspace=workspace, project=project, entity_type="USER_AVATAR", asset="x/a.png", is_uploaded=True
        )

        assert (
            self.put_values(session_client, workspace, project, bug, {prop["id"]: [str(stranger.id)]}).status_code
            == 400
        )
        response = self.put_values(session_client, workspace, project, bug, {prop["id"]: [str(asset.id)]})

        assert response.status_code == status.HTTP_200_OK
        assert response.data[prop["id"]] == [str(asset.id)]
        asset.delete()
        values = session_client.get(url(workspace, project, f"issues/{bug.id}/property-values/")).data
        assert values[prop["id"]] == []

    def test_text_and_number_filters(self, session_client, workspace, project, bug_type, create_user):
        base = (session_client, workspace, project, bug_type["id"])
        build = add_property(*base, display_name="Build", property_type="TEXT").data
        users = add_property(*base, display_name="Users", property_type="NUMBER").data
        for name, text, number in [("a", "v2.1-beta", "5"), ("b", "v3.0", "50")]:
            issue = Issue.objects.create(
                name=name, workspace=workspace, project=project, type_id=bug_type["id"], created_by=create_user
            )
            self.put_values(session_client, workspace, project, issue, {build["id"]: [text], users["id"]: [number]})

        def names(expression):
            import json as _json

            rows = session_client.get(url(workspace, project, "issues/"), {"filters": _json.dumps(expression)}).data
            rows = rows["results"] if isinstance(rows, dict) else rows
            return {r["name"] for r in rows}

        assert names({f"customproperty_{build['id']}__icontains": "BETA"}) == {"a"}
        assert names({f"customproperty_{users['id']}__gte": "10"}) == {"b"}
        assert names({f"customproperty_{users['id']}__lte": "10"}) == {"a"}
        assert names({f"customproperty_{users['id']}__range": "1,100"}) == {"a", "b"}


@pytest.mark.contract
class TestGroupAndSort:
    @pytest.fixture
    def data(self, session_client, workspace, project, bug_type, create_user):
        base = (session_client, workspace, project, bug_type["id"])
        severity = add_property(
            *base, display_name="Severity", property_type="OPTION", options=[{"name": "High"}, {"name": "Low"}]
        ).data
        users = add_property(*base, display_name="Users", property_type="NUMBER").data
        high, low = (o["id"] for o in severity["options"])
        issues = {}
        for name, option, number in [("a", high, "5"), ("b", low, "50"), ("c", None, None)]:
            issue = Issue.objects.create(
                name=name, workspace=workspace, project=project, type_id=bug_type["id"], created_by=create_user
            )
            values = {}
            if option:
                values[severity["id"]] = [option]
            if number:
                values[users["id"]] = [number]
            session_client.put(
                url(workspace, project, f"issues/{issue.id}/property-values/"), {"values": values}, format="json"
            )
            issues[name] = issue
        return {"severity": severity, "users": users, "high": high, "low": low, "issues": issues}

    def test_group_by_option_property(self, session_client, workspace, project, data):
        response = session_client.get(
            url(workspace, project, "issues/"), {"group_by": f"customproperty_{data['severity']['id']}"}
        )

        assert response.status_code == status.HTTP_200_OK
        groups = response.data["results"]
        assert set(groups) == {data["high"], data["low"], "None"}
        assert [i["name"] for i in groups[data["high"]]["results"]] == ["a"]
        assert [i["name"] for i in groups["None"]["results"]] == ["c"]
        assert groups[data["low"]]["results"][0]["custom_property_group"] == data["low"]

    def test_unknown_custom_group_falls_back_to_ungrouped(self, session_client, workspace, project, data):
        response = session_client.get(
            url(workspace, project, "issues/"), {"group_by": f"customproperty_{data['users']['id']}"}
        )

        assert response.status_code == status.HTTP_200_OK
        assert isinstance(response.data["results"], list)

    def test_order_by_number_property(self, session_client, workspace, project, data):
        def names(order):
            rows = session_client.get(url(workspace, project, "issues/"), {"order_by": order}).data["results"]
            return [r["name"] for r in rows]

        prop = f"customproperty_{data['users']['id']}"
        assert names(prop) == ["a", "b", "c"]
        assert names(f"-{prop}") == ["b", "a", "c"]


@pytest.mark.contract
class TestPropertyPool:
    """Properties live in a project pool and can be shared by several types."""

    @pytest.fixture
    def feature_type(self, session_client, workspace, project, enabled):
        response = session_client.post(url(workspace, project, "work-item-types/"), {"name": "Feature"}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        return response.data

    def test_create_in_pool_then_add_to_types(self, session_client, workspace, project, bug_type, feature_type):
        created = session_client.post(
            url(workspace, project, "work-item-properties/"),
            {"display_name": "Reporter", "property_type": "TEXT"},
            format="json",
        )
        prop_id = created.data["id"]
        for type_id in (bug_type["id"], feature_type["id"]):
            linked = session_client.post(
                url(workspace, project, f"work-item-types/{type_id}/properties/link/"),
                {"property_ids": [prop_id]},
                format="json",
            )
            assert linked.status_code == status.HTTP_200_OK
        pool = session_client.get(url(workspace, project, "work-item-properties/")).data

        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["issue_type_ids"] == []
        assert sorted(pool[0]["issue_type_ids"]) == sorted([bug_type["id"], feature_type["id"]])

    def test_names_are_unique_in_the_pool(self, session_client, workspace, project, bug_type, feature_type):
        add_property(session_client, workspace, project, bug_type["id"], display_name="Region", property_type="TEXT")

        again = add_property(
            session_client, workspace, project, feature_type["id"], display_name="region", property_type="TEXT"
        )

        assert again.status_code == status.HTTP_400_BAD_REQUEST

    def test_removing_from_a_type_keeps_the_values(self, session_client, workspace, project, bug_type):
        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Steps", property_type="TEXT"
        ).data
        issue = session_client.post(
            url(workspace, project, "issues/"), {"name": "x", "type_id": bug_type["id"]}, format="json"
        ).data
        values_url = url(workspace, project, f"issues/{issue['id']}/property-values/")
        session_client.put(values_url, {"values": {prop["id"]: ["click login"]}}, format="json")
        type_prop_url = url(workspace, project, f"work-item-types/{bug_type['id']}/properties/{prop['id']}/")

        removed = session_client.delete(type_prop_url)
        hidden = session_client.get(values_url).data
        session_client.post(
            url(workspace, project, f"work-item-types/{bug_type['id']}/properties/link/"),
            {"property_ids": [prop["id"]]},
            format="json",
        )

        assert removed.status_code == status.HTTP_204_NO_CONTENT
        assert prop["id"] not in hidden
        assert session_client.get(values_url).data[prop["id"]] == ["click login"]

    def test_deleting_from_the_pool_removes_it_everywhere(self, session_client, workspace, project, bug_type):
        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Steps", property_type="TEXT"
        ).data

        response = session_client.delete(url(workspace, project, f"work-item-properties/{prop['id']}/"))
        types = session_client.get(url(workspace, project, "work-item-types/")).data["types"]

        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert all(p["id"] != prop["id"] for t in types for p in t["properties"])

    def test_order_is_per_type(self, session_client, workspace, project, bug_type, feature_type):
        a = add_property(session_client, workspace, project, bug_type["id"], display_name="A", property_type="TEXT")
        b = add_property(session_client, workspace, project, bug_type["id"], display_name="B", property_type="TEXT")
        session_client.post(
            url(workspace, project, f"work-item-types/{feature_type['id']}/properties/link/"),
            {"property_ids": [a.data["id"], b.data["id"]]},
            format="json",
        )
        session_client.patch(
            url(workspace, project, f"work-item-types/{bug_type['id']}/properties/{b.data['id']}/"),
            {"sort_order": 1},
            format="json",
        )
        types = {t["name"]: t for t in session_client.get(url(workspace, project, "work-item-types/")).data["types"]}

        assert [p["display_name"] for p in types["Bug"]["properties"]] == ["B", "A"]
        assert [p["display_name"] for p in types["Feature"]["properties"]] == ["A", "B"]


@pytest.mark.contract
class TestValueBatches:
    """Lists load property values for the work items on screen only."""

    def test_only_requested_items_are_returned(self, session_client, workspace, project, bug_type):
        prop = add_property(
            session_client, workspace, project, bug_type["id"], display_name="Module", property_type="TEXT"
        ).data
        ids = []
        for name in ("a", "b"):
            issue = session_client.post(
                url(workspace, project, "issues/"), {"name": name, "type_id": bug_type["id"]}, format="json"
            ).data
            session_client.put(
                url(workspace, project, f"issues/{issue['id']}/property-values/"),
                {"values": {prop["id"]: [name.upper()]}},
                format="json",
            )
            ids.append(str(issue["id"]))

        response = session_client.get(url(workspace, project, "property-values/"), {"issue_ids": ids[0]})

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {ids[0]: {prop["id"]: ["A"]}}

    def test_bad_or_too_many_ids_are_refused(self, session_client, workspace, project, enabled):
        values_url = url(workspace, project, "property-values/")

        bad = session_client.get(values_url, {"issue_ids": "not-a-uuid"})
        too_many = session_client.get(values_url, {"issue_ids": ",".join(str(uuid4()) for _ in range(201))})

        assert bad.status_code == status.HTTP_400_BAD_REQUEST
        assert too_many.status_code == status.HTTP_400_BAD_REQUEST
