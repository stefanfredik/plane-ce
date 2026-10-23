# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public intake forms file work items into the project's Intake."""

from uuid import uuid4

import pytest
from django.core.cache import cache
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import IntakeIssue, Issue, Project, ProjectMember, State, User, WorkspaceMember


@pytest.fixture(autouse=True)
def reset_throttle():
    cache.clear()
    yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    return project


def base(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}"


@pytest.fixture
def bug(session_client, workspace, project):
    b = base(workspace, project)
    session_client.post(f"{b}/work-item-types/enable/", {}, format="json")
    bug = session_client.post(f"{b}/work-item-types/", {"name": "Bug"}, format="json").data
    severity = session_client.post(
        f"{b}/work-item-types/{bug['id']}/properties/",
        {
            "display_name": "Severity",
            "property_type": "OPTION",
            "is_required": True,
            "options": [{"name": "Minor"}, {"name": "Major"}],
        },
        format="json",
    ).data
    reporter = session_client.post(
        f"{b}/work-item-types/{bug['id']}/properties/",
        {"display_name": "Owner", "property_type": "MEMBER"},
        format="json",
    ).data
    return bug, severity, reporter


@pytest.fixture
def form(session_client, workspace, project, bug):
    issue_type, severity, _owner = bug
    response = session_client.patch(
        f"{base(workspace, project)}/intake-form/",
        {
            "is_enabled": True,
            "title": "Report a bug",
            "issue_type_id": issue_type["id"],
            "property_ids": [severity["id"]],
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK
    return response.data


def public_url(form):
    return f"/api/public/intake-forms/{form['anchor']}/"


@pytest.mark.contract
class TestIntakeFormSettings:
    def test_enabling_turns_intake_on(self, form, project):
        project.refresh_from_db()

        assert form["is_enabled"] is True
        assert project.intake_view is True

    def test_people_fields_cannot_be_on_the_form(self, session_client, workspace, project, bug):
        _type, _severity, owner = bug
        response = session_client.patch(
            f"{base(workspace, project)}/intake-form/", {"property_ids": [owner["id"]]}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_only_project_admins(self, api_client, workspace, project):
        user = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
        api_client.force_authenticate(user=user)

        assert api_client.get(f"{base(workspace, project)}/intake-form/").status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestPublicIntakeForm:
    def test_form_shows_chosen_fields(self, form, bug):
        data = APIClient().get(public_url(form)).data

        assert data["title"] == "Report a bug"
        assert [f["name"] for f in data["fields"]] == ["Severity"]
        assert [o["name"] for o in data["fields"][0]["options"]] == ["Minor", "Major"]

    def test_submission_lands_in_intake(self, form, bug, project):
        bug_type, severity, _owner = bug
        major = severity["options"][1]["id"]

        response = APIClient().post(
            public_url(form),
            {
                "name": "Rina",
                "email": "Rina@Mitra.id",
                "title": "ONT offline",
                "description": "Since <b>morning</b>",
                "values": {severity["id"]: [major]},
            },
            format="json",
        )
        issue = Issue.all_objects.get(project=project, name="ONT offline")
        intake = IntakeIssue.objects.get(issue=issue)

        assert response.status_code == status.HTTP_201_CREATED
        assert response.data["reference"] == f"BUG-{issue.sequence_id}"
        assert issue.state.group == "triage"
        assert str(issue.type_id) == bug_type["id"]
        assert "&lt;b&gt;morning&lt;/b&gt;" in issue.description_html
        assert intake.source == "FORM" and intake.source_email == "rina@mitra.id"
        assert str(issue.property_values.get().value_option_id) == major

    def test_validation(self, form, bug):
        _type, severity, _owner = bug

        response = APIClient().post(public_url(form), {"name": "", "title": ""}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert {"name", "email", "title", severity["id"]} <= set(response.data["errors"])

    def test_honeypot_is_ignored(self, form, bug, project):
        response = APIClient().post(
            public_url(form), {"name": "bot", "email": "b@b.co", "title": "spam", "website": "x"}, format="json"
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert not Issue.all_objects.filter(project=project, name="spam").exists()

    def test_disabled_form_is_gone(self, session_client, workspace, project, form):
        session_client.patch(f"{base(workspace, project)}/intake-form/", {"is_enabled": False}, format="json")

        assert APIClient().get(public_url(form)).status_code == status.HTTP_404_NOT_FOUND
