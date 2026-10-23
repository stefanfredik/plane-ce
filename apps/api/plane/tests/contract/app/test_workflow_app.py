# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workflows decide which state a work item may move to, who moves it, and what it needs first."""

from uuid import uuid4

import pytest
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, ProjectWorkflow, State, User, WorkspaceMember


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project, workspace):
    def make(name, group, **kw):
        return State.objects.create(name=name, project=project, workspace=workspace, group=group, **kw)

    return {
        "todo": make("Todo", "unstarted", default=True),
        "doing": make("In Progress", "started"),
        "done": make("Done", "completed"),
    }


@pytest.fixture
def issue(project, workspace, states):
    return Issue.objects.create(name="broken", workspace=workspace, project=project, state=states["todo"])


def base(workspace, project):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}"


def set_workflow(client, workspace, project, rules, enabled=True):
    response = client.patch(
        f"{base(workspace, project)}/workflow/", {"is_enabled": enabled, "rules": rules}, format="json"
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    return response.data


def move(client, workspace, project, issue, state, **extra):
    return client.patch(
        f"{base(workspace, project)}/issues/{issue.id}/", {"state_id": str(state.id), **extra}, format="json"
    )


@pytest.mark.contract
class TestWorkflowRules:
    def test_disabled_workflow_allows_any_move(self, session_client, workspace, project, states, issue):
        only_doing = {str(states["todo"].id): {"transitions": {str(states["doing"].id): {}}}}
        set_workflow(session_client, workspace, project, only_doing, enabled=False)

        response = move(session_client, workspace, project, issue, states["done"])

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_only_listed_next_states(self, session_client, workspace, project, states, issue):
        set_workflow(
            session_client, workspace, project, {str(states["todo"].id): {"transitions": {str(states["doing"].id): {}}}}
        )

        skipped = move(session_client, workspace, project, issue, states["done"])
        stepped = move(session_client, workspace, project, issue, states["doing"])

        assert skipped.status_code == status.HTTP_400_BAD_REQUEST
        assert skipped.data["state_id"][0] == "Work items in Todo cannot move to Done."
        assert stepped.status_code == status.HTTP_204_NO_CONTENT
        issue.refresh_from_db()
        assert issue.state_id == states["doing"].id

    def test_states_without_rules_are_free(self, session_client, workspace, project, states, issue):
        set_workflow(
            session_client, workspace, project, {str(states["doing"].id): {"transitions": {str(states["done"].id): {}}}}
        )

        response = move(session_client, workspace, project, issue, states["done"])

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_other_edits_still_work(self, session_client, workspace, project, states, issue):
        set_workflow(
            session_client, workspace, project, {str(states["todo"].id): {"transitions": {str(states["doing"].id): {}}}}
        )

        response = session_client.patch(
            f"{base(workspace, project)}/issues/{issue.id}/", {"name": "renamed"}, format="json"
        )

        assert response.status_code == status.HTTP_204_NO_CONTENT

    def test_only_reviewers_move(self, api_client, workspace, project, states, issue, create_user):
        other = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=other, role=15)
        ProjectMember.objects.create(project=project, member=other, role=15, is_active=True)
        api_client.force_authenticate(user=create_user)
        reviewed = {str(states["doing"].id): {"movers": [str(create_user.id)]}, str(states["done"].id): {}}
        set_workflow(api_client, workspace, project, {str(states["todo"].id): {"transitions": reviewed}})

        api_client.force_authenticate(user=other)
        blocked = move(api_client, workspace, project, issue, states["doing"])
        viewer = api_client.get(f"{base(workspace, project)}/workflow/").data["viewer"]
        api_client.force_authenticate(user=create_user)
        allowed = move(api_client, workspace, project, issue, states["doing"])

        assert blocked.status_code == status.HTTP_400_BAD_REQUEST
        assert blocked.data["state_id"][0] == "Only the listed reviewers can move work items from Todo to In Progress."
        assert viewer["moves"][str(states["todo"].id)] == [str(states["done"].id)]
        assert allowed.status_code == status.HTTP_204_NO_CONTENT

    def test_required_fields_before_entering(self, session_client, workspace, project, states, issue, create_user):
        b = base(workspace, project)
        types = session_client.post(f"{b}/work-item-types/enable/", {}, format="json").data["types"]
        root_cause = session_client.post(
            f"{b}/work-item-types/{types[0]['id']}/properties/",
            {"display_name": "Root Cause", "property_type": "TEXT"},
            format="json",
        ).data
        issue.refresh_from_db()
        set_workflow(
            session_client, workspace, project, {str(states["done"].id): {"require": ["assignees", root_cause["id"]]}}
        )

        empty = move(session_client, workspace, project, issue, states["done"])
        session_client.put(
            f"{b}/issues/{issue.id}/property-values/", {"values": {root_cause["id"]: ["fiber cut"]}}, format="json"
        )
        # assignees set in the same request count
        filled = move(session_client, workspace, project, issue, states["done"], assignee_ids=[str(create_user.id)])

        assert empty.status_code == status.HTTP_400_BAD_REQUEST
        assert empty.data["state_id"][0] == "Fill in Assignees and Root Cause before moving to Done."
        assert filled.status_code == status.HTTP_204_NO_CONTENT

    def test_public_api_is_enforced(self, api_key_client, workspace, project, states, issue):
        ProjectWorkflow.objects.create(
            project=project,
            workspace=workspace,
            is_enabled=True,
            rules={str(states["todo"].id): {"transitions": {str(states["doing"].id): {"movers": []}}}},
        )

        response = api_key_client.patch(
            f"/api/v1/workspaces/{workspace.slug}/projects/{project.id}/issues/{issue.id}/",
            {"state": str(states["done"].id)},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "cannot move to Done" in str(response.data)


@pytest.mark.contract
class TestWorkflowSettings:
    def test_unknown_states_are_rejected(self, session_client, workspace, project, states):
        url = f"{base(workspace, project)}/workflow/"
        todo = str(states["todo"].id)

        unknown = session_client.patch(url, {"rules": {str(uuid4()): {}}}, format="json")
        unknown_target = session_client.patch(
            url, {"rules": {todo: {"transitions": {str(uuid4()): {}}}}}, format="json"
        )
        to_itself = session_client.patch(url, {"rules": {todo: {"transitions": {todo: {}}}}}, format="json")

        assert unknown.status_code == status.HTTP_400_BAD_REQUEST
        assert unknown_target.status_code == status.HTTP_400_BAD_REQUEST
        assert to_itself.status_code == status.HTTP_400_BAD_REQUEST

    def test_new_work_items_blocked_in_state(self, session_client, workspace, project, states):
        b = base(workspace, project)
        data = set_workflow(
            session_client,
            workspace,
            project,
            {str(states["done"].id): {"allow_creation": False}, str(states["todo"].id): {"allow_creation": False}},
        )

        blocked = session_client.post(f"{b}/issues/", {"name": "x", "state_id": str(states["done"].id)}, format="json")
        default = session_client.post(f"{b}/issues/", {"name": "y", "state_id": str(states["todo"].id)}, format="json")

        # the default state always takes new work items
        assert data["rules"][str(states["todo"].id)]["allow_creation"] is True
        assert data["viewer"]["creation_blocked"] == [str(states["done"].id)]
        assert blocked.status_code == status.HTTP_400_BAD_REQUEST
        assert blocked.data["state_id"][0] == "New work items cannot be created in Done."
        assert default.status_code == status.HTTP_201_CREATED

    def test_members_cannot_edit(self, api_client, workspace, project, states):
        user = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
        api_client.force_authenticate(user=user)

        read = api_client.get(f"{base(workspace, project)}/workflow/")
        write = api_client.patch(f"{base(workspace, project)}/workflow/", {"is_enabled": True}, format="json")

        assert read.status_code == status.HTTP_200_OK
        assert read.data["viewer"] is None
        assert write.status_code == status.HTTP_403_FORBIDDEN
