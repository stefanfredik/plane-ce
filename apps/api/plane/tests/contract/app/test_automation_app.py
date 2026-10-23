# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom automations: trigger, conditions, actions, schedules and run history."""

from datetime import datetime, timedelta, timezone as dt_timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import (
    Automation,
    AutomationRun,
    Issue,
    IssueActivity,
    IssueComment,
    Project,
    ProjectMember,
    State,
    User,
    WorkspaceMember,
)
from plane.utils import automations

TOKEN = "123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd"


@pytest.fixture(autouse=True)
def no_background_tasks():
    # actions log their activity through celery; the tests only care about the changes
    with patch("plane.bgtasks.issue_activities_task.issue_activity.delay"):
        yield


@pytest.fixture
def project(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


@pytest.fixture
def states(project, workspace):
    def make(name, group, **kw):
        return State.objects.create(name=name, project=project, workspace=workspace, group=group, **kw)

    return {"todo": make("Todo", "unstarted", default=True), "done": make("Done", "completed")}


@pytest.fixture
def issue(project, workspace, states):
    return Issue.objects.create(name="ONT offline", workspace=workspace, project=project, state=states["todo"])


def url(workspace, project, suffix=""):
    return f"/api/workspaces/{workspace.slug}/projects/{project.id}/automations/{suffix}"


def create(client, workspace, project, **data):
    payload = {
        "name": "Close out",
        "trigger": {"type": "state_changed"},
        "actions": [{"type": "add_comment", "text": "Closed {{work_item.id}}"}],
        "is_enabled": True,
        **data,
    }
    response = client.post(url(workspace, project), payload, format="json")
    assert response.status_code == status.HTTP_201_CREATED, response.data
    return response.data


@pytest.mark.contract
class TestAutomationSettings:
    def test_cannot_enable_without_actions(self, session_client, workspace, project):
        response = session_client.post(
            url(workspace, project),
            {"name": "Empty", "trigger": {"type": "work_item_created"}, "actions": [], "is_enabled": True},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_trigger_type_is_fixed(self, session_client, workspace, project):
        created = create(session_client, workspace, project)

        response = session_client.patch(
            url(workspace, project, f"{created['id']}/"), {"trigger": {"type": "comment_added"}}, format="json"
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_enabled_automations_cannot_be_deleted(self, session_client, workspace, project):
        created = create(session_client, workspace, project)
        detail = url(workspace, project, f"{created['id']}/")

        blocked = session_client.delete(detail)
        session_client.patch(detail, {"is_enabled": False}, format="json")
        deleted = session_client.delete(detail)

        assert blocked.status_code == status.HTTP_400_BAD_REQUEST
        assert deleted.status_code == status.HTTP_204_NO_CONTENT

    def test_telegram_token_is_masked(self, session_client, workspace, project):
        telegram = {"type": "send_telegram", "bot_token": TOKEN, "chat_id": "-1001", "text": "{{work_item.name}}"}
        created = create(session_client, workspace, project, actions=[telegram])
        masked = created["actions"][0]["bot_token"]

        # saving the form again sends the masked token back
        session_client.patch(
            url(workspace, project, f"{created['id']}/"),
            {"actions": [{**created["actions"][0], "text": "changed"}]},
            format="json",
        )

        assert TOKEN not in masked and masked.endswith(TOKEN[-4:])
        assert Automation.objects.get(pk=created["id"]).actions[0]["bot_token"] == TOKEN

    def test_members_cannot_manage(self, api_client, workspace, project):
        user = User.objects.create(email=f"m-{uuid4().hex[:6]}@plane.so", username=f"m_{uuid4().hex[:6]}")
        WorkspaceMember.objects.create(workspace=workspace, member=user, role=15)
        ProjectMember.objects.create(project=project, member=user, role=15, is_active=True)
        api_client.force_authenticate(user=user)

        assert api_client.get(url(workspace, project)).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.contract
class TestAutomationRuns:
    def test_state_change_runs_matching_automation(
        self, session_client, workspace, project, states, issue, create_user
    ):
        create(
            session_client,
            workspace,
            project,
            conditions=[{"field": "state", "operator": "in", "value": [str(states["done"].id)]}],
            actions=[
                {"type": "add_comment", "text": "Closed {{work_item.id}} ({{work_item.state}})"},
                {"type": "change_priority", "priority": "low"},
            ],
        )
        Issue.objects.filter(pk=issue.pk).update(state=states["done"])

        runs = automations.dispatch(issue.id, ["state_changed"], create_user.id)

        issue.refresh_from_db()
        comment = IssueComment.objects.get(issue=issue)
        assert [r.status for r in runs] == ["success"]
        assert comment.actor.display_name == "Automation"
        assert comment.comment_html == "<p>Closed BUG-1 (Done)</p>"
        assert issue.priority == "low"

    def test_conditions_that_do_not_match_skip(self, session_client, workspace, project, states, issue, create_user):
        create(
            session_client,
            workspace,
            project,
            conditions=[{"field": "state", "operator": "in", "value": [str(states["done"].id)]}],
        )

        runs = automations.dispatch(issue.id, ["state_changed"], create_user.id)

        assert runs == []
        assert not AutomationRun.objects.exists()

    def test_bot_changes_do_not_trigger(self, session_client, workspace, project, issue):
        create(session_client, workspace, project)

        runs = automations.dispatch(issue.id, ["state_changed"], automations.bot_user().id)

        assert runs == []

    def test_failed_action_is_recorded(self, session_client, workspace, project, issue, create_user):
        telegram = {"type": "send_telegram", "bot_token": TOKEN, "chat_id": "-1001", "text": "{{work_item.name}}"}
        create(session_client, workspace, project, actions=[telegram, {"type": "change_priority", "priority": "high"}])
        refused = MagicMock(status_code=400, headers={"content-type": "application/json"})
        refused.json.return_value = {"description": "Bad Request: chat not found"}

        with patch("plane.utils.automations.requests.post", return_value=refused) as post:
            run = automations.dispatch(issue.id, ["state_changed"], create_user.id)[0]

        issue.refresh_from_db()
        assert post.call_args.kwargs["json"]["text"] == "ONT offline"
        assert run.status == "failed"
        assert run.details[0]["message"] == "Telegram refused the message: Bad Request: chat not found"
        # later actions still run
        assert issue.priority == "high"

    def test_history_and_manual_run(self, session_client, workspace, project, issue):
        created = create(
            session_client, workspace, project, actions=[{"type": "change_priority", "priority": "urgent"}]
        )
        runs_url = url(workspace, project, f"{created['id']}/runs/")

        ran = session_client.post(runs_url, {"issue_id": str(issue.id)}, format="json")
        history = session_client.get(runs_url).data

        assert ran.status_code == status.HTTP_200_OK
        assert [(r["event"], r["status"], r["issue"]["sequence_id"]) for r in history] == [("manual", "success", 1)]
        assert Automation.objects.get(pk=created["id"]).run_count == 1

    def test_events_from_activity(self):
        state = IssueActivity(field="state")
        labels = IssueActivity(field="labels")

        assert automations.events_from_activities("issue.activity.created", []) == ["work_item_created"]
        assert automations.events_from_activities("issue.activity.updated", [state, labels]) == [
            "label_changed",
            "state_changed",
        ]
        assert automations.events_from_activities("link.activity.created", [state]) == []


@pytest.mark.contract
class TestScheduledAutomations:
    def test_last_occurrence(self):
        now = datetime(2026, 10, 23, 3, 0, tzinfo=dt_timezone.utc)  # Friday 10:00 in Jakarta
        daily = {"frequency": "daily", "time": "09:00", "timezone": "Asia/Jakarta"}
        weekly = {"frequency": "weekly", "time": "09:00", "timezone": "Asia/Jakarta", "days": [0]}
        monthly = {"frequency": "monthly", "time": "09:00", "timezone": "Asia/Jakarta", "day": 31}

        assert automations.last_occurrence(daily, now) == datetime(2026, 10, 23, 2, 0, tzinfo=dt_timezone.utc)
        assert automations.last_occurrence(weekly, now) == datetime(2026, 10, 19, 2, 0, tzinfo=dt_timezone.utc)
        # September has no 31st, so it ran on the 30th
        assert automations.last_occurrence(monthly, now) == datetime(2026, 9, 30, 2, 0, tzinfo=dt_timezone.utc)

    def test_schedule_fires_once_per_occurrence(self, session_client, workspace, project, issue):
        created = create(
            session_client,
            workspace,
            project,
            trigger={"type": "schedule", "frequency": "daily", "time": "09:00", "timezone": "UTC"},
            conditions=[{"field": "stale_days", "value": 3}],
            actions=[{"type": "add_comment", "text": "Still open?"}],
        )
        Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now() - timedelta(days=5))
        Automation.objects.filter(pk=created["id"]).update(schedule_cursor=timezone.now() - timedelta(days=2))

        first = automations.run_due_schedules()
        second = automations.run_due_schedules()

        assert (first, second) == (1, 0)
        assert IssueComment.objects.filter(issue=issue).count() == 1

    def test_new_schedule_waits_for_next_time(self, session_client, workspace, project, issue):
        create(
            session_client,
            workspace,
            project,
            trigger={"type": "schedule", "frequency": "daily", "time": "00:00", "timezone": "UTC"},
        )

        assert automations.run_due_schedules() == 0
