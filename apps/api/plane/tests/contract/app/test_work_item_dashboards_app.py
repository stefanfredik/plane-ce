# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work item dashboards and widgets (web app API)."""

from datetime import timedelta
from uuid import uuid4

import pytest
from django.utils import timezone
from rest_framework import status

from plane.db.models import Issue, Project, ProjectMember, State, User, WorkspaceMember


def base(workspace):
    return f"/api/workspaces/{workspace.slug}/work-item-dashboards/"


@pytest.fixture
def states(db, workspace, create_user):
    project = Project.objects.create(name="Bugs", identifier="BUG", workspace=workspace, created_by=create_user)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    todo = State.objects.create(name="Todo", project=project, workspace=workspace, group="unstarted", default=True)
    done = State.objects.create(name="Done", project=project, workspace=workspace, group="completed")
    return project, todo, done


@pytest.fixture
def issues(states, workspace, create_user):
    project, todo, done = states
    now = timezone.now()
    made = []
    for name, state, priority, days_to_close in [
        ("a", todo, "urgent", None),
        ("b", todo, "high", None),
        ("c", done, "high", 2),
        ("d", done, "low", 4),
    ]:
        issue = Issue.objects.create(
            name=name, workspace=workspace, project=project, state=state, priority=priority, created_by=create_user
        )
        if days_to_close:
            Issue.objects.filter(id=issue.id).update(
                created_at=now - timedelta(days=10), completed_at=now - timedelta(days=10 - days_to_close)
            )
        made.append(issue)
    return made


def other_member(workspace, role=15):
    user = User.objects.create(email=f"u-{uuid4().hex[:6]}@plane.so", username=f"u_{uuid4().hex[:6]}")
    WorkspaceMember.objects.create(workspace=workspace, member=user, role=role)
    return user


@pytest.fixture
def dashboard(session_client, workspace, states, issues):
    project = states[0]
    widgets = [
        {"name": "Open", "widget_type": "NUMBER", "config": {"filters": {"state_groups": ["unstarted", "started"]}}},
        {"name": "MTTR", "widget_type": "NUMBER", "config": {"metric": "avg_resolution_days"}},
        {"name": "By priority", "widget_type": "BAR", "config": {"group_by": "priority"}},
        {
            "name": "By state",
            "widget_type": "PIE",
            "config": {"group_by": "state_group", "project_ids": [str(project.id)]},
        },
        {"name": "Trend", "widget_type": "LINE", "config": {"period": "week", "periods": 4}},
        {"name": "Latest", "widget_type": "TABLE", "config": {"limit": 2, "order_by": "priority"}},
    ]
    response = session_client.post(base(workspace), {"name": "Bug board", "widgets": widgets}, format="json")
    assert response.status_code == status.HTTP_201_CREATED
    return response.data


def data(client, workspace, dashboard, index):
    widget = dashboard["widgets"][index]
    return client.get(f"{base(workspace)}{dashboard['id']}/widgets/{widget['id']}/data/")


@pytest.mark.contract
class TestWidgetData:
    def test_number_count_and_resolution_time(self, session_client, workspace, dashboard):
        assert data(session_client, workspace, dashboard, 0).data == {"metric": "count", "value": 2}
        assert data(session_client, workspace, dashboard, 1).data == {"metric": "avg_resolution_days", "value": 3.0}

    def test_bar_by_priority_keeps_priority_order(self, session_client, workspace, dashboard):
        items = data(session_client, workspace, dashboard, 2).data["items"]

        assert [(i["key"], i["value"]) for i in items] == [("urgent", 1), ("high", 2), ("low", 1)]

    def test_pie_by_state_group(self, session_client, workspace, dashboard):
        items = data(session_client, workspace, dashboard, 3).data["items"]

        assert {i["key"]: i["value"] for i in items} == {"unstarted": 2, "completed": 2}

    def test_line_has_every_period(self, session_client, workspace, dashboard):
        points = data(session_client, workspace, dashboard, 4).data["points"]

        assert len(points) == 4
        assert sum(p["created"] for p in points) == 4  # the backdated ones (10 days) are still inside 4 weeks
        assert sum(p["completed"] for p in points) == 2

    def test_table_orders_by_priority_and_limits(self, session_client, workspace, dashboard):
        rows = data(session_client, workspace, dashboard, 5).data["rows"]

        assert [r["name"] for r in rows] == ["a", "b"]
        assert rows[0]["identifier"].startswith("BUG-")

    def test_bad_grouping_is_reported(self, session_client, workspace, dashboard):
        widget = dashboard["widgets"][2]
        session_client.patch(
            f"{base(workspace)}{dashboard['id']}/widgets/{widget['id']}/",
            {"config": {"group_by": "password"}},
            format="json",
        )

        assert data(session_client, workspace, dashboard, 2).status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.contract
class TestDashboardAccess:
    def test_private_dashboard_is_hidden_from_others(self, api_client, workspace, dashboard):
        api_client.force_authenticate(user=other_member(workspace))

        assert api_client.get(base(workspace)).data == []
        assert api_client.get(f"{base(workspace)}{dashboard['id']}/").status_code == status.HTTP_404_NOT_FOUND

    def test_shared_dashboard_shows_only_projects_the_viewer_is_in(
        self, session_client, api_client, workspace, dashboard
    ):
        session_client.patch(f"{base(workspace)}{dashboard['id']}/", {"access": 1}, format="json")
        viewer = other_member(workspace)
        api_client.force_authenticate(user=viewer)

        listed = api_client.get(base(workspace)).data
        count = data(api_client, workspace, dashboard, 0).data

        assert [d["id"] for d in listed] == [dashboard["id"]]
        assert listed[0]["can_edit"] is False
        assert count["value"] == 0  # the viewer is not a member of the project

    def test_only_owner_or_admin_edits(self, session_client, api_client, workspace, dashboard):
        session_client.patch(f"{base(workspace)}{dashboard['id']}/", {"access": 1}, format="json")
        api_client.force_authenticate(user=other_member(workspace))

        response = api_client.patch(f"{base(workspace)}{dashboard['id']}/", {"name": "Mine"}, format="json")
        widget = api_client.post(
            f"{base(workspace)}{dashboard['id']}/widgets/", {"name": "x", "widget_type": "NUMBER"}, format="json"
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert widget.status_code == status.HTTP_403_FORBIDDEN

    def test_guest_without_view_all_sees_only_own_items(self, session_client, api_client, workspace, states, dashboard):
        project = states[0]
        session_client.patch(f"{base(workspace)}{dashboard['id']}/", {"access": 1}, format="json")
        guest = other_member(workspace, role=5)
        ProjectMember.objects.create(project=project, member=guest, role=5, is_active=True)
        mine = Issue.objects.create(name="mine", workspace=workspace, project=project, state=states[1])
        Issue.objects.filter(id=mine.id).update(created_by=guest)  # save() stamps the request user
        api_client.force_authenticate(user=guest)

        assert data(api_client, workspace, dashboard, 0).data["value"] == 1

    def test_widget_validation(self, session_client, workspace, dashboard):
        response = session_client.post(
            f"{base(workspace)}{dashboard['id']}/widgets/",
            {"name": "", "widget_type": "MAP", "width": "x"},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert set(response.data["errors"]) == {"name", "widget_type", "width"}
