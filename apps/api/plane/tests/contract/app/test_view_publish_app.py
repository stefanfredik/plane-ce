# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Publishing project views to the public Space app."""

from uuid import uuid4

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import IssueView, Issue, Project, ProjectMember, State, User, WorkspaceMember


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project, workspace):
    todo = State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    done = State.objects.create(name="Done", project=project, workspace=workspace, group="completed")
    return todo, done


@pytest.fixture
def issues(project, workspace, states, create_user):
    todo, done = states
    return {
        "open": Issue.objects.create(name="open", workspace=workspace, project=project, state=todo, priority="urgent"),
        "closed": Issue.objects.create(name="closed", workspace=workspace, project=project, state=done, priority="low"),
    }


@pytest.fixture
def view(project, workspace, create_user):
    return IssueView.objects.create(
        name="Urgent bugs",
        project=project,
        workspace=workspace,
        owned_by=create_user,
        access=1,
        rich_filters={"priority__in": "urgent"},
    )


def publish_url(workspace, project, view):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/views/{view.id}/publish/"


@pytest.mark.contract
class TestViewPublish:
    def test_publish_and_unpublish(self, session_client, workspace, project, view):
        created = session_client.post(
            publish_url(workspace, project, view), {"is_comments_enabled": True}, format="json"
        )
        listed = session_client.get(f"/api/workspaces/{workspace.slug}/projects/{project.id}/views/{view.id}/")
        again = session_client.post(publish_url(workspace, project, view), {}, format="json")
        removed = session_client.delete(publish_url(workspace, project, view))

        assert created.status_code == status.HTTP_201_CREATED
        assert created.data["is_comments_enabled"] is True
        assert listed.data["anchor"] == created.data["anchor"]
        assert again.data["anchor"] == created.data["anchor"]  # publishing twice keeps the link
        assert removed.status_code == status.HTTP_204_NO_CONTENT
        assert session_client.get(publish_url(workspace, project, view)).status_code == status.HTTP_404_NOT_FOUND

    def test_private_views_cannot_be_published(self, session_client, workspace, project, view):
        IssueView.objects.filter(id=view.id).update(access=0)

        response = session_client.post(publish_url(workspace, project, view), {}, format="json")

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_only_owner_or_admin_publishes(self, api_client, workspace, project, view):
        user = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
        api_client.force_authenticate(user=user)

        response = api_client.post(publish_url(workspace, project, view), {}, format="json")

        assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestPublishedViewPublicPages:
    @pytest.fixture
    def anchor(self, session_client, workspace, project, view):
        return session_client.post(publish_url(workspace, project, view), {}, format="json").data["anchor"]

    def test_public_list_shows_only_the_views_items(self, anchor, issues):
        public = APIClient()

        meta = public.get(f"/api/public/anchor/{anchor}/meta/")
        settings = public.get(f"/api/public/anchor/{anchor}/settings/")
        listed = public.get(f"/api/public/anchor/{anchor}/issues/")

        assert meta.status_code == status.HTTP_200_OK
        assert meta.data["view"]["name"] == "Urgent bugs"
        assert settings.data["entity_name"] == "view"
        assert settings.data["view_details"]["name"] == "Urgent bugs"
        assert {r["name"] for r in listed.data["results"]} == {"open"}

    def test_items_outside_the_view_cannot_be_opened(self, anchor, issues):
        public = APIClient()

        inside = public.get(f"/api/public/anchor/{anchor}/issues/{issues['open'].id}/")
        outside = public.get(f"/api/public/anchor/{anchor}/issues/{issues['closed'].id}/")

        assert inside.status_code == status.HTTP_200_OK
        assert outside.status_code == status.HTTP_404_NOT_FOUND

    def test_unpublished_or_private_view_goes_offline(self, anchor, view, issues):
        IssueView.objects.filter(id=view.id).update(access=0)

        response = APIClient().get(f"/api/public/anchor/{anchor}/issues/")
        settings = APIClient().get(f"/api/public/anchor/{anchor}/settings/")

        assert response.status_code == status.HTTP_404_NOT_FOUND
        assert settings.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestPublishedCustomProperties:
    """Only properties marked public reach the published page, and only for items the page lists."""

    @pytest.fixture
    def severity(self, session_client, workspace, project, issues):
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        types = session_client.post(f"{base}/work-item-types/enable/", {}, format="json").data["types"]
        task = types[0]["id"]
        prop = session_client.post(
            f"{base}/work-item-types/{task}/properties/",
            {"display_name": "Severity", "property_type": "OPTION", "options": [{"name": "Major"}]},
            format="json",
        ).data
        for issue in issues.values():
            session_client.put(
                f"{base}/issues/{issue.id}/property-values/",
                {"values": {prop["id"]: [prop["options"][0]["id"]]}},
                format="json",
            )
        return prop

    @pytest.fixture
    def anchor(self, session_client, workspace, project, view):
        return session_client.post(publish_url(workspace, project, view), {}, format="json").data["anchor"]

    def _make_public(self, session_client, workspace, project, prop):
        session_client.patch(
            f"/api/workspaces/{workspace.slug}/projects/{project.id}/work-item-properties/{prop['id']}/",
            {"is_public": True},
            format="json",
        )

    def test_hidden_until_marked_public(self, session_client, workspace, project, severity, anchor, issues):
        public = APIClient()
        ids = ",".join(str(i.id) for i in issues.values())

        before = public.get(f"/api/public/anchor/{anchor}/properties/").data
        self._make_public(session_client, workspace, project, severity)
        after = public.get(f"/api/public/anchor/{anchor}/properties/").data
        values = public.get(f"/api/public/anchor/{anchor}/property-values/", {"issue_ids": ids}).data

        assert before == []
        assert [p["name"] for p in after] == ["Severity"]
        # the view only lists the urgent item, so the other item's values stay hidden
        assert values == {str(issues["open"].id): {severity["id"]: ["Major"]}}

    def test_files_cannot_be_public(self, session_client, workspace, project, severity):
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"
        response = session_client.post(
            f"{base}/work-item-properties/",
            {"display_name": "Logs", "property_type": "FILE", "is_public": True},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_private_view_hides_values(self, session_client, workspace, project, view, severity, anchor, issues):
        self._make_public(session_client, workspace, project, severity)
        IssueView.objects.filter(id=view.id).update(access=0)

        response = APIClient().get(
            f"/api/public/anchor/{anchor}/property-values/", {"issue_ids": str(issues["open"].id)}
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND
