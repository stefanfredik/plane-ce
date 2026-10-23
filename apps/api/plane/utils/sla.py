# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""SLA: response and resolution targets per priority (or per option of a dropdown property).

The clock starts when the work item is created. It is answered when the work
item first moves to a started, completed or cancelled state, or when someone
other than its creator comments; it is resolved in a completed or cancelled state.
"""

from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from plane.db.models import (
    Issue,
    IssueActivity,
    IssueComment,
    IssueProperty,
    IssuePropertyOption,
    IssuePropertyType,
    IssueSla,
    SlaPolicy,
    State,
)
from plane.utils import work_item_types

PRIORITIES = ("urgent", "high", "medium", "low", "none")
RESPONDED_GROUPS = ("started", "completed", "cancelled")
RESOLVED_GROUPS = ("completed", "cancelled")
# events after which a work item's clock may change
SLA_EVENTS = {"work_item_created", "state_changed", "priority_changed", "property_changed", "comment_added"}
MAX_MINUTES = 60 * 24 * 365
STATUS_ORDER = ("breached", "at_risk", "on_track", "missed", "met")


class SlaError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def get_policy(project_id):
    return SlaPolicy.objects.filter(project_id=project_id).first()


def serialize_policy(policy, project_id):
    return {
        "project_id": str(project_id),
        "is_enabled": bool(policy and policy.is_enabled),
        "based_on": policy.based_on if policy else "priority",
        "targets": (policy.targets if policy else {}) or {},
        "at_risk_percent": policy.at_risk_percent if policy else 25,
    }


def _minutes(value, label):
    if value in (None, ""):
        return None
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        raise SlaError(f"{label} must be a number of minutes.")
    if not 1 <= minutes <= MAX_MINUTES:
        raise SlaError(f"{label} must be between 1 minute and a year.")
    return minutes


def _keys(project_id, based_on):
    if based_on == "priority":
        return set(PRIORITIES)
    prop = IssueProperty.objects.filter(
        project_id=project_id, pk=based_on, property_type=IssuePropertyType.OPTION
    ).first()
    if prop is None:
        raise SlaError("Choose priority or a dropdown property.")
    return {str(o) for o in IssuePropertyOption.objects.filter(property=prop).values_list("id", flat=True)}


def update_policy(project, user, data):
    policy = get_policy(project.id) or SlaPolicy(project=project, workspace_id=project.workspace_id, created_by=user)
    if "based_on" in data:
        based_on = str(data["based_on"] or "priority")
        _keys(project.id, based_on)
        if based_on != policy.based_on:
            policy.targets = {}
        policy.based_on = based_on
    if "targets" in data:
        if not isinstance(data["targets"], dict):
            raise SlaError("Targets must be an object.")
        keys = _keys(project.id, policy.based_on)
        clean = {}
        for key, target in data["targets"].items():
            if str(key) not in keys:
                raise SlaError(f"Unknown value: {key}")
            target = target or {}
            response = _minutes(target.get("response"), "Response time")
            resolution = _minutes(target.get("resolution"), "Resolution time")
            if response and resolution and response > resolution:
                raise SlaError("Response time cannot be longer than resolution time.")
            if response or resolution:
                clean[str(key)] = {"response": response, "resolution": resolution}
        policy.targets = clean
    if "at_risk_percent" in data:
        percent = int(data["at_risk_percent"] or 0)
        if not 1 <= percent <= 90:
            raise SlaError("At risk must be between 1 and 90 percent.")
        policy.at_risk_percent = percent
    if "is_enabled" in data:
        policy.is_enabled = bool(data["is_enabled"])
    policy.updated_by = user
    policy.save()
    transaction.on_commit(lambda: _queue_project_refresh(project.id))
    return policy


def _queue_project_refresh(project_id):
    from plane.bgtasks.sla_task import refresh_project_slas

    refresh_project_slas.delay(str(project_id))


# ---------------------------------------------------------------------------
# Clocks


def _key(issue, policy):
    if policy.based_on == "priority":
        return issue.priority or "none"
    values = work_item_types.issue_property_values(issue).get(policy.based_on) or []
    return values[0] if values else None


def _first_response(issue):
    responded_states = State.all_state_objects.filter(project_id=issue.project_id, group__in=RESPONDED_GROUPS)
    moved = (
        IssueActivity.objects.filter(issue_id=issue.id, field="state", new_identifier__in=responded_states.values("id"))
        .order_by("created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    commented = (
        IssueComment.objects.filter(issue_id=issue.id, actor__is_bot=False)
        .exclude(actor_id=issue.created_by_id)
        .order_by("created_at")
        .values_list("created_at", flat=True)
        .first()
    )
    found = [t for t in (moved, commented) if t]
    return min(found) if found else None


def refresh(issue, policy=None, silent=False, now=None):
    """Bring the work item's SLA clock up to date. ``silent`` marks breaches that already
    happened without raising events (used when the policy itself changes)."""
    now = now or timezone.now()
    policy = policy if policy is not None else get_policy(issue.project_id)
    target = None
    if policy and policy.is_enabled and not issue.is_draft and not issue.archived_at:
        key = _key(issue, policy)
        target = policy.targets.get(key) if key else None
    if not target or not issue.state_id or issue.state.group == "triage":
        IssueSla.objects.filter(issue_id=issue.id).delete(soft=False)
        return None

    row = IssueSla.objects.filter(issue_id=issue.id).first() or IssueSla(
        issue=issue, project_id=issue.project_id, workspace_id=issue.workspace_id
    )
    row.key = key
    row.started_at = issue.created_at
    row.response_due_at = row.started_at + timedelta(minutes=target["response"]) if target["response"] else None
    row.resolution_due_at = row.started_at + timedelta(minutes=target["resolution"]) if target["resolution"] else None
    row.responded_at = row.responded_at or _first_response(issue)
    if issue.state.group in RESOLVED_GROUPS:
        row.resolved_at = row.resolved_at or issue.completed_at or now
        row.responded_at = row.responded_at or row.resolved_at
    else:
        row.resolved_at = None

    # a target that moved later (say, the priority dropped) is no longer breached
    response_end = row.responded_at or now
    if not row.response_due_at or response_end <= row.response_due_at:
        row.response_breached_at = None
    elif silent or row.responded_at:
        row.response_breached_at = row.response_breached_at or row.response_due_at
    resolution_end = row.resolved_at or now
    if not row.resolution_due_at or resolution_end <= row.resolution_due_at:
        row.resolution_breached_at = None
    elif silent or row.resolved_at:
        row.resolution_breached_at = row.resolution_breached_at or row.resolution_due_at
    row.save()
    return row


def refresh_by_id(issue_id):
    issue = Issue.objects.filter(pk=issue_id).select_related("state").first()
    return refresh(issue) if issue else None


def refresh_project(project_id):
    policy = get_policy(project_id)
    issues = Issue.issue_objects.filter(project_id=project_id).select_related("state")
    if not policy or not policy.is_enabled:
        IssueSla.objects.filter(project_id=project_id).delete(soft=False)
        return 0
    count = 0
    for issue in issues.iterator(chunk_size=200):
        if refresh(issue, policy, silent=True):
            count += 1
    return count


def queue_refresh(project_id, issue_id, events):
    if not SLA_EVENTS.intersection(events):
        return
    if not SlaPolicy.objects.filter(project_id=project_id, is_enabled=True).exists():
        return
    from plane.bgtasks.sla_task import refresh_issue_sla

    transaction.on_commit(lambda: refresh_issue_sla.delay(str(issue_id)))


def check_breaches(now=None):
    """Mark targets that just ran out and tell the automations. Returns the breached work item ids."""
    from plane.utils import automations

    now = now or timezone.now()
    breached = set()
    open_rows = IssueSla.objects.filter(resolved_at__isnull=True, issue__deleted_at__isnull=True)
    for row in open_rows.filter(response_due_at__lt=now, responded_at__isnull=True, response_breached_at__isnull=True):
        IssueSla.objects.filter(pk=row.pk).update(response_breached_at=row.response_due_at)
        breached.add(row.issue_id)
    for row in open_rows.filter(resolution_due_at__lt=now, resolution_breached_at__isnull=True):
        IssueSla.objects.filter(pk=row.pk).update(resolution_breached_at=row.resolution_due_at)
        breached.add(row.issue_id)
    for issue_id in breached:
        automations.dispatch(issue_id, ["sla_breached"])
    return breached


# ---------------------------------------------------------------------------
# Status


def _target_status(due, done_at, started, now, at_risk_percent):
    if not due:
        return None
    if done_at:
        return "met" if done_at <= due else "missed"
    if now > due:
        return "breached"
    total = (due - started).total_seconds()
    left = (due - now).total_seconds()
    return "at_risk" if total > 0 and left / total * 100 <= at_risk_percent else "on_track"


def statuses(row, at_risk_percent, now=None):
    now = now or timezone.now()
    response = _target_status(row.response_due_at, row.responded_at, row.started_at, now, at_risk_percent)
    resolution = _target_status(row.resolution_due_at, row.resolved_at, row.started_at, now, at_risk_percent)
    # a target still running describes the work item best; otherwise the worst finished one
    running = [s for s in (response, resolution) if s in ("breached", "at_risk", "on_track")]
    finished = [s for s in (response, resolution) if s in ("missed", "met")]
    present = running or finished
    overall = min(present, key=STATUS_ORDER.index) if present else None
    return response, resolution, overall


def serialize_issue_sla(row, policy, now=None):
    if row is None:
        return None
    response, resolution, overall = statuses(row, policy.at_risk_percent if policy else 25, now)
    return {
        "key": row.key,
        "status": overall,
        "response": {"due_at": row.response_due_at, "done_at": row.responded_at, "status": response},
        "resolution": {"due_at": row.resolution_due_at, "done_at": row.resolved_at, "status": resolution},
    }


def summary(project_ids, now=None, limit=20):
    """Open work items by SLA status, and the ones that need attention first."""
    now = now or timezone.now()
    policies = {p.project_id: p for p in SlaPolicy.objects.filter(project_id__in=project_ids, is_enabled=True)}
    rows = (
        IssueSla.objects.filter(
            project_id__in=policies.keys(),
            resolved_at__isnull=True,
            issue__deleted_at__isnull=True,
            issue__archived_at__isnull=True,
        )
        .select_related("issue__project", "issue__state")
        .order_by("resolution_due_at")
    )
    counts = {"on_track": 0, "at_risk": 0, "breached": 0}
    attention = []
    for row in rows:
        _response, _resolution, overall = statuses(row, policies[row.project_id].at_risk_percent, now)
        if overall in counts:
            counts[overall] += 1
        if overall in ("breached", "at_risk") and len(attention) < limit:
            issue = row.issue
            attention.append(
                {
                    "id": str(issue.id),
                    "project_id": str(issue.project_id),
                    "name": issue.name,
                    "sequence_id": issue.sequence_id,
                    "project_identifier": issue.project.identifier,
                    "status": overall,
                    "due_at": row.resolution_due_at or row.response_due_at,
                }
            )
    attention.sort(key=lambda a: (a["status"] != "breached", a["due_at"] or now))
    return {"counts": counts, "attention": attention}
