# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Turn a group of labels (e.g. "Reporter: Triska" under "Reporter") into a dropdown custom property.

Each child label becomes an option (named without the "Parent: " prefix) and work items get the
option of the labels they carry. Values already set are kept; with several labels on a single-value
property the first one by name wins. Optionally the labels are taken off the work items afterwards.
"""

# Django imports
from django.db import transaction

# Module imports
from plane.db.models import (
    Issue,
    IssueLabel,
    IssuePropertyOption,
    IssuePropertyType,
    IssuePropertyValue,
    Label,
)
from plane.utils import work_item_types as wit


class LabelConversionError(Exception):
    def __init__(self, errors):
        super().__init__("Invalid label conversion")
        self.errors = errors


def label_groups(project_id):
    """Parent labels of the project that have child labels, with how many work items use them."""
    groups = []
    for parent in Label.objects.filter(project_id=project_id, parent__isnull=True).order_by("name"):
        children = Label.objects.filter(project_id=project_id, parent=parent)
        if not children.exists():
            continue
        uses = IssueLabel.objects.filter(label__in=children, issue__in=Issue.issue_objects.all()).count()
        groups.append({"id": str(parent.id), "name": parent.name, "labels": children.count(), "uses": uses})
    return groups


def _option_name(label, parent):
    """ "Reporter: Triska" under "Reporter" -> "Triska"."""
    name = label.name.strip()
    for separator in (":", " -", "/"):
        prefix = f"{parent.name}{separator}"
        if name.lower().startswith(prefix.lower()):
            return name[len(prefix) :].strip() or name
    return name


def convert(project_id, user, data, dry_run=True):
    parent = Label.objects.filter(project_id=project_id, id=data.get("label_id"), parent__isnull=True).first()
    if parent is None:
        raise LabelConversionError({"label_id": "Pick a label group of this project."})
    children = list(Label.objects.filter(project_id=project_id, parent=parent).order_by("name"))
    if not children:
        raise LabelConversionError({"label_id": "This label has no labels under it."})
    names = {child.id: _option_name(child, parent) for child in children}

    # work item -> option names it should get
    wanted = {}
    links = IssueLabel.objects.filter(label__in=children, issue__in=Issue.issue_objects.filter(project_id=project_id))
    for issue_id, label_id in links.values_list("issue_id", "label_id"):
        wanted.setdefault(issue_id, set()).add(names[label_id])

    prop = None
    if data.get("property_id"):
        prop = wit.project_properties(project_id).filter(id=data["property_id"]).first()
        if prop is None or prop.property_type != IssuePropertyType.OPTION:
            raise LabelConversionError({"property_id": "Pick a dropdown property of this project."})
        is_multi = prop.is_multi
        type_ids = wit.property_type_ids(prop)
    else:
        name = (data.get("name") or parent.name).strip()
        if wit._name_taken(project_id, name):
            raise LabelConversionError({"name": "A property with this name already exists in this project."})
        is_multi = bool(data.get("is_multi")) or any(len(v) > 1 for v in wanted.values())
        types = wit.project_issue_types(project_id).filter(is_active=True)
        if data.get("type_ids"):
            types = types.filter(id__in=data["type_ids"])
        type_ids = [str(t) for t in types.values_list("id", flat=True)]
        if not type_ids:
            raise LabelConversionError({"type_ids": "Turn on work item types and pick at least one type."})

    # only work items whose type uses the property can hold its value
    issue_types = dict(Issue.issue_objects.filter(id__in=wanted.keys()).values_list("id", "type_id"))
    usable = {i: v for i, v in wanted.items() if str(issue_types.get(i)) in type_ids}
    already_set = set()
    if prop is not None:
        already_set = set(
            IssuePropertyValue.objects.filter(property=prop, issue_id__in=usable.keys()).values_list(
                "issue_id", flat=True
            )
        )
    conflicts = sum(1 for v in usable.values() if len(v) > 1) if not is_multi else 0
    summary = {
        "label_group": parent.name,
        "options": sorted(set(names.values()), key=str.lower),
        "work_items": len(usable),
        "conflicts": conflicts,
        "already_set": len(already_set),
        "other_types": len(wanted) - len(usable),
        "is_multi": is_multi,
    }
    if dry_run:
        return summary

    with transaction.atomic():
        if prop is None:
            prop = wit.create_property(
                project_id,
                None,
                user,
                {
                    "display_name": (data.get("name") or parent.name).strip(),
                    "property_type": IssuePropertyType.OPTION,
                    "is_multi": is_multi,
                    "options": [{"name": n} for n in summary["options"]],
                    "issue_type_ids": type_ids,
                },
            )
        else:
            existing = {o.name.lower() for o in prop.options.all()}
            last = len(existing)
            for index, option_name in enumerate(summary["options"]):
                if option_name.lower() not in existing:
                    IssuePropertyOption.objects.create(
                        property=prop,
                        project_id=prop.project_id,
                        name=option_name,
                        sort_order=(last + index + 1) * 10000,
                        created_by=user,
                        updated_by=user,
                    )
        option_ids = {o.name.lower(): o.id for o in IssuePropertyOption.objects.filter(property=prop)}
        issues = {i.id: i for i in Issue.issue_objects.filter(id__in=usable.keys())}
        rows = []
        for issue_id, option_names in usable.items():
            if issue_id in already_set or issue_id not in issues:
                continue
            chosen = sorted(option_names, key=str.lower)
            if not is_multi:
                chosen = chosen[:1]
            issue = issues[issue_id]
            rows += [
                IssuePropertyValue(
                    issue=issue,
                    property=prop,
                    project_id=issue.project_id,
                    workspace_id=issue.workspace_id,
                    value_option_id=option_ids[n.lower()],
                    created_by=user,
                    updated_by=user,
                )
                for n in chosen
            ]
        IssuePropertyValue.objects.bulk_create(rows, batch_size=500)
        if data.get("remove_labels"):
            IssueLabel.objects.filter(label__in=children, issue_id__in=usable.keys()).delete(soft=False)
    summary["property_id"] = str(prop.id)
    return summary
