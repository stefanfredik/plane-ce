# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Custom automations: if <trigger> and the work item matches <conditions>, run <actions>.

Actions run as the "Automation" bot, and the bot's own changes never trigger
automations, so one automation cannot set off a chain of others.
"""

import json
import re
import time
from datetime import datetime, timedelta
from html import escape
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests
from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from plane.db.models import (
    Automation,
    AutomationRun,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    IssueProperty,
    IssueSla,
    Label,
    ProjectMember,
    State,
    User,
)
from plane.utils import work_item_types
from plane.utils.bots import get_bot

EVENTS = (
    "work_item_created",
    "state_changed",
    "priority_changed",
    "assignee_changed",
    "label_changed",
    "property_changed",
    "comment_added",
    "sla_breached",
)
TRIGGERS = EVENTS + ("schedule",)
FREQUENCIES = ("daily", "weekly", "monthly")
PRIORITIES = ("urgent", "high", "medium", "low", "none")
STATE_GROUPS = ("backlog", "unstarted", "started", "completed", "cancelled", "triage")
ACTIONS = (
    "change_state",
    "change_priority",
    "add_assignees",
    "remove_assignees",
    "add_labels",
    "set_property",
    "add_comment",
    "send_telegram",
    "send_webhook",
)
LIST_OPERATORS = ("in", "not_in", "is_empty", "is_not_empty")
SLA_STATUSES = ("on_track", "at_risk", "breached", "met", "missed")
MAX_SCHEDULED_ITEMS = 500
MAX_TEXT = 4000
SECRET_MASK = "••••••"

# which activity fields raise which events
FIELD_EVENTS = {
    "state": "state_changed",
    "priority": "priority_changed",
    "assignees": "assignee_changed",
    "labels": "label_changed",
    "custom_property": "property_changed",
}


class AutomationError(Exception):
    def __init__(self, errors):
        super().__init__(str(errors))
        self.errors = errors if isinstance(errors, dict) else {"error": errors}


# ---------------------------------------------------------------------------
# Bot user


def bot_user():
    return get_bot("AUTOMATION", "Automation")


def is_bot(user_id):
    """Only the Automation bot is ignored; work items made by integrations still run automations."""
    return bool(user_id) and User.objects.filter(pk=user_id, is_bot=True, bot_type="AUTOMATION").exists()


# ---------------------------------------------------------------------------
# Validation and serialization


def _uuid_list(value, allowed, label):
    if not isinstance(value, list) or not value:
        raise AutomationError(f"Choose at least one {label}.")
    ids = [str(v) for v in value]
    unknown = [v for v in ids if v not in allowed]
    if unknown:
        raise AutomationError(f"Unknown {label}: {', '.join(unknown)}")
    return list(dict.fromkeys(ids))


def _clean_text(value, label, required=True):
    text = str(value or "").strip()
    if required and not text:
        raise AutomationError(f"{label} is required.")
    if len(text) > MAX_TEXT:
        raise AutomationError(f"{label} is too long.")
    return text


def _clean_trigger(project_id, trigger):
    if not isinstance(trigger, dict) or trigger.get("type") not in TRIGGERS:
        raise AutomationError({"trigger": "Choose a trigger."})
    kind = trigger["type"]
    if kind == "schedule":
        frequency = trigger.get("frequency", "daily")
        if frequency not in FREQUENCIES:
            raise AutomationError({"trigger": "Unknown frequency."})
        time_text = str(trigger.get("time", "09:00"))
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", time_text):
            raise AutomationError({"trigger": "Time must look like 09:00."})
        tz = str(trigger.get("timezone") or "UTC")
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            raise AutomationError({"trigger": "Unknown timezone."})
        clean = {"type": kind, "frequency": frequency, "time": time_text, "timezone": tz}
        if frequency == "weekly":
            days = sorted({int(d) for d in trigger.get("days") or [] if str(d).isdigit() and 0 <= int(d) <= 6})
            if not days:
                raise AutomationError({"trigger": "Select at least one day of the week."})
            clean["days"] = days
        if frequency == "monthly":
            day = int(trigger.get("day") or 0)
            if not 1 <= day <= 31:
                raise AutomationError({"trigger": "Select a day of the month."})
            clean["day"] = day
        return clean
    if kind == "property_changed" and trigger.get("property_id"):
        if not IssueProperty.objects.filter(project_id=project_id, pk=trigger["property_id"]).exists():
            raise AutomationError({"trigger": "Unknown property."})
        return {"type": kind, "property_id": str(trigger["property_id"])}
    return {"type": kind}


def _project_ids(model, project_id, **filters):
    return {str(i) for i in model.objects.filter(project_id=project_id, **filters).values_list("id", flat=True)}


def _member_ids(project_id):
    return {
        str(m)
        for m in ProjectMember.objects.filter(project_id=project_id, is_active=True).values_list("member_id", flat=True)
    }


def _clean_conditions(project_id, conditions):
    if not isinstance(conditions, list):
        raise AutomationError({"conditions": "Conditions must be a list."})
    clean = []
    for condition in conditions:
        if not isinstance(condition, dict):
            raise AutomationError({"conditions": "Each condition must be an object."})
        field = str(condition.get("field") or "")
        operator = condition.get("operator") or "in"
        value = condition.get("value")
        if field in ("stale_days",):
            days = int(value) if str(value).isdigit() else 0
            if days < 1:
                raise AutomationError({"conditions": "Days must be 1 or more."})
            clean.append({"field": field, "operator": "gte", "value": days})
            continue
        if field == "overdue":
            clean.append({"field": field, "operator": "is", "value": bool(value)})
            continue
        if operator not in LIST_OPERATORS:
            raise AutomationError({"conditions": "Unknown operator."})
        if operator in ("is_empty", "is_not_empty"):
            if field in ("state", "state_group", "priority", "sla_status"):
                raise AutomationError({"conditions": "A work item always has this field."})
            value = []
        else:
            try:
                if field == "state":
                    value = _uuid_list(value, _project_ids(State, project_id), "state")
                elif field == "state_group":
                    value = _uuid_list(value, set(STATE_GROUPS), "state group")
                elif field == "priority":
                    value = _uuid_list(value, set(PRIORITIES), "priority")
                elif field == "type":
                    allowed = {str(t.id) for t in work_item_types.project_issue_types(project_id)}
                    value = _uuid_list(value, allowed, "type")
                elif field == "assignees":
                    value = _uuid_list(value, _member_ids(project_id), "member")
                elif field == "labels":
                    value = _uuid_list(value, _project_ids(Label, project_id), "label")
                elif field == "sla_status":
                    value = _uuid_list(value, set(SLA_STATUSES), "SLA status")
                elif field.startswith("property:"):
                    prop = IssueProperty.objects.filter(project_id=project_id, pk=field.split(":", 1)[1]).first()
                    if prop is None:
                        raise AutomationError("Unknown property.")
                    if not isinstance(value, list) or not value:
                        raise AutomationError("Choose at least one value.")
                    value = [str(v) for v in value][:50]
                else:
                    raise AutomationError("Unknown condition.")
            except AutomationError as e:
                raise AutomationError({"conditions": e.errors["error"]})
        clean.append({"field": field, "operator": operator, "value": value})
    return clean


def _clean_actions(project_id, actions, previous=None):
    if not isinstance(actions, list):
        raise AutomationError({"actions": "Actions must be a list."})
    previous = previous or []
    clean = []
    for index, action in enumerate(actions):
        if not isinstance(action, dict) or action.get("type") not in ACTIONS:
            raise AutomationError({"actions": "Choose what the action does."})
        kind = action["type"]
        try:
            if kind == "change_state":
                state = _uuid_list([action.get("state_id")], _project_ids(State, project_id), "state")[0]
                clean.append({"type": kind, "state_id": state})
            elif kind == "change_priority":
                priority = _uuid_list([action.get("priority")], set(PRIORITIES), "priority")[0]
                clean.append({"type": kind, "priority": priority})
            elif kind in ("add_assignees", "remove_assignees"):
                members = _uuid_list(action.get("member_ids"), _member_ids(project_id), "member")
                clean.append({"type": kind, "member_ids": members})
            elif kind == "add_labels":
                labels = _uuid_list(action.get("label_ids"), _project_ids(Label, project_id), "label")
                clean.append({"type": kind, "label_ids": labels})
            elif kind == "set_property":
                prop = IssueProperty.objects.filter(project_id=project_id, pk=action.get("property_id")).first()
                if prop is None:
                    raise AutomationError("Choose a property.")
                values = action.get("values")
                if not isinstance(values, list):
                    raise AutomationError("Values must be a list.")
                clean.append({"type": kind, "property_id": str(prop.id), "values": [str(v) for v in values]})
            elif kind == "add_comment":
                clean.append({"type": kind, "text": _clean_text(action.get("text"), "Comment")})
            elif kind == "send_telegram":
                token = str(action.get("bot_token") or "").strip()
                if token.startswith(SECRET_MASK):
                    # the form sends back the masked token when it was not changed
                    old = next(
                        (
                            a
                            for a in previous
                            if a.get("type") == kind and a.get("bot_token", "").endswith(token[len(SECRET_MASK) :])
                        ),
                        None,
                    )
                    token = old["bot_token"] if old else ""
                if not re.fullmatch(r"\d+:[A-Za-z0-9_-]{20,}", token):
                    raise AutomationError("Enter the bot token from @BotFather.")
                chat_id = str(action.get("chat_id") or "").strip()
                if not re.fullmatch(r"-?\d+|@[A-Za-z0-9_]{4,}", chat_id):
                    raise AutomationError("Enter a chat id such as -1001234567890 or @channel.")
                clean.append(
                    {
                        "type": kind,
                        "bot_token": token,
                        "chat_id": chat_id,
                        "text": _clean_text(action.get("text"), "Message"),
                    }
                )
            elif kind == "send_webhook":
                url = str(action.get("url") or "").strip()
                if not re.fullmatch(r"https?://\S+", url):
                    raise AutomationError("Enter a URL starting with http:// or https://.")
                clean.append({"type": kind, "url": url, "text": _clean_text(action.get("text"), "Message", False)})
        except AutomationError as e:
            raise AutomationError({"actions": f"Action {index + 1}: {e.errors['error']}"})
    return clean


def save_automation(project, user, data, automation=None):
    automation = automation or Automation(project=project, workspace_id=project.workspace_id, created_by=user)
    if "name" in data or automation._state.adding:
        automation.name = _clean_text(data.get("name"), "Title")[:255]
    if "description" in data:
        automation.description = _clean_text(data.get("description"), "Description", False)
    if "trigger" in data:
        new_trigger = _clean_trigger(project.id, data["trigger"])
        if not automation._state.adding and automation.trigger.get("type") != new_trigger["type"]:
            raise AutomationError({"trigger": "You can't change the trigger type once created."})
        automation.trigger = new_trigger
    if "match" in data:
        automation.match = "any" if data["match"] == "any" else "all"
    if "conditions" in data:
        automation.conditions = _clean_conditions(project.id, data["conditions"])
    if "actions" in data:
        automation.actions = _clean_actions(project.id, data["actions"], automation.actions)
    if "is_enabled" in data:
        automation.is_enabled = bool(data["is_enabled"])
    if "trigger" in data or "is_enabled" in data:
        # a schedule only fires for times after it was last set up or switched on
        automation.schedule_cursor = timezone.now()
    if automation.is_enabled and (not automation.trigger.get("type") or not automation.actions):
        raise AutomationError("Automation must have a trigger and at least one action to be enabled.")
    automation.updated_by = user
    automation.save()
    return automation


def _public_action(action):
    if action.get("type") == "send_telegram":
        return {**action, "bot_token": SECRET_MASK + action.get("bot_token", "")[-4:]}
    return action


def serialize_automation(automation):
    return {
        "id": str(automation.id),
        "project_id": str(automation.project_id),
        "name": automation.name,
        "description": automation.description,
        "is_enabled": automation.is_enabled,
        "trigger": automation.trigger,
        "match": automation.match,
        "conditions": automation.conditions,
        "actions": [_public_action(a) for a in automation.actions],
        "last_run_at": automation.last_run_at,
        "last_run_status": automation.last_run_status or None,
        "run_count": automation.run_count,
        "created_by": str(automation.created_by_id) if automation.created_by_id else None,
        "created_at": automation.created_at,
        "updated_at": automation.updated_at,
    }


def serialize_run(run):
    issue = run.issue
    return {
        "id": str(run.id),
        "event": run.event,
        "status": run.status,
        "details": run.details,
        "duration_ms": run.duration_ms,
        "created_at": run.created_at,
        "issue": (
            {
                "id": str(issue.id),
                "name": issue.name,
                "sequence_id": issue.sequence_id,
                "project_identifier": issue.project.identifier,
            }
            if issue
            else None
        ),
    }


# ---------------------------------------------------------------------------
# Matching


class _Facts:
    """What conditions and templates read from a work item, loaded on demand."""

    def __init__(self, issue):
        self.issue = issue
        self._assignees = None
        self._labels = None
        self._values = None

    @property
    def assignees(self):
        if self._assignees is None:
            self._assignees = {
                str(a) for a in IssueAssignee.objects.filter(issue=self.issue).values_list("assignee_id", flat=True)
            }
        return self._assignees

    @property
    def labels(self):
        if self._labels is None:
            self._labels = {
                str(a) for a in IssueLabel.objects.filter(issue=self.issue).values_list("label_id", flat=True)
            }
        return self._labels

    @property
    def values(self):
        if self._values is None:
            self._values = work_item_types.issue_property_values(self.issue)
        return self._values

    def field(self, field):
        issue = self.issue
        if field == "state":
            return {str(issue.state_id)} if issue.state_id else set()
        if field == "state_group":
            return {issue.state.group} if issue.state_id else set()
        if field == "priority":
            return {issue.priority or "none"}
        if field == "type":
            return {str(issue.type_id)} if issue.type_id else set()
        if field == "assignees":
            return self.assignees
        if field == "labels":
            return self.labels
        if field.startswith("property:"):
            return set(self.values.get(field.split(":", 1)[1], []))
        if field == "sla_status":
            from plane.utils import sla

            policy = sla.get_policy(issue.project_id)
            row = IssueSla.objects.filter(issue_id=issue.id).first()
            status = sla.statuses(row, policy.at_risk_percent)[2] if row and policy and policy.is_enabled else None
            return {status} if status else set()
        return set()


def _condition_holds(condition, facts, now):
    field, operator, value = condition["field"], condition["operator"], condition["value"]
    issue = facts.issue
    if field == "stale_days":
        return issue.updated_at <= now - timedelta(days=value)
    if field == "overdue":
        is_open = issue.state_id and issue.state.group not in ("completed", "cancelled")
        overdue = bool(is_open and issue.target_date and issue.target_date < now.date())
        return overdue == value
    current = facts.field(field)
    if operator == "is_empty":
        return not current
    if operator == "is_not_empty":
        return bool(current)
    hit = bool(current & set(value))
    return hit if operator == "in" else not hit


def matches(automation, facts, now=None):
    now = now or timezone.now()
    results = (_condition_holds(c, facts, now) for c in automation.conditions)
    if not automation.conditions:
        return True
    return any(results) if automation.match == "any" else all(results)


# ---------------------------------------------------------------------------
# Templates


def work_item_url(issue):
    base = (settings.WEB_URL or "").rstrip("/")
    return f"{base}/{issue.workspace.slug}/browse/{issue.project.identifier}-{issue.sequence_id}/"


def render(text, facts):
    issue = facts.issue

    def assignee_names():
        names = User.objects.filter(pk__in=facts.assignees).values_list("display_name", flat=True)
        return ", ".join(sorted(names)) or "-"

    simple = {
        "work_item.name": lambda: issue.name,
        "work_item.id": lambda: f"{issue.project.identifier}-{issue.sequence_id}",
        "work_item.state": lambda: issue.state.name if issue.state_id else "-",
        "work_item.priority": lambda: issue.priority or "none",
        "work_item.url": lambda: work_item_url(issue),
        "work_item.assignees": assignee_names,
        "project.name": lambda: issue.project.name,
    }

    def replace(match):
        key = match.group(1).strip()
        if key in simple:
            return str(simple[key]())
        if key.startswith("property."):
            name = key.split(".", 1)[1].strip().lower()
            prop = next(
                (
                    p
                    for p in IssueProperty.objects.filter(project_id=issue.project_id)
                    if p.display_name.lower() == name
                ),
                None,
            )
            if prop is None:
                return match.group(0)
            values = facts.values.get(str(prop.id), [])
            return work_item_types._display(prop, values) or "-"
        return match.group(0)

    return re.sub(r"\{\{\s*([^}]+?)\s*\}\}", replace, text)


# ---------------------------------------------------------------------------
# Actions


def _log_update(issue, bot, requested, current):
    from plane.bgtasks.issue_activities_task import issue_activity

    issue_activity.delay(
        type="issue.activity.updated",
        requested_data=json.dumps(requested),
        current_instance=json.dumps(current),
        issue_id=str(issue.id),
        actor_id=str(bot.id),
        project_id=str(issue.project_id),
        epoch=int(time.time()),
        notification=True,
    )


def _apply(action, issue, facts, bot, event):
    kind = action["type"]
    if kind == "change_state":
        state = State.objects.filter(project_id=issue.project_id, pk=action["state_id"]).first()
        if state is None:
            raise AutomationError("The state no longer exists.")
        if issue.state_id == state.id:
            return f"Already in {state.name}"
        old = str(issue.state_id) if issue.state_id else None
        issue.state = state
        issue.updated_by = bot
        issue.save()
        _log_update(issue, bot, {"state_id": str(state.id)}, {"state_id": old})
        return f"Moved to {state.name}"
    if kind == "change_priority":
        if issue.priority == action["priority"]:
            return f"Priority already {action['priority']}"
        old = issue.priority
        issue.priority = action["priority"]
        issue.updated_by = bot
        issue.save()
        _log_update(issue, bot, {"priority": action["priority"]}, {"priority": old})
        return f"Priority set to {action['priority']}"
    if kind in ("add_assignees", "remove_assignees"):
        before = set(facts.assignees)
        active = _member_ids(issue.project_id)
        wanted = {m for m in action["member_ids"] if m in active}
        if kind == "add_assignees":
            for member_id in wanted - before:
                IssueAssignee.objects.create(
                    issue=issue,
                    assignee_id=member_id,
                    project_id=issue.project_id,
                    workspace_id=issue.workspace_id,
                    created_by=bot,
                    updated_by=bot,
                )
            after = before | wanted
        else:
            IssueAssignee.objects.filter(issue=issue, assignee_id__in=wanted & before).delete()
            after = before - wanted
        facts._assignees = after
        if after == before:
            return "Assignees unchanged"
        _log_update(issue, bot, {"assignee_ids": sorted(after)}, {"assignee_ids": sorted(before)})
        return "Assignees updated"
    if kind == "add_labels":
        before = set(facts.labels)
        existing = _project_ids(Label, issue.project_id)
        added = {label for label in action["label_ids"] if label in existing} - before
        for label_id in added:
            IssueLabel.objects.create(
                issue=issue,
                label_id=label_id,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                created_by=bot,
                updated_by=bot,
            )
        if not added:
            return "Labels unchanged"
        facts._labels = before | added
        _log_update(issue, bot, {"label_ids": sorted(before | added)}, {"label_ids": sorted(before)})
        return "Labels added"
    if kind == "set_property":
        try:
            work_item_types.save_issue_property_values(issue, {action["property_id"]: action["values"]}, bot)
        except work_item_types.PropertyValueError as e:
            raise AutomationError(" ".join(str(v) for v in e.errors.values()))
        facts._values = None
        return "Property updated"
    if kind == "add_comment":
        from plane.bgtasks.issue_activities_task import issue_activity

        text = render(action["text"], facts)
        html = "".join(f"<p>{escape(line)}</p>" for line in text.splitlines() if line.strip()) or "<p></p>"
        comment = IssueComment.objects.create(
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            comment_html=html,
            actor=bot,
            created_by=bot,
            updated_by=bot,
        )
        issue_activity.delay(
            type="comment.activity.created",
            requested_data=json.dumps({"comment_html": html, "id": str(comment.id)}),
            current_instance=None,
            issue_id=str(issue.id),
            actor_id=str(bot.id),
            project_id=str(issue.project_id),
            epoch=int(time.time()),
            notification=True,
        )
        return "Comment added"
    if kind == "send_telegram":
        response = requests.post(
            f"https://api.telegram.org/bot{action['bot_token']}/sendMessage",
            json={
                "chat_id": action["chat_id"],
                "text": render(action["text"], facts)[:MAX_TEXT],
                "disable_web_page_preview": True,
            },
            timeout=10,
        )
        if response.status_code != 200:
            reason = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            raise AutomationError(f"Telegram refused the message: {reason.get('description', response.status_code)}")
        return "Telegram message sent"
    if kind == "send_webhook":
        payload = {
            "event": event,
            "text": render(action.get("text") or "", facts),
            "work_item": {
                "id": str(issue.id),
                "key": f"{issue.project.identifier}-{issue.sequence_id}",
                "name": issue.name,
                "state": issue.state.name if issue.state_id else None,
                "priority": issue.priority,
                "url": work_item_url(issue),
            },
        }
        response = requests.post(action["url"], json=payload, timeout=10)
        if response.status_code >= 400:
            raise AutomationError(f"The webhook answered {response.status_code}.")
        return f"Webhook answered {response.status_code}"
    raise AutomationError("Unknown action.")


def run(automation, issue, event, facts=None):
    """Run the automation's actions on one work item and record the run."""
    started = time.monotonic()
    bot = bot_user()
    facts = facts or _Facts(issue)
    details, failed = [], False
    for action in automation.actions:
        try:
            with transaction.atomic():
                details.append(
                    {"action": action["type"], "ok": True, "message": _apply(action, issue, facts, bot, event)}
                )
        except (AutomationError, requests.RequestException) as e:
            failed = True
            message = e.errors.get("error") if isinstance(e, AutomationError) else "Could not reach the server."
            details.append({"action": action["type"], "ok": False, "message": str(message)})
    status = AutomationRun.Status.FAILED if failed else AutomationRun.Status.SUCCESS
    return _record(automation, issue, event, status, details, started)


def _record(automation, issue, event, status, details, started):
    run_row = AutomationRun.objects.create(
        automation=automation,
        issue=issue,
        project_id=automation.project_id,
        workspace_id=automation.workspace_id,
        event=event,
        status=status,
        details=details,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
    Automation.objects.filter(pk=automation.pk).update(
        last_run_at=run_row.created_at, last_run_status=status, run_count=F("run_count") + 1
    )
    automation.run_count += 1
    return run_row


# ---------------------------------------------------------------------------
# Dispatch


def events_from_activities(activity_type, activities):
    """Automation events raised by one batch of work item activity."""
    if activity_type == "issue.activity.created":
        return ["work_item_created"]
    if activity_type == "comment.activity.created":
        return ["comment_added"]
    if activity_type != "issue.activity.updated":
        return []
    return sorted({FIELD_EVENTS[a.field] for a in activities if a.field in FIELD_EVENTS})


def has_automations(project_id, events):
    return Automation.objects.filter(
        project_id=project_id, is_enabled=True, trigger__type__in=list(events), deleted_at__isnull=True
    ).exists()


def dispatch(issue_id, events, actor_id=None, property_ids=None):
    """Run the project's enabled automations whose trigger is one of ``events``."""
    if is_bot(actor_id):
        return []
    issue = Issue.issue_objects.filter(pk=issue_id).select_related("state", "project", "workspace").first()
    if issue is None:
        return []
    automations = Automation.objects.filter(project_id=issue.project_id, is_enabled=True, trigger__type__in=events)
    facts = _Facts(issue)
    runs = []
    for automation in automations:
        trigger = automation.trigger
        if trigger["type"] == "property_changed" and trigger.get("property_id"):
            if trigger["property_id"] not in (property_ids or []):
                continue
        if matches(automation, facts):
            runs.append(run(automation, issue, trigger["type"], facts))
            issue.refresh_from_db()
            facts = _Facts(issue)
    return runs


def queue(issue, events, actor_id, property_ids=None):
    """Hand the events to the worker when an enabled automation listens for them."""
    if not events or is_bot(actor_id) or not has_automations(issue.project_id, events):
        return
    from plane.bgtasks.automation_task import dispatch_automations

    transaction.on_commit(
        lambda: dispatch_automations.delay(
            str(issue.id), list(events), str(actor_id) if actor_id else None, property_ids or []
        )
    )


# ---------------------------------------------------------------------------
# Schedules


def last_occurrence(trigger, now):
    """The latest scheduled time at or before ``now`` (aware, UTC)."""
    tz = ZoneInfo(trigger.get("timezone") or "UTC")
    local_now = now.astimezone(tz)
    hour, minute = (int(x) for x in trigger["time"].split(":"))
    for back in range(0, 62):
        day = (local_now - timedelta(days=back)).date()
        candidate = datetime(day.year, day.month, day.day, hour, minute, tzinfo=tz)
        if candidate > local_now:
            continue
        frequency = trigger["frequency"]
        if frequency == "weekly" and day.weekday() not in trigger.get("days", []):
            continue
        if frequency == "monthly":
            # months without that day run on their last day
            last_day = (day.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
            if day.day != min(trigger.get("day", 1), last_day.day):
                continue
        return candidate.astimezone(ZoneInfo("UTC"))
    return None


def run_due_schedules(now=None):
    now = now or timezone.now()
    count = 0
    for automation in Automation.objects.filter(is_enabled=True, trigger__type="schedule"):
        due = last_occurrence(automation.trigger, now)
        if due is None or due <= (automation.schedule_cursor or automation.created_at):
            continue
        Automation.objects.filter(pk=automation.pk).update(schedule_cursor=due)
        run_schedule(automation, now)
        count += 1
    return count


def run_schedule(automation, now=None):
    now = now or timezone.now()
    started = time.monotonic()
    candidates = (
        Issue.issue_objects.filter(project_id=automation.project_id)
        # schedules look at open work items only
        .exclude(state__group__in=("completed", "cancelled"))
        .select_related("state", "project", "workspace")
        .order_by("created_at")
    )
    matched = 0
    for issue in candidates.iterator(chunk_size=200):
        facts = _Facts(issue)
        if not matches(automation, facts, now):
            continue
        run(automation, issue, "schedule", facts)
        matched += 1
        if matched >= MAX_SCHEDULED_ITEMS:
            break
    if matched == 0:
        _record(
            automation,
            None,
            "schedule",
            AutomationRun.Status.SKIPPED,
            [{"action": None, "ok": True, "message": "No work items matched."}],
            started,
        )
    return matched
