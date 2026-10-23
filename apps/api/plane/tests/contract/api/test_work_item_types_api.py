# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work item types and custom properties (public v1 API, SDK-compatible paths)."""

from uuid import uuid4

import pytest
from django.core.cache import cache
from rest_framework import status

from plane.db.models import Issue, IssueActivity, Project, ProjectMember, State, User, WorkspaceMember


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


def base(workspace, project):
    return f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}"


@pytest.fixture
def bug_type(api_key_client, workspace, project):
    response = api_key_client.post(f"{base(workspace, project)}/work-item-types/", {"name": "Bug"}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return response.data


@pytest.fixture
def props(api_key_client, workspace, project, bug_type):
    url = f"{base(workspace, project)}/work-item-types/{bug_type['id']}/work-item-properties/"
    severity = api_key_client.post(
        url,
        {
            "display_name": "Severity",
            "property_type": "OPTION",
            "is_required": True,
            "options": [{"name": "Critical"}, {"name": "Minor"}],
        },
        format="json",
    ).data
    steps = api_key_client.post(
        url,
        {"display_name": "Steps", "property_type": "TEXT", "settings": {"display_format": "multi-line"}},
        format="json",
    ).data
    users = api_key_client.post(url, {"display_name": "Affected users", "property_type": "DECIMAL"}, format="json").data
    return {"severity": severity, "steps": steps, "users": users}


@pytest.fixture
def bug(workspace, project, bug_type, create_user):
    return Issue.objects.create(
        name="Login fails", workspace=workspace, project=project, type_id=bug_type["id"], created_by=create_user
    )


@pytest.mark.contract
class TestPublicTypes:
    def test_creating_a_type_turns_types_on_with_a_default(self, api_key_client, workspace, project, bug_type):
        response = api_key_client.get(f"{base(workspace, project)}/work-item-types/")

        assert response.status_code == status.HTTP_200_OK
        assert [t["name"] for t in response.data] == ["Task", "Bug"]
        assert response.data[0]["is_default"] is True
        assert response.data[1]["project_ids"] == [str(project.id)]

    def test_public_property_types_map_to_ours_and_back(self, props):
        assert props["steps"]["property_type"] == "TEXT"
        assert props["steps"]["settings"]["display_format"] == "multi-line"
        assert props["users"]["property_type"] == "DECIMAL"
        assert [o["name"] for o in props["severity"]["options"]] == ["Critical", "Minor"]

    def test_unsupported_property_type_is_rejected(self, api_key_client, workspace, project, bug_type):
        response = api_key_client.post(
            f"{base(workspace, project)}/work-item-types/{bug_type['id']}/work-item-properties/",
            # Releases do not exist in the community edition
            {"display_name": "Shipped in", "property_type": "RELATION", "relation_type": "RELEASE"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_members_cannot_change_types(self, api_client, workspace, project, bug_type):
        member = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=member, role=15)
        ProjectMember.objects.create(project=project, member=member, role=15, is_active=True)
        api_client.force_authenticate(user=member)

        response = api_client.post(f"{base(workspace, project)}/work-item-types/", {"name": "Story"}, format="json")

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert api_client.get(f"{base(workspace, project)}/work-item-types/").status_code == status.HTTP_200_OK

    def test_issue_create_rejects_type_of_another_project(
        self, api_key_client, workspace, project, bug_type, create_user
    ):
        other = Project.objects.create(name="Other", identifier="OTH", workspace=workspace, created_by=create_user)
        ProjectMember.objects.create(project=other, member=create_user, role=20, is_active=True)

        response = api_key_client.post(
            f"{base(workspace, other)}/work-items/", {"name": "x", "type_id": bug_type["id"]}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestPublicValues:
    def test_sdk_value_path_round_trip(self, api_key_client, workspace, project, bug, props):
        url = f"{base(workspace, project)}/work-items/{bug.id}/work-item-properties/{props['users']['id']}/values/"
        assert api_key_client.get(url).status_code == status.HTTP_404_NOT_FOUND

        created = api_key_client.post(url, {"value": 12.5}, format="json")

        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["value"] == 12.5
        assert api_key_client.get(url).data["value"] == 12.5

    def test_friendly_endpoint_accepts_names(self, api_key_client, workspace, project, bug, props):
        url = f"{base(workspace, project)}/work-items/{bug.id}/property-values/"

        response = api_key_client.put(
            url, {"values": {"severity": "critical", "Steps": "1. open\n2. submit"}}, format="json"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.data["properties"]["Severity"]["value"] == "Critical"
        assert response.data["properties"]["Steps"]["value"] == "1. open\n2. submit"
        assert IssueActivity.objects.filter(issue=bug, field="custom_property", new_value="Critical").exists()

    def test_friendly_endpoint_reports_unknown_names(self, api_key_client, workspace, project, bug, props):
        url = f"{base(workspace, project)}/work-items/{bug.id}/property-values/"

        response = api_key_client.put(url, {"values": {"Severity": "Blocker", "Nope": "x"}}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Nope" in response.data["errors"]
        assert props["severity"]["id"] in response.data["errors"]
