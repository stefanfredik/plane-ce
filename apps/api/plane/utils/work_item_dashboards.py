# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Data behind work item dashboard widgets.

A widget's ``config``:

    project_ids        projects to include (empty = every project the viewer is in)
    filters            type_ids, state_groups, priorities, label_ids, assignee_ids,
                       property_option_ids (all lists), created_within_days (int)
    group_by           BAR / PIE / TABLE-less grouping, see GROUPERS + customproperty_<id>
    metric             "count" or "avg_resolution_days" (NUMBER, BAR, PIE)
    period             "week" or "month" (LINE), periods: how many to show
    limit, order_by    TABLE

Data is always computed for the person looking at the dashboard: only projects
they are an active member of, and only their own items in projects where they
are a guest without "view all" access. Sharing a dashboard shares its layout,
never data the viewer could not open anyway.
"""

# Python imports
import uuid
from datetime import timedelta

# Django imports
from django.db.models import Avg, Case, Count, DurationField, ExpressionWrapper, F, IntegerField, Q, Value, When
from django.db.models.functions import TruncMonth, TruncWeek
from django.utils import timezone

# Module imports
from plane.db.models import (
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    IssueProperty,
    IssuePropertyOption,
    IssuePropertyValue,
    IssueSla,
    ModuleIssue,
    Project,
    ProjectMember,
    SlaPolicy,
)

STATE_GROUP_ORDER = ["backlog", "unstarted", "started", "completed", "cancelled"]
STATE_GROUP_COLORS = {
    "backlog": "#a3a3a3",
    "unstarted": "#3f76ff",
    "started": "#f59e0b",
    "completed": "#16a34a",
    "cancelled": "#dc2626",
}
PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"]
PRIORITY_COLORS = {"urgent": "#991b1b", "high": "#ef4444", "medium": "#f59e0b", "low": "#16a34a", "none": "#a3a3a3"}
OPEN_GROUPS = ["backlog", "unstarted", "started"]
MAX_TABLE_ROWS = 50
MAX_PERIODS = 24
GROUPERS = {
    "state_group",
    "state",
    "priority",
    "assignee",
    "label",
    "module",
    "cycle",
    "project",
    "type",
    "created_by",
    "sla_status",
}
SLA_LABELS = {
    "breached": ("Breached", "#dc2626"),
    "at_risk": ("At risk", "#f59e0b"),
    "on_track": ("On track", "#16a34a"),
    "missed": ("Missed", "#9f1239"),
    "met": ("Met", "#0d9488"),
}
SLA_ROW_FIELDS = ("started_at", "response_due_at", "resolution_due_at", "responded_at", "resolved_at")
TABLE_ORDERS = {"-created_at", "created_at", "-updated_at", "priority", "-target_date", "target_date"}


class WidgetConfigError(ValueError):
    pass


def _uuid_list(values):
    out = []
    for value in values or []:
        try:
            out.append(uuid.UUID(str(value)))
        except ValueError:
            raise WidgetConfigError("Ids in a widget filter must be UUIDs.")
    return out


def visible_projects(workspace_id, user):
    return Project.objects.filter(
        workspace_id=workspace_id,
        archived_at__isnull=True,
        project_projectmember__member=user,
        project_projectmember__is_active=True,
    ).distinct()


def widget_issues(workspace_id, user, config):
    """Work items the viewer may see that match the widget's projects and filters."""
    projects = visible_projects(workspace_id, user)
    if config.get("project_ids"):
        projects = projects.filter(id__in=_uuid_list(config["project_ids"]))
    project_ids = list(projects.values_list("id", flat=True))

    # Guests without "view all" only see what they created.
    guest_only = set(
        ProjectMember.objects.filter(
            project_id__in=project_ids, member=user, role=5, is_active=True, project__guest_view_all_features=False
        ).values_list("project_id", flat=True)
    )
    issues = Issue.issue_objects.filter(project_id__in=project_ids)
    if guest_only:
        issues = issues.filter(~Q(project_id__in=guest_only) | Q(created_by=user))

    f = config.get("filters") or {}
    if f.get("type_ids"):
        issues = issues.filter(type_id__in=_uuid_list(f["type_ids"]))
    if f.get("state_groups"):
        issues = issues.filter(state__group__in=[g for g in f["state_groups"] if g in STATE_GROUP_ORDER])
    if f.get("priorities"):
        issues = issues.filter(priority__in=[p for p in f["priorities"] if p in PRIORITY_ORDER])
    if f.get("label_ids"):
        issues = issues.filter(
            id__in=IssueLabel.objects.filter(label_id__in=_uuid_list(f["label_ids"]), deleted_at__isnull=True).values(
                "issue_id"
            )
        )
    if f.get("assignee_ids"):
        issues = issues.filter(
            id__in=IssueAssignee.objects.filter(
                assignee_id__in=_uuid_list(f["assignee_ids"]), deleted_at__isnull=True
            ).values("issue_id")
        )
    if f.get("property_option_ids"):
        # Every listed option must hold: options of one property are OR-ed, properties AND-ed.
        options = IssuePropertyOption.objects.filter(id__in=_uuid_list(f["property_option_ids"]))
        by_property = {}
        for option in options:
            by_property.setdefault(option.property_id, []).append(option.id)
        for option_ids in by_property.values():
            issues = issues.filter(
                id__in=IssuePropertyValue.objects.filter(
                    Q(value_option_id__in=option_ids) | Q(value_option__parent_id__in=option_ids),
                    deleted_at__isnull=True,
                ).values("issue_id")
            )
    if f.get("created_within_days"):
        try:
            days = max(1, min(int(f["created_within_days"]), 3650))
        except (TypeError, ValueError):
            raise WidgetConfigError("created_within_days must be a number of days.")
        issues = issues.filter(created_at__gte=timezone.now() - timedelta(days=days))
    return issues


# ---------------------------------------------------------------------------
# metrics
# ---------------------------------------------------------------------------

_RESOLUTION = ExpressionWrapper(F("completed_at") - F("created_at"), output_field=DurationField())


def _metric_value(queryset, metric):
    if metric == "avg_resolution_days":
        duration = queryset.filter(completed_at__isnull=False).aggregate(value=Avg(_RESOLUTION))["value"]
        return round(duration.total_seconds() / 86400, 1) if duration else None
    return queryset.count()


def number_data(issues, config):
    metric = config.get("metric") or "count"
    return {"metric": metric, "value": _metric_value(issues, metric)}


# ---------------------------------------------------------------------------
# grouping
# ---------------------------------------------------------------------------


def _grouped(issues, key, label_fields, metric, order=None):
    """Rows of (key, labels..., value) for a values() grouping."""
    rows = issues.values(key, *label_fields)
    if metric == "avg_resolution_days":
        rows = rows.filter(completed_at__isnull=False).annotate(duration=Avg(_RESOLUTION))
    else:
        rows = rows.annotate(n=Count("id", distinct=True))
    out = []
    for row in rows.order_by(*(order or [key])):
        if metric == "avg_resolution_days":
            value = round(row["duration"].total_seconds() / 86400, 1) if row["duration"] else None
        else:
            value = row["n"]
        out.append((row, value))
    return out


def _through_grouping(issues, model, column, label_path, metric):
    """Group by an m2m-like table (assignees, labels, modules, cycles); items without one count as "None"."""
    ids = issues.values("id")
    links = model.objects.filter(issue_id__in=ids, deleted_at__isnull=True)
    items = []
    for row in links.values(column, label_path).distinct():
        group_issues = issues.filter(id__in=links.filter(**{column: row[column]}).values("issue_id"))
        items.append(
            {"key": str(row[column]), "label": row[label_path] or "—", "value": _metric_value(group_issues, metric)}
        )
    without = issues.exclude(id__in=links.values("issue_id"))
    if without.exists():
        items.append({"key": "None", "label": "None", "value": _metric_value(without, metric)})
    return sorted(items, key=lambda i: (i["key"] == "None", -(i["value"] or 0)))


def group_data(issues, config):
    group_by = config.get("group_by") or "state_group"
    metric = config.get("metric") or "count"
    items = []

    if str(group_by).startswith("customproperty_"):
        return _custom_property_groups(issues, group_by.replace("customproperty_", ""), metric)
    if group_by not in GROUPERS:
        raise WidgetConfigError("Unknown grouping.")

    if group_by == "state_group":
        rows = {row["state__group"]: value for row, value in _grouped(issues, "state__group", [], metric)}
        items = [
            {"key": g, "label": g.capitalize(), "value": rows[g], "color": STATE_GROUP_COLORS[g]}
            for g in STATE_GROUP_ORDER
            if g in rows
        ]
    elif group_by == "state":
        for row, value in _grouped(
            issues, "state_id", ["state__name", "state__color", "state__sequence"], metric, ["state__sequence"]
        ):
            items.append(
                {"key": str(row["state_id"]), "label": row["state__name"], "value": value, "color": row["state__color"]}
            )
    elif group_by == "priority":
        rows = {row["priority"]: value for row, value in _grouped(issues, "priority", [], metric)}
        items = [
            {"key": p, "label": p.capitalize(), "value": rows[p], "color": PRIORITY_COLORS[p]}
            for p in PRIORITY_ORDER
            if p in rows
        ]
    elif group_by == "project":
        for row, value in _grouped(issues, "project_id", ["project__name"], metric, ["project__name"]):
            items.append({"key": str(row["project_id"]), "label": row["project__name"], "value": value})
    elif group_by == "type":
        for row, value in _grouped(issues, "type_id", ["type__name", "type__logo_props"], metric, ["type__name"]):
            color = ((row["type__logo_props"] or {}).get("icon") or {}).get("color")
            items.append(
                {"key": str(row["type_id"]), "label": row["type__name"] or "None", "value": value, "color": color}
            )
    elif group_by == "created_by":
        for row, value in _grouped(
            issues, "created_by_id", ["created_by__display_name"], metric, ["created_by__display_name"]
        ):
            items.append(
                {"key": str(row["created_by_id"]), "label": row["created_by__display_name"] or "—", "value": value}
            )
    elif group_by == "assignee":
        items = _through_grouping(issues, IssueAssignee, "assignee_id", "assignee__display_name", metric)
    elif group_by == "label":
        items = _through_grouping(issues, IssueLabel, "label_id", "label__name", metric)
    elif group_by == "module":
        items = _through_grouping(issues, ModuleIssue, "module_id", "module__name", metric)
    elif group_by == "cycle":
        items = _through_grouping(issues, CycleIssue, "cycle_id", "cycle__name", metric)
    elif group_by == "sla_status":
        items = _sla_groups(issues, metric)
    return {"group_by": group_by, "metric": metric, "items": items}


def _sla_groups(issues, metric):
    """Work items by SLA status; items without an SLA count as "No SLA"."""
    from plane.utils import sla

    now = timezone.now()
    percents = dict(
        SlaPolicy.objects.filter(project_id__in=issues.values("project_id"), is_enabled=True).values_list(
            "project_id", "at_risk_percent"
        )
    )
    buckets = {}
    rows = IssueSla.objects.filter(issue_id__in=issues.values("id"), project_id__in=list(percents))
    for row in rows.only("issue_id", "project_id", *SLA_ROW_FIELDS):
        overall = sla.statuses(row, percents[row.project_id], now)[2]
        if overall:
            buckets.setdefault(overall, []).append(row.issue_id)
    items = [
        {
            "key": key,
            "label": SLA_LABELS[key][0],
            "value": _metric_value(issues.filter(id__in=buckets[key]), metric),
            "color": SLA_LABELS[key][1],
        }
        for key in sla.STATUS_ORDER
        if key in buckets
    ]
    without = issues.exclude(id__in=[issue_id for ids in buckets.values() for issue_id in ids])
    if without.exists():
        items.append({"key": "None", "label": "No SLA", "value": _metric_value(without, metric), "color": "#a3a3a3"})
    return items


def _custom_property_groups(issues, property_id, metric):
    try:
        prop = IssueProperty.objects.get(id=property_id, property_type__in=["OPTION", "CASCADING", "MEMBER", "BOOLEAN"])
    except (IssueProperty.DoesNotExist, ValueError):
        raise WidgetConfigError("Group by a dropdown, cascading, member or yes/no property.")
    values = IssuePropertyValue.objects.filter(property=prop, issue_id__in=issues.values("id"), deleted_at__isnull=True)
    items = []
    if prop.property_type in ("OPTION", "CASCADING"):
        options = IssuePropertyOption.objects.filter(property=prop, deleted_at__isnull=True).select_related("parent")
        for option in options.order_by("sort_order"):
            group = issues.filter(id__in=values.filter(value_option=option).values("issue_id"))
            if group.exists():
                label = f"{option.parent.name} › {option.name}" if option.parent else option.name
                items.append(
                    {
                        "key": str(option.id),
                        "label": label,
                        "value": _metric_value(group, metric),
                        "color": option.color or None,
                    }
                )
    elif prop.property_type == "MEMBER":
        for row in values.values("value_member_id", "value_member__display_name").distinct():
            group = issues.filter(id__in=values.filter(value_member_id=row["value_member_id"]).values("issue_id"))
            items.append(
                {
                    "key": str(row["value_member_id"]),
                    "label": row["value_member__display_name"],
                    "value": _metric_value(group, metric),
                }
            )
    else:
        yes = issues.filter(id__in=values.filter(value_boolean=True).values("issue_id"))
        no = issues.exclude(id__in=yes.values("id"))
        items = [
            {"key": "true", "label": "Yes", "value": _metric_value(yes, metric), "color": "#16a34a"},
            {"key": "false", "label": "No", "value": _metric_value(no, metric), "color": "#a3a3a3"},
        ]
        return {"group_by": f"customproperty_{prop.id}", "metric": metric, "items": items}
    without = issues.exclude(id__in=values.values("issue_id"))
    if without.exists():
        items.append({"key": "None", "label": "None", "value": _metric_value(without, metric), "color": "#d4d4d4"})
    return {"group_by": f"customproperty_{prop.id}", "metric": metric, "items": items}


# ---------------------------------------------------------------------------
# trend
# ---------------------------------------------------------------------------


def line_data(issues, config):
    """Created vs completed per week or month, oldest first, empty periods included."""
    period = "month" if config.get("period") == "month" else "week"
    try:
        count = max(2, min(int(config.get("periods") or 12), MAX_PERIODS))
    except (TypeError, ValueError):
        raise WidgetConfigError("periods must be a number.")
    trunc = TruncMonth if period == "month" else TruncWeek
    now = timezone.now()
    if period == "month":
        start = (now.replace(day=1) - timedelta(days=31 * (count - 1))).replace(day=1)
    else:
        start = now - timedelta(weeks=count - 1)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)

    created = {
        row["p"].date(): row["n"]
        for row in issues.filter(created_at__gte=start)
        .annotate(p=trunc("created_at"))
        .values("p")
        .annotate(n=Count("id"))
    }
    completed = {
        row["p"].date(): row["n"]
        for row in issues.filter(completed_at__gte=start)
        .annotate(p=trunc("completed_at"))
        .values("p")
        .annotate(n=Count("id"))
    }
    points = []
    day = start.date()
    if period == "week":
        day = day - timedelta(days=day.weekday())
    while day <= now.date():
        points.append({"period": day.isoformat(), "created": created.get(day, 0), "completed": completed.get(day, 0)})
        if period == "month":
            day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            day = day + timedelta(weeks=1)
    return {"period": period, "points": points[-count:]}


# ---------------------------------------------------------------------------
# table
# ---------------------------------------------------------------------------


def table_data(issues, config):
    order_by = config.get("order_by") if config.get("order_by") in TABLE_ORDERS else "-created_at"
    try:
        limit = max(1, min(int(config.get("limit") or 10), MAX_TABLE_ROWS))
    except (TypeError, ValueError):
        raise WidgetConfigError("limit must be a number.")
    if order_by == "priority":
        issues = issues.annotate(
            priority_rank=Case(
                *[When(priority=p, then=Value(i)) for i, p in enumerate(PRIORITY_ORDER)],
                output_field=IntegerField(),
            )
        ).order_by("priority_rank", "-created_at")
    else:
        issues = issues.order_by(order_by)
    rows = issues.select_related("project", "state", "type")[:limit]
    return {
        "rows": [
            {
                "id": str(i.id),
                "project_id": str(i.project_id),
                "identifier": f"{i.project.identifier}-{i.sequence_id}",
                "name": i.name,
                "priority": i.priority,
                "state_name": i.state.name if i.state else None,
                "state_group": i.state.group if i.state else None,
                "state_color": i.state.color if i.state else None,
                "type_name": i.type.name if i.type else None,
                "created_at": i.created_at.isoformat(),
                "target_date": i.target_date.isoformat() if i.target_date else None,
            }
            for i in rows
        ]
    }


def widget_data(widget, user):
    config = widget.config or {}
    issues = widget_issues(widget.workspace_id, user, config)
    kind = widget.widget_type
    if kind == "NUMBER":
        return number_data(issues, config)
    if kind in ("BAR", "PIE"):
        return group_data(issues, config)
    if kind == "LINE":
        return line_data(issues, config)
    if kind == "TABLE":
        return table_data(issues, config)
    raise WidgetConfigError("Unknown widget type.")
