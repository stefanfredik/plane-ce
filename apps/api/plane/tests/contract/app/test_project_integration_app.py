# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitLab and Sentry webhooks connected to a project."""

import hashlib
import hmac
import json
from unittest.mock import patch

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from plane.db.models import Issue, IssueComment, IssueLink, Project, ProjectMember, State


@pytest.fixture(autouse=True)
def no_background_tasks():
    with patch("plane.bgtasks.issue_activities_task.issue_activity.delay"):
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="NOC", identifier="NOC", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project, workspace):
    def make(name, group, **kw):
        return State.objects.create(name=name, project=project, workspace=workspace, group=group, **kw)

    return {
        "todo": make("Todo", "unstarted", default=True),
        "review": make("In Review", "started"),
        "done": make("Done", "completed"),
    }


@pytest.fixture
def issue(project, workspace, states):
    return Issue.objects.create(name="Fix OLT poller", workspace=workspace, project=project, state=states["todo"])


def settings_url(workspace, project, provider):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/integrations/{provider}/"


def deliver(path, body, **headers):
    return APIClient().post(path, data=json.dumps(body), content_type="application/json", **headers)


@pytest.mark.contract
class TestGitlab:
    @pytest.fixture
    def gitlab(self, session_client, workspace, project, states):
        response = session_client.patch(
            settings_url(workspace, project, "gitlab"),
            {
                "is_enabled": True,
                "config": {"states": {"mr_opened": str(states["review"].id), "mr_merged": str(states["done"].id)}},
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        return response.data

    def mr(self, action, title="NOC-1 retry the poller", iid=7):
        return {
            "object_kind": "merge_request",
            "user": {"name": "Rina"},
            "project": {"path_with_namespace": "jinom/nms"},
            "object_attributes": {
                "iid": iid,
                "title": title,
                "description": "",
                "source_branch": "fix/poller",
                "url": f"https://gitlab.example.com/jinom/nms/-/merge_requests/{iid}",
                "action": action,
            },
        }

    def test_wrong_token_is_refused(self, gitlab, issue):
        response = deliver(gitlab["webhook_path"], self.mr("open"), HTTP_X_GITLAB_TOKEN="nope")

        assert response.status_code == status.HTTP_401_UNAUTHORIZED

    def test_merge_request_links_and_moves(self, gitlab, issue, states):
        headers = {"HTTP_X_GITLAB_TOKEN": gitlab["secret"], "HTTP_X_GITLAB_EVENT": "Merge Request Hook"}

        opened = deliver(gitlab["webhook_path"], self.mr("open"), **headers)
        issue.refresh_from_db()
        state_after_open = issue.state_id
        deliver(gitlab["webhook_path"], self.mr("merge"), **headers)
        issue.refresh_from_db()

        assert opened.data == {"event": "merge request open", "work_items": 1}
        assert state_after_open == states["review"].id
        assert issue.state_id == states["done"].id
        # one link however many events arrive
        assert IssueLink.objects.filter(issue=issue).count() == 1
        assert [c.comment_html for c in IssueComment.objects.filter(issue=issue).order_by("created_at")] == [
            '<p>Merge request <a href="https://gitlab.example.com/jinom/nms/-/merge_requests/7">!7 NOC-1 retry the '
            "poller</a> was opened by Rina.</p>",
            '<p>Merge request <a href="https://gitlab.example.com/jinom/nms/-/merge_requests/7">!7 NOC-1 retry the '
            "poller</a> was merged by Rina.</p>",
        ]

    def test_push_links_commits_that_mention_items(self, gitlab, issue):
        body = {
            "commits": [
                {"id": "a1b2c3d4e5f6", "message": "noc-1: back off on timeouts", "url": "https://gl/c/a1b2"},
                {"id": "ffff0000aaaa", "message": "NOC-12 unrelated", "url": "https://gl/c/ffff"},
                {"id": "bbbb1111cccc", "message": "XNOC-1 is another project", "url": "https://gl/c/bbbb"},
            ]
        }

        response = deliver(
            gitlab["webhook_path"], body, HTTP_X_GITLAB_TOKEN=gitlab["secret"], HTTP_X_GITLAB_EVENT="Push Hook"
        )

        assert response.data["work_items"] == 1
        assert list(IssueLink.objects.filter(issue=issue).values_list("title", flat=True)) == [
            "a1b2c3d4 noc-1: back off on timeouts"
        ]

    def test_disabled_integration_is_not_found(self, session_client, gitlab, workspace, project):
        session_client.patch(settings_url(workspace, project, "gitlab"), {"is_enabled": False}, format="json")

        response = deliver(gitlab["webhook_path"], self.mr("open"), HTTP_X_GITLAB_TOKEN=gitlab["secret"])

        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.contract
class TestSentry:
    SECRET = "sentry-client-secret"

    @pytest.fixture
    def sentry(self, session_client, workspace, project, states, create_user):
        response = session_client.patch(
            settings_url(workspace, project, "sentry"),
            {
                "is_enabled": True,
                "secret": self.SECRET,
                "config": {
                    "resolved_state_id": str(states["done"].id),
                    "reopened_state_id": str(states["todo"].id),
                    "assignee_ids": [str(create_user.id)],
                },
            },
            format="json",
        )
        assert response.status_code == status.HTTP_200_OK, response.data
        assert "secret" not in response.data and response.data["has_secret"] is True
        return response.data

    def send(self, sentry, action, secret=SECRET):
        body = {
            "action": action,
            "data": {
                "issue": {
                    "id": "4242",
                    "shortId": "NMS-3F",
                    "title": "TimeoutError: SNMP walk",
                    "culprit": "poller.walk",
                    "level": "fatal",
                    "web_url": "https://sentry.example.com/issues/4242/",
                }
            },
        }
        raw = json.dumps(body).encode()
        signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        return APIClient().post(
            sentry["webhook_path"],
            data=raw,
            content_type="application/json",
            HTTP_SENTRY_HOOK_RESOURCE="issue",
            HTTP_SENTRY_HOOK_SIGNATURE=signature,
        )

    def test_bad_signature_is_refused(self, sentry):
        assert self.send(sentry, "created", secret="wrong").status_code == status.HTTP_401_UNAUTHORIZED

    def test_new_sentry_issue_becomes_one_work_item(self, sentry, project, create_user):
        first = self.send(sentry, "created")
        again = self.send(sentry, "created")

        issue = Issue.objects.get(pk=first.data["work_item_id"])
        assert again.data["event"] == "sentry issue seen again"
        assert Issue.objects.filter(project=project).count() == 1
        assert issue.name == "[Sentry] TimeoutError: SNMP walk"
        assert issue.priority == "urgent"
        assert issue.created_by.display_name == "Sentry"
        assert list(issue.assignees.all()) == [create_user]
        assert IssueLink.objects.get(issue=issue).url == "https://sentry.example.com/issues/4242/"

    def test_resolve_and_regression_move_the_work_item(self, sentry, states):
        issue_id = self.send(sentry, "created").data["work_item_id"]

        self.send(sentry, "resolved")
        resolved_state = Issue.objects.get(pk=issue_id).state_id
        self.send(sentry, "unresolved")

        assert resolved_state == states["done"].id
        assert Issue.objects.get(pk=issue_id).state_id == states["todo"].id

    def test_legacy_plugin_payload(self, session_client, workspace, project, sentry):
        session_client.patch(settings_url(workspace, project, "sentry"), {"secret": ""}, format="json")

        response = deliver(
            sentry["webhook_path"],
            {"id": "99", "url": "https://sentry.example.com/issues/99/", "message": "KeyError", "level": "warning"},
        )

        assert response.data["event"] == "sentry issue created"
        assert Issue.objects.get(pk=response.data["work_item_id"]).priority == "medium"

    def test_unknown_provider(self, session_client, workspace, project):
        response = session_client.get(settings_url(workspace, project, "jira"))

        assert response.status_code == status.HTTP_404_NOT_FOUND
