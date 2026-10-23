# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public intake forms: anyone with the link files a work item into the project's Intake for triage."""

# Python imports
import html
import re

# Django imports
from django.db import transaction

# Module imports
from plane.db.models import (
    Intake,
    IntakeForm,
    IntakeIssue,
    Issue,
    IssuePropertyOption,
    IssuePropertyType,
    IssuePropertyValue,
    Project,
    State,
    StateGroup,
)
from plane.utils import work_item_types as wit

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_DESCRIPTION = 10000
# Property kinds a visitor can fill in (people, customers, files and relations need an account).
FORM_KINDS = (
    IssuePropertyType.TEXT,
    IssuePropertyType.PARAGRAPH,
    IssuePropertyType.NUMBER,
    IssuePropertyType.OPTION,
    IssuePropertyType.BOOLEAN,
    IssuePropertyType.DATE,
    IssuePropertyType.URL,
    IssuePropertyType.EMAIL,
    IssuePropertyType.CASCADING,
)


class IntakeFormError(Exception):
    def __init__(self, errors):
        super().__init__("Invalid intake form")
        self.errors = errors


def get_or_create_form(project: Project, user):
    form = IntakeForm.objects.filter(project=project).first()
    if form is None:
        form = IntakeForm.objects.create(project=project, title=project.name, created_by=user, updated_by=user)
    return form


def _form_type(form):
    return form.issue_type if form.issue_type_id else wit.default_issue_type(form.project_id)


def _form_properties(form):
    """The form's properties that still exist, are active and belong to the form's type, in order."""
    issue_type = _form_type(form)
    if issue_type is None:
        return []
    usable = {
        str(p.id): p for p in wit.type_properties(issue_type.id, active_only=True) if p.property_type in FORM_KINDS
    }
    return [usable[i] for i in form.property_ids or [] if i in usable]


def serialize_form(form):
    return {
        "id": str(form.id),
        "anchor": form.anchor,
        "is_enabled": form.is_enabled,
        "title": form.title,
        "description": form.description,
        "issue_type_id": str(form.issue_type_id) if form.issue_type_id else None,
        "property_ids": [str(p.id) for p in _form_properties(form)],
        "require_email": form.require_email,
        "success_message": form.success_message,
    }


def _ensure_intake(project):
    """Forms file into Intake, so turning a form on turns Intake on for the project."""
    if not project.intake_view:
        project.intake_view = True
        project.save(update_fields=["intake_view", "updated_at"])
    intake = Intake.objects.filter(project=project, is_default=True).first()
    return intake or Intake.objects.create(name=f"{project.name} Intake", project=project, is_default=True)


@transaction.atomic
def update_form(form, data, user):
    errors = {}
    if "issue_type_id" in data:
        type_id = data.get("issue_type_id")
        if type_id:
            issue_type = wit.project_issue_types(form.project_id).filter(id=type_id, is_active=True).first()
            if issue_type is None:
                errors["issue_type_id"] = "Pick an active work item type of this project."
            form.issue_type = issue_type
        else:
            form.issue_type = None
    if "property_ids" in data:
        ids = [str(i) for i in data.get("property_ids") or []]
        issue_type = _form_type(form)
        allowed = (
            {str(p.id) for p in wit.type_properties(issue_type.id, active_only=True) if p.property_type in FORM_KINDS}
            if issue_type
            else set()
        )
        if set(ids) - allowed:
            errors["property_ids"] = "Only properties of the form's work item type that visitors can fill in."
        form.property_ids = list(dict.fromkeys(ids))
    for key in ("title", "description", "success_message"):
        if key in data:
            setattr(form, key, str(data.get(key) or "").strip()[: 255 if key == "title" else 2000])
    if "require_email" in data:
        form.require_email = bool(data["require_email"])
    if "is_enabled" in data:
        form.is_enabled = bool(data["is_enabled"])
    if errors:
        raise IntakeFormError(errors)
    form.updated_by = user
    form.save()
    if form.is_enabled:
        _ensure_intake(form.project)
    return form


def public_form(form):
    project = form.project
    fields = []
    for prop in _form_properties(form):
        options = []
        if prop.property_type in (IssuePropertyType.OPTION, IssuePropertyType.CASCADING):
            for option in IssuePropertyOption.objects.filter(property=prop, is_active=True).order_by(
                "sort_order", "created_at"
            ):
                options.append(
                    {
                        "id": str(option.id),
                        "name": option.name,
                        "parent_id": str(option.parent_id) if option.parent_id else None,
                    }
                )
        fields.append(
            {
                "id": str(prop.id),
                "name": prop.display_name,
                "description": prop.description,
                "property_type": prop.property_type,
                "is_multi": prop.is_multi,
                "is_required": prop.is_required,
                "options": options,
            }
        )
    return {
        "title": form.title or project.name,
        "description": form.description,
        "require_email": form.require_email,
        "success_message": form.success_message,
        "project": {
            "name": project.name,
            "identifier": project.identifier,
            "logo_props": project.logo_props or {},
        },
        "workspace": {"name": project.workspace.name},
        "fields": fields,
    }


def _paragraphs(text):
    lines = [line for line in str(text).replace("\r\n", "\n").split("\n")]
    body = "".join(f"<p>{html.escape(line)}</p>" for line in lines if line.strip())
    return body or "<p></p>"


@transaction.atomic
def submit(form, data):
    """File one submission into Intake; returns the new work item."""
    errors = {}
    name = str(data.get("name") or "").strip()[:255]
    email = str(data.get("email") or "").strip().lower()[:255]
    title = str(data.get("title") or "").strip()
    description = str(data.get("description") or "").strip()
    if not name:
        errors["name"] = "Your name is required."
    if form.require_email and not email:
        errors["email"] = "Your email is required."
    if email and not EMAIL_PATTERN.match(email):
        errors["email"] = "Enter a valid email address."
    if not title:
        errors["title"] = "A title is required."
    elif len(title) > 255:
        errors["title"] = "The title is limited to 255 characters."
    if len(description) > MAX_DESCRIPTION:
        errors["description"] = f"The description is limited to {MAX_DESCRIPTION} characters."

    raw_values = data.get("values") or {}
    if not isinstance(raw_values, dict):
        raw_values = {}
    clean = {}
    for prop in _form_properties(form):
        raw = raw_values.get(str(prop.id))
        try:
            values = wit._normalise_values(prop, raw, str(prop.id), form.project_id, None)
        except wit.PropertyValueError as e:
            errors.update(e.errors)
            continue
        if prop.is_required and not values:
            errors[str(prop.id)] = f"{prop.display_name} is required."
        if values:
            clean[prop] = values
    if errors:
        raise IntakeFormError(errors)

    project = form.project
    intake = _ensure_intake(project)
    triage = State.triage_objects.filter(project=project).first() or State.objects.create(
        name="Triage",
        group=StateGroup.TRIAGE.value,
        project=project,
        workspace_id=project.workspace_id,
        color="#4E5355",
        sequence=65000,
        default=False,
    )
    sender = html.escape(f"{name} <{email}>" if email else name)
    issue_type = _form_type(form)
    issue = Issue.objects.create(
        name=title,
        description_html=_paragraphs(description) + f"<p><em>Submitted through the intake form by {sender}</em></p>",
        priority="none",
        project=project,
        state=triage,
        type=issue_type,
    )
    IntakeIssue.objects.create(
        intake=intake,
        project=project,
        issue=issue,
        source="FORM",
        source_email=email or None,
        extra={"name": name, "email": email, "form": form.anchor},
    )
    IssuePropertyValue.objects.bulk_create(
        [
            IssuePropertyValue(
                issue=issue,
                property=prop,
                project_id=project.id,
                workspace_id=project.workspace_id,
                **wit._row_fields(prop.property_type, text),
            )
            for prop, values in clean.items()
            for text in values
        ]
    )
    return issue
