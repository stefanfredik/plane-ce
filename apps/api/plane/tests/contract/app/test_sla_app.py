# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""SLA targets per priority, the per work item clock, breaches and the summary."""

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import (
    Automation,
    Issue,
    IssueActivity,
    IssueComment,
    IssueSla,
    Project,
    ProjectMember,
    SlaPolicy,
    State,
    User,
)
from plane.utils import sla


@pytest.fixture(autouse=True)
def no_background_tasks():
    with (
        patch("plane.bgtasks.sla_task.refresh_project_slas.delay"),
        patch("plane.bgtasks.issue_activities_task.issue_activity.delay"),
    ):
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
        "doing": make("In Progress", "started"),
        "done": make("Done", "completed"),
    }


@pytest.fixture
def policy(session_client, workspace, project, states):
    response = session_client.patch(
        f"/api/workspaces/{workspace.slug}/projects/{project.id}/sla/",
        {
            "is_enabled": True,
            "targets": {"urgent": {"response": 15, "resolution": 240}, "low": {"resolution": 2880}},
        },
        format="json",
    )
    assert response.status_code == status.HTTP_200_OK, response.data
    return response.data


def make_issue(project, workspace, state, priority="urgent", age=timedelta(0), created_by=None):
    issue = Issue.objects.create(name="Fiber cut", workspace=workspace, project=project, state=state, priority=priority)
    Issue.objects.filter(pk=issue.pk).update(created_at=timezone.now() - age, created_by=created_by)
    issue.refresh_from_db()
    return issue


@pytest.mark.contract
class TestSlaPolicy:
    def test_rejects_bad_targets(self, session_client, workspace, project):
        url = f"/api/workspaces/{workspace.slug}/projects/{project.id}/sla/"

        unknown = session_client.patch(url, {"targets": {"blocker": {"response": 5}}}, format="json")
        backwards = session_client.patch(url, {"targets": {"high": {"response": 60, "resolution": 30}}}, format="json")

        assert unknown.status_code == status.HTTP_400_BAD_REQUEST
        assert backwards.data["error"] == "Response time cannot be longer than resolution time."

    def test_items_without_a_target_have_no_clock(self, policy, project, workspace, states):
        issue = make_issue(project, workspace, states["todo"], priority="medium")

        assert sla.refresh(issue) is None
        assert not IssueSla.objects.exists()


@pytest.mark.contract
class TestSlaClock:
    def test_due_times_follow_priority(self, policy, project, workspace, states):
        issue = make_issue(project, workspace, states["todo"])

        row = sla.refresh(issue)
        issue.priority = "low"
        issue.save()
        lowered = sla.refresh(issue)

        assert row.response_due_at == issue.created_at + timedelta(minutes=15)
        assert row.resolution_due_at == issue.created_at + timedelta(minutes=240)
        assert lowered.response_due_at is None
        assert lowered.resolution_due_at == issue.created_at + timedelta(minutes=2880)

    def test_moving_to_started_answers(self, policy, project, workspace, states, create_user):
        issue = make_issue(project, workspace, states["todo"])
        IssueActivity.objects.create(
            issue=issue,
            project=project,
            workspace=workspace,
            field="state",
            verb="updated",
            new_identifier=states["doing"].id,
            actor=create_user,
        )

        row = sla.refresh(issue)

        assert row.responded_at is not None
        assert sla.serialize_issue_sla(row, SlaPolicy.objects.get())["response"]["status"] == "met"

    def test_comment_by_creator_does_not_answer(self, policy, project, workspace, states, create_user):
        other = User.objects.create(email="noc@plane.so", username="noc")
        issue = make_issue(project, workspace, states["todo"], created_by=create_user)
        IssueComment.objects.create(issue=issue, project=project, workspace=workspace, actor=create_user)

        before = sla.refresh(issue).responded_at
        IssueComment.objects.create(issue=issue, project=project, workspace=workspace, actor=other)
        after = sla.refresh(issue).responded_at

        assert before is None
        assert after is not None

    def test_statuses(self, policy, project, workspace, states):
        fresh = sla.refresh(make_issue(project, workspace, states["todo"], priority="low"))
        late = sla.refresh(make_issue(project, workspace, states["todo"], priority="low", age=timedelta(hours=40)))
        overdue = sla.refresh(make_issue(project, workspace, states["todo"], age=timedelta(hours=5)))
        done = make_issue(project, workspace, states["done"], age=timedelta(minutes=10))
        met = sla.refresh(done)

        assert sla.statuses(fresh, 25)[2] == "on_track"
        assert sla.statuses(late, 25)[2] == "at_risk"
        assert sla.statuses(overdue, 25)[2] == "breached"
        assert sla.statuses(met, 25)[2] == "met"

    def test_breach_fires_automations_once(self, session_client, policy, project, workspace, states):
        issue = make_issue(project, workspace, states["todo"], age=timedelta(minutes=20))
        sla.refresh(issue)
        Automation.objects.create(
            project=project,
            workspace=workspace,
            name="Escalate",
            is_enabled=True,
            trigger={"type": "sla_breached"},
            actions=[{"type": "change_priority", "priority": "urgent"}, {"type": "add_comment", "text": "Breached"}],
        )

        first = sla.check_breaches()
        second = sla.check_breaches()

        row = IssueSla.objects.get(issue=issue)
        assert first == {issue.id} and second == set()
        assert row.response_breached_at == row.response_due_at
        assert IssueComment.objects.filter(issue=issue, comment_html="<p>Breached</p>").count() == 1


@pytest.mark.contract
class TestSlaViews:
    def test_issue_sla_and_summary(self, session_client, policy, project, workspace, states):
        overdue = make_issue(project, workspace, states["todo"], age=timedelta(hours=5))
        fresh = make_issue(project, workspace, states["todo"])
        for issue in (overdue, fresh):
            sla.refresh(issue)
        base = f"/api/workspaces/{workspace.slug}/projects/{project.id}"

        detail = session_client.get(f"{base}/issues/{overdue.id}/sla/").data
        summary = session_client.get(f"{base}/sla/summary/").data

        assert detail["status"] == "breached"
        assert detail["resolution"]["status"] == "breached"
        assert summary["counts"] == {"on_track": 1, "at_risk": 0, "breached": 1}
        assert [a["id"] for a in summary["attention"]] == [str(overdue.id)]
