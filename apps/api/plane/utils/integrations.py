# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""GitLab and Sentry webhooks for a project.

GitLab: merge requests and commits that mention a work item (``NOC-12``) are linked
to it, and merge request events can move it to a mapped state.
Sentry: a new Sentry issue becomes a work item; resolving it in Sentry moves the work
item on, and a regression brings it back.
"""

import hashlib
import hmac
import json
import re
import secrets
import time
from html import escape

from django.db import transaction
from django.utils import timezone

from plane.db.models import (
    IntegrationLink,
    Issue,
    IssueAssignee,
    IssueComment,
    IssueLabel,
    IssueLink,
    Label,
    ProjectIntegration,
    ProjectMember,
    State,
)
from plane.utils import work_item_types
from plane.utils.bots import get_bot

PROVIDERS = ("gitlab", "sentry")
SENTRY_LEVELS = ("fatal", "error", "warning", "info", "debug")
PRIORITIES = ("urgent", "high", "medium", "low", "none")
MAX_COMMITS = 20
MR_ACTION_STATES = {"open": "mr_opened", "reopen": "mr_opened", "merge": "mr_merged", "close": "mr_closed"}
MR_ACTION_WORDS = {"open": "opened", "reopen": "reopened", "merge": "merged", "close": "closed"}

DEFAULT_CONFIG = {
    "gitlab": {"post_comments": True, "states": {"mr_opened": None, "mr_merged": None, "mr_closed": None}},
    "sentry": {
        "issue_type_id": None,
        "state_id": None,
        "resolved_state_id": None,
        "reopened_state_id": None,
        "priorities": {"fatal": "urgent", "error": "high", "warning": "medium", "info": "low", "debug": "low"},
        "assignee_ids": [],
        "label_ids": [],
    },
}
BOTS = {"gitlab": ("GITLAB", "GitLab"), "sentry": ("SENTRY", "Sentry")}


class IntegrationError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


# ---------------------------------------------------------------------------
# Settings


def get_or_create(project, provider, user):
    integration = ProjectIntegration.objects.filter(project=project, provider=provider).first()
    if integration:
        return integration
    return ProjectIntegration.objects.create(
        project=project,
        workspace_id=project.workspace_id,
        provider=provider,
        secret=secrets.token_urlsafe(32) if provider == "gitlab" else "",
        config=json.loads(json.dumps(DEFAULT_CONFIG[provider])),
        created_by=user,
    )


def serialize(integration):
    data = {
        "id": str(integration.id),
        "provider": integration.provider,
        "is_enabled": integration.is_enabled,
        "webhook_path": f"/api/integrations/{integration.provider}/{integration.anchor}/",
        "config": {**DEFAULT_CONFIG[integration.provider], **(integration.config or {})},
        "last_event_at": integration.last_event_at,
        "last_event": integration.last_event or None,
    }
    if integration.provider == "gitlab":
        data["secret"] = integration.secret
    else:
        # the Sentry client secret is only ever written
        data["has_secret"] = bool(integration.secret)
    return data


def _ids(project_id, model, values, label, **filters):
    if values in (None, ""):
        return None
    allowed = {str(i) for i in model.objects.filter(project_id=project_id, **filters).values_list("id", flat=True)}
    many = isinstance(values, list)
    ids = [str(v) for v in (values if many else [values])]
    unknown = [v for v in ids if v not in allowed]
    if unknown:
        raise IntegrationError(f"Unknown {label}.")
    return ids if many else ids[0]


def update(integration, user, data):
    project_id = integration.project_id
    config = {**DEFAULT_CONFIG[integration.provider], **(integration.config or {})}
    incoming = data.get("config") or {}
    if not isinstance(incoming, dict):
        raise IntegrationError("Settings must be an object.")
    if integration.provider == "gitlab":
        if "post_comments" in incoming:
            config["post_comments"] = bool(incoming["post_comments"])
        if "states" in incoming:
            states = incoming["states"] or {}
            config["states"] = {
                key: _ids(project_id, State, states.get(key), "state") for key in DEFAULT_CONFIG["gitlab"]["states"]
            }
        if data.get("rotate_secret"):
            integration.secret = secrets.token_urlsafe(32)
    else:
        for key in ("state_id", "resolved_state_id", "reopened_state_id"):
            if key in incoming:
                config[key] = _ids(project_id, State, incoming[key], "state")
        if "issue_type_id" in incoming:
            allowed = {str(t.id) for t in work_item_types.project_issue_types(project_id)}
            value = incoming["issue_type_id"]
            if value and str(value) not in allowed:
                raise IntegrationError("Unknown work item type.")
            config["issue_type_id"] = str(value) if value else None
        if "assignee_ids" in incoming:
            members = {
                str(m)
                for m in ProjectMember.objects.filter(project_id=project_id, is_active=True, role__gte=15).values_list(
                    "member_id", flat=True
                )
            }
            ids = [str(v) for v in incoming["assignee_ids"] or []]
            if any(v not in members for v in ids):
                raise IntegrationError("Unknown member.")
            config["assignee_ids"] = ids
        if "label_ids" in incoming:
            config["label_ids"] = _ids(project_id, Label, incoming["label_ids"] or [], "label") or []
        if "priorities" in incoming:
            priorities = incoming["priorities"] or {}
            config["priorities"] = {
                level: priorities.get(level) if priorities.get(level) in PRIORITIES else config["priorities"][level]
                for level in SENTRY_LEVELS
            }
        if "secret" in data:
            integration.secret = str(data["secret"] or "").strip()
    if "is_enabled" in data:
        integration.is_enabled = bool(data["is_enabled"])
    integration.config = config
    integration.updated_by = user
    integration.save()
    return integration


# ---------------------------------------------------------------------------
# Work item helpers


def _log(issue, bot, activity_type, requested, current=None):
    from plane.bgtasks.issue_activities_task import issue_activity

    transaction.on_commit(
        lambda: issue_activity.delay(
            type=activity_type,
            requested_data=json.dumps(requested),
            current_instance=json.dumps(current) if current is not None else None,
            issue_id=str(issue.id),
            actor_id=str(bot.id),
            project_id=str(issue.project_id),
            epoch=int(time.time()),
            notification=True,
        )
    )


def _move(issue, state_id, bot):
    if not state_id or str(issue.state_id) == str(state_id):
        return False
    state = State.objects.filter(project_id=issue.project_id, pk=state_id).first()
    if state is None:
        return False
    old = str(issue.state_id) if issue.state_id else None
    issue.state = state
    issue.updated_by = bot
    issue.save()
    _log(issue, bot, "issue.activity.updated", {"state_id": str(state.id)}, {"state_id": old})
    return True


def _comment(issue, bot, html):
    comment = IssueComment.objects.create(
        issue=issue,
        project_id=issue.project_id,
        workspace_id=issue.workspace_id,
        comment_html=html,
        actor=bot,
        created_by=bot,
        updated_by=bot,
    )
    _log(issue, bot, "comment.activity.created", {"comment_html": html, "id": str(comment.id)})


def _link(integration, issue, bot, key, url, title):
    """Tie the work item to the outside object once, and show it under the work item's links."""
    IntegrationLink.objects.get_or_create(
        integration=integration,
        issue=issue,
        external_key=key,
        defaults={
            "project_id": issue.project_id,
            "workspace_id": issue.workspace_id,
            "url": url,
            "title": title[:255],
        },
    )
    if url and not IssueLink.objects.filter(issue=issue, url=url).exists():
        link = IssueLink.objects.create(
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            url=url,
            title=title[:255],
            metadata={"source": integration.provider},
            created_by=bot,
            updated_by=bot,
        )
        _log(issue, bot, "link.activity.created", {"url": url, "id": str(link.id)})


# ---------------------------------------------------------------------------
# GitLab


def mentioned_items(project, texts):
    """Work items of the project mentioned as IDENT-123 in any of the texts."""
    pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(project.identifier)}-(\d+)(?!\d)", re.IGNORECASE)
    numbers = {int(n) for text in texts if text for n in pattern.findall(text)}
    if not numbers:
        return []
    return list(
        Issue.issue_objects.filter(project_id=project.id, sequence_id__in=numbers).select_related("state", "project")
    )


def handle_gitlab(integration, headers, body):
    token = headers.get("X-Gitlab-Token", "")
    if not integration.secret or not hmac.compare_digest(token, integration.secret):
        raise IntegrationError("The secret token does not match.", status=401)
    event = headers.get("X-Gitlab-Event", "")
    project = integration.project
    bot = get_bot(*BOTS["gitlab"])
    config = {**DEFAULT_CONFIG["gitlab"], **(integration.config or {})}
    touched = set()

    if event == "Merge Request Hook":
        attrs = body.get("object_attributes") or {}
        action = attrs.get("action")
        iid = attrs.get("iid")
        title = attrs.get("title") or ""
        repo = (body.get("project") or {}).get("path_with_namespace", "")
        user = (body.get("user") or {}).get("name") or "Someone"
        url = attrs.get("url") or ""
        items = mentioned_items(project, [title, attrs.get("description"), attrs.get("source_branch")])
        for issue in items:
            _link(integration, issue, bot, f"gitlab_mr:{repo}!{iid}", url, f"!{iid} {title}")
            touched.add(issue.id)
            state_key = MR_ACTION_STATES.get(action)
            if state_key:
                _move(issue, (config.get("states") or {}).get(state_key), bot)
            if config.get("post_comments") and action in MR_ACTION_WORDS:
                _comment(
                    issue,
                    bot,
                    f'<p>Merge request <a href="{escape(url)}">!{iid} {escape(title)}</a> '
                    f"was {MR_ACTION_WORDS[action]} by {escape(user)}.</p>",
                )
        return {"event": f"merge request {action or 'event'}", "work_items": len(touched)}

    if event == "Push Hook":
        for commit in (body.get("commits") or [])[:MAX_COMMITS]:
            message = commit.get("message") or ""
            first_line = message.strip().splitlines()[0] if message.strip() else ""
            sha = (commit.get("id") or "")[:8]
            for issue in mentioned_items(project, [message]):
                _link(
                    integration,
                    issue,
                    bot,
                    f"gitlab_commit:{commit.get('id')}",
                    commit.get("url") or "",
                    f"{sha} {first_line}",
                )
                touched.add(issue.id)
        return {"event": "push", "work_items": len(touched)}

    return {"event": event or "unknown", "work_items": 0}


# ---------------------------------------------------------------------------
# Sentry


def _check_sentry_signature(integration, headers, raw):
    if not integration.secret:
        # without a client secret the unguessable URL is the only check (legacy WebHooks plugin)
        return
    expected = hmac.new(integration.secret.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(headers.get("Sentry-Hook-Signature", ""), expected):
        raise IntegrationError("The signature does not match the client secret.", status=401)


def _sentry_issue(headers, body):
    """(action, issue fields) from an integration webhook, an alert rule, or the legacy plugin."""
    resource = headers.get("Sentry-Hook-Resource", "")
    data = body.get("data") or {}
    if resource == "issue":
        issue = data.get("issue") or {}
        return body.get("action"), {
            "id": str(issue.get("id") or ""),
            "title": issue.get("title") or "",
            "culprit": issue.get("culprit") or "",
            "level": issue.get("level") or "error",
            "url": issue.get("web_url") or issue.get("permalink") or "",
            "short_id": issue.get("shortId") or "",
        }
    if resource == "event_alert":
        event = data.get("event") or {}
        return "created", {
            "id": str(event.get("issue_id") or ""),
            "title": event.get("title") or "",
            "culprit": event.get("culprit") or "",
            "level": event.get("level") or "error",
            "url": event.get("web_url") or "",
            "short_id": "",
        }
    if not resource and body.get("id") and body.get("url"):
        return "created", {
            "id": str(body.get("id")),
            "title": body.get("message") or (body.get("event") or {}).get("title") or "",
            "culprit": body.get("culprit") or "",
            "level": body.get("level") or "error",
            "url": body.get("url") or "",
            "short_id": "",
        }
    return resource or "unknown", None


def handle_sentry(integration, headers, raw, body):
    _check_sentry_signature(integration, headers, raw)
    action, data = _sentry_issue(headers, body)
    if not data or not data["id"]:
        return {"event": action, "work_items": 0}
    key = f"sentry_issue:{data['id']}"
    config = {**DEFAULT_CONFIG["sentry"], **(integration.config or {})}
    bot = get_bot(*BOTS["sentry"])
    linked = list(
        Issue.issue_objects.filter(
            integration_links__integration=integration, integration_links__external_key=key
        ).select_related("state", "project")
    )

    if action == "created":
        if linked:
            # the alert fired again: bring back a closed work item
            for issue in linked:
                if issue.state.group in ("completed", "cancelled") and _move(
                    issue, config.get("reopened_state_id"), bot
                ):
                    _comment(issue, bot, "<p>Sentry reported this error again.</p>")
            return {"event": "sentry issue seen again", "work_items": len(linked)}
        issue = _create_from_sentry(integration, config, bot, data, key)
        return {"event": "sentry issue created", "work_items": 1, "work_item_id": str(issue.id)}

    if action == "resolved":
        for issue in linked:
            if _move(issue, config.get("resolved_state_id"), bot):
                _comment(issue, bot, "<p>Resolved in Sentry.</p>")
        return {"event": "sentry issue resolved", "work_items": len(linked)}

    if action in ("unresolved", "regression"):
        for issue in linked:
            if _move(issue, config.get("reopened_state_id"), bot):
                _comment(issue, bot, "<p>Sentry marked this error as unresolved again.</p>")
        return {"event": "sentry issue reopened", "work_items": len(linked)}

    return {"event": f"sentry issue {action}", "work_items": 0}


def _create_from_sentry(integration, config, bot, data, key):
    project = integration.project
    priority = (config.get("priorities") or {}).get(data["level"], "high")
    state = (
        State.objects.filter(project_id=project.id, pk=config.get("state_id")).first()
        if config.get("state_id")
        else None
    )
    description = "".join(
        [
            f"<p><strong>{escape(data['short_id'] or 'Sentry issue')}</strong> · level {escape(data['level'])}</p>",
            f"<p><code>{escape(data['culprit'])}</code></p>" if data["culprit"] else "",
            f'<p><a href="{escape(data["url"])}">Open in Sentry</a></p>' if data["url"] else "",
        ]
    )
    issue = Issue.objects.create(
        name=f"[Sentry] {data['title']}"[:255],
        description_html=description,
        priority=priority if priority in PRIORITIES else "high",
        project=project,
        workspace_id=project.workspace_id,
        state=state,
        type_id=config.get("issue_type_id") or getattr(work_item_types.default_issue_type(project.id), "id", None),
        created_by=bot,
        updated_by=bot,
    )
    Issue.objects.filter(pk=issue.pk).update(created_by=bot)
    for member_id in config.get("assignee_ids") or []:
        IssueAssignee.objects.create(
            issue=issue, assignee_id=member_id, project_id=project.id, workspace_id=project.workspace_id
        )
    for label_id in config.get("label_ids") or []:
        IssueLabel.objects.create(
            issue=issue, label_id=label_id, project_id=project.id, workspace_id=project.workspace_id
        )
    _log(issue, bot, "issue.activity.created", {"name": issue.name})
    _link(integration, issue, bot, key, data["url"], data["short_id"] or "Sentry issue")
    return issue


# ---------------------------------------------------------------------------


def receive(integration, headers, raw):
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        raise IntegrationError("The body is not JSON.")
    if not isinstance(body, dict):
        raise IntegrationError("The body is not a JSON object.")
    with transaction.atomic():
        if integration.provider == "gitlab":
            result = handle_gitlab(integration, headers, body)
        else:
            result = handle_sentry(integration, headers, raw, body)
        ProjectIntegration.objects.filter(pk=integration.pk).update(
            last_event_at=timezone.now(), last_event=str(result.get("event", ""))[:255]
        )
    return result
