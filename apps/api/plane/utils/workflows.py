# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Workflows: which state a work item may move to next, who may move it, and
what must be filled in before it enters a state."""

from plane.db.models import (
    Issue,
    IssueAssignee,
    IssueProperty,
    ProjectMember,
    ProjectWorkflow,
    State,
)
from plane.utils.work_item_types import issue_property_values, type_uses_property

# Built-in fields a state can require besides custom properties.
BUILTIN_REQUIREMENTS = {
    "assignees": "Assignees",
    "target_date": "Due date",
    "estimate_point": "Estimate",
}


class WorkflowError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def get_workflow(project_id):
    return ProjectWorkflow.objects.filter(project_id=project_id).first()


def serialize_workflow(workflow, project_id, user):
    return {
        "project_id": str(project_id),
        "is_enabled": bool(workflow and workflow.is_enabled),
        "rules": (workflow.rules if workflow else {}) or {},
        "viewer": viewer_rules(workflow, user),
    }


def _id_list(value, allowed, label):
    """None means "no restriction"; otherwise every id must be one of ``allowed``."""
    if value is None:
        return None
    if not isinstance(value, list):
        raise WorkflowError(f"{label} must be a list or null.")
    ids = [str(v) for v in value]
    unknown = [v for v in ids if v not in allowed]
    if unknown:
        raise WorkflowError(f"Unknown {label.lower()}: {', '.join(unknown)}")
    return list(dict.fromkeys(ids))


def update_workflow(project, user, data):
    workflow = get_workflow(project.id)
    if workflow is None:
        workflow = ProjectWorkflow(project=project, workspace_id=project.workspace_id, created_by=user)

    if "is_enabled" in data:
        workflow.is_enabled = bool(data["is_enabled"])

    if "rules" in data:
        rules = data["rules"]
        if not isinstance(rules, dict):
            raise WorkflowError("Rules must be an object keyed by state id.")
        state_ids = {str(s) for s in State.objects.filter(project_id=project.id).values_list("id", flat=True)}
        member_ids = {
            str(m)
            for m in ProjectMember.objects.filter(project_id=project.id, is_active=True).values_list(
                "member_id", flat=True
            )
        }
        requirable = set(BUILTIN_REQUIREMENTS) | {
            str(p) for p in IssueProperty.objects.filter(project_id=project.id).values_list("id", flat=True)
        }
        default_id = str(
            State.objects.filter(project_id=project.id, default=True).values_list("id", flat=True).first() or ""
        )
        clean = {}
        for state_id, rule in rules.items():
            state_id = str(state_id)
            if state_id not in state_ids:
                raise WorkflowError(f"Unknown state: {state_id}")
            if not isinstance(rule, dict):
                raise WorkflowError("Each state's rule must be an object.")
            transitions = rule.get("transitions") or {}
            if not isinstance(transitions, dict):
                raise WorkflowError("Transitions must be an object keyed by the state moved to.")
            clean_transitions = {}
            for to_id, transition in transitions.items():
                to_id = str(to_id)
                if to_id not in state_ids or to_id == state_id:
                    raise WorkflowError(f"Unknown state: {to_id}")
                movers = (transition or {}).get("movers") or []
                clean_transitions[to_id] = {"movers": _id_list(movers, member_ids, "Members")}
            clean[state_id] = {
                # everyone may always create work items in the default state
                "allow_creation": state_id == default_id or bool(rule.get("allow_creation", True)),
                "transitions": clean_transitions,
                "require": _id_list(rule.get("require") or [], requirable, "Requirements"),
            }
        workflow.rules = clean

    workflow.updated_by = user
    workflow.save()
    return workflow


def _is_filled(issue, key, attrs):
    if key == "assignees":
        if "assignee_ids" in attrs:
            return bool(list(attrs["assignee_ids"] or []))
        return IssueAssignee.objects.filter(issue=issue).exists()
    if key == "target_date":
        return bool(attrs["target_date"] if "target_date" in attrs else issue.target_date)
    if key == "estimate_point":
        return bool(attrs["estimate_point"] if "estimate_point" in attrs else issue.estimate_point_id)
    return None


def missing_requirements(issue, require, attrs=None):
    """Display names of the required fields and properties the work item has not filled."""
    attrs = attrs or {}
    missing = []
    values = None
    names = {}
    property_ids = [k for k in require if k not in BUILTIN_REQUIREMENTS]
    if property_ids:
        names = {
            str(p.id): p.display_name
            for p in IssueProperty.objects.filter(id__in=property_ids, project_id=issue.project_id, is_active=True)
        }
    for key in require:
        if key in BUILTIN_REQUIREMENTS:
            if not _is_filled(issue, key, attrs):
                missing.append(BUILTIN_REQUIREMENTS[key])
            continue
        # a property only applies to the types it is linked to
        if key not in names or not issue.type_id or not type_uses_property(issue.type_id, key):
            continue
        if values is None:
            values = issue_property_values(issue)
        if not values.get(key):
            missing.append(names[key])
    return missing


def _join(names):
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def check_transition(issue: Issue, new_state, user, attrs=None):
    """Raise WorkflowError when moving ``issue`` into ``new_state`` breaks the project's workflow."""
    if new_state is None or issue.state_id == new_state.id:
        return
    workflow = get_workflow(issue.project_id)
    if workflow is None or not workflow.is_enabled:
        return
    rules = workflow.rules or {}
    current = rules.get(str(issue.state_id)) or {}
    target = str(new_state.id)

    # a state without permitted changes lets work items move anywhere
    transitions = current.get("transitions") or {}
    if transitions:
        current_name = issue.state.name if issue.state_id else "No state"
        transition = transitions.get(target)
        if transition is None:
            raise WorkflowError(f"Work items in {current_name} cannot move to {new_state.name}.")
        movers = transition.get("movers") or []
        if movers and (user is None or str(user.id) not in movers):
            raise WorkflowError(
                f"Only the listed reviewers can move work items from {current_name} to {new_state.name}."
            )

    require = (rules.get(target) or {}).get("require") or []
    if require:
        missing = missing_requirements(issue, require, attrs)
        if missing:
            raise WorkflowError(f"Fill in {_join(missing)} before moving to {new_state.name}.")


def check_creation(project_id, state):
    """Raise WorkflowError when the workflow does not allow new work items in ``state``."""
    if state is None:
        return
    workflow = get_workflow(project_id)
    if workflow is None or not workflow.is_enabled:
        return
    rule = (workflow.rules or {}).get(str(state.id)) or {}
    if rule.get("allow_creation", True) is False and not state.default:
        raise WorkflowError(f"New work items cannot be created in {state.name}.")


def viewer_rules(workflow, user):
    """For the UI, given the viewer: which states each state may move to (null = any) and
    the states new work items cannot start in. None when the workflow is off."""
    if workflow is None or not workflow.is_enabled:
        return None
    moves, creation_blocked = {}, []
    for state_id, rule in (workflow.rules or {}).items():
        transitions = rule.get("transitions") or {}
        if transitions:
            moves[state_id] = [
                to_id
                for to_id, transition in transitions.items()
                if not transition.get("movers") or str(user.id) in transition["movers"]
            ]
        if rule.get("allow_creation", True) is False:
            creation_blocked.append(state_id)
    return {"moves": moves, "creation_blocked": creation_blocked}


def validate_state_change(instance, attrs, assignees_key="assignee_ids"):
    """Serializer hook: raise a DRF ValidationError when an update breaks the workflow."""
    from crum import get_current_user
    from rest_framework import serializers

    if attrs.get("state") is None:
        return
    pending = dict(attrs)
    if assignees_key in attrs:
        pending["assignee_ids"] = attrs[assignees_key]
    try:
        if instance is None:
            check_creation(attrs["state"].project_id, attrs["state"])
        else:
            check_transition(instance, attrs["state"], get_current_user(), pending)
    except WorkflowError as e:
        raise serializers.ValidationError({"state_id": e.message, "error": e.message})
