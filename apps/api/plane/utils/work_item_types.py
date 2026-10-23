# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Work item types and their custom properties.

Shared by the web app API and the public v1 API so both validate and store
property values the same way.

Properties live in a per-project pool and are linked to the types that use
them (IssueTypeProperty), so one property can serve several types.

Values travel as a map of property id -> list of strings, whatever the type:
TEXT/PARAGRAPH/URL -> the text, NUMBER -> "12.5", BOOLEAN -> "true"/"false",
DATE -> "YYYY-MM-DD", OPTION -> option ids, MEMBER -> user ids. Single-value
properties carry at most one item; an empty list clears the property.
"""

# Python imports
import json
from collections import defaultdict
import re
import time
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

# Django imports
from django.db import transaction
from django.db.models import Count, Max, Q

# Module imports
from plane.utils import work_item_formula
from plane.utils.content_validator import validate_html_content
from plane.db.models import (
    FileAsset,
    Issue,
    IssueActivity,
    IssueProperty,
    IssuePropertyOption,
    IssuePropertyType,
    IssuePropertyValue,
    IssueType,
    IssueTypeProperty,
    MULTI_VALUE_PROPERTY_TYPES,
    Project,
    ProjectIssueType,
    ProjectMember,
)

DEFAULT_TYPE_NAME = "Task"
MAX_TEXT_LENGTH = 255
MAX_PARAGRAPH_LENGTH = 10000
MAX_RICH_TEXT_LENGTH = 50000
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
OPTION_TYPES = (IssuePropertyType.OPTION, IssuePropertyType.CASCADING)
TEXT_COLUMN_TYPES = (
    IssuePropertyType.TEXT,
    IssuePropertyType.PARAGRAPH,
    IssuePropertyType.URL,
    IssuePropertyType.EMAIL,
    IssuePropertyType.RICH_TEXT,
)


class PropertyValueError(Exception):
    def __init__(self, errors):
        super().__init__("Invalid property values")
        self.errors = errors


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


def project_issue_types(project_id):
    return IssueType.objects.filter(
        project_issue_types__project_id=project_id,
        project_issue_types__deleted_at__isnull=True,
    ).distinct()


def default_issue_type(project_id):
    return project_issue_types(project_id).filter(is_default=True).first()


@transaction.atomic
def enable_issue_types(project: Project, user):
    """Turn types on for a project: ensure a default type and put every untyped work item in it."""
    default = default_issue_type(project.id)
    if default is None:
        default = IssueType.objects.create(
            workspace_id=project.workspace_id,
            name=DEFAULT_TYPE_NAME,
            description="Default work item type",
            logo_props={"in_use": "icon", "icon": {"name": "Layers", "color": "#6b7280"}},
            is_default=True,
            created_by=user,
            updated_by=user,
        )
        ProjectIssueType.objects.create(
            project=project, issue_type=default, is_default=True, created_by=user, updated_by=user
        )
    Issue.all_objects.filter(project_id=project.id, type__isnull=True).update(type=default)
    if not project.is_issue_type_enabled:
        project.is_issue_type_enabled = True
        project.save(update_fields=["is_issue_type_enabled", "updated_at"])
    return default


@transaction.atomic
def create_issue_type(project: Project, user, data):
    issue_type = IssueType.objects.create(
        workspace_id=project.workspace_id,
        name=data["name"].strip(),
        description=data.get("description") or "",
        logo_props=data.get("logo_props") or {},
        is_active=data.get("is_active", True),
        is_default=False,
        created_by=user,
        updated_by=user,
    )
    ProjectIssueType.objects.create(project=project, issue_type=issue_type, created_by=user, updated_by=user)
    return issue_type


def type_project_ids(issue_type):
    return list(
        ProjectIssueType.objects.filter(issue_type=issue_type, deleted_at__isnull=True).values_list(
            "project_id", flat=True
        )
    )


@transaction.atomic
def delete_issue_type(project_id, issue_type: IssueType):
    """Take a non-default type out of a project.

    The project's work items fall back to its default type. Properties stay in the
    pool (other types may use them); values of properties the default type does
    not use are kept but no longer shown. A type shared with other projects stays
    for them; the last project to drop it deletes it for good.
    """
    default = default_issue_type(project_id)
    Issue.all_objects.filter(project_id=project_id, type=issue_type).update(type=default)
    ProjectIssueType.objects.filter(project_id=project_id, issue_type=issue_type).delete(soft=False)
    if type_project_ids(issue_type):
        return
    IssueTypeProperty.all_objects.filter(issue_type=issue_type).delete()
    issue_type.delete()


@transaction.atomic
def import_issue_types(project: Project, user, type_ids):
    """Share existing workspace types with a project (types stay one record, so properties are shared too)."""
    enable_issue_types(project, user)
    candidates = IssueType.objects.filter(
        workspace_id=project.workspace_id, id__in=type_ids, is_default=False, is_epic=False
    )
    already = set(project_issue_types(project.id).values_list("id", flat=True))
    taken = {name.lower() for name in project_issue_types(project.id).values_list("name", flat=True)}
    imported, skipped = [], []
    for issue_type in candidates:
        if issue_type.id in already:
            continue
        if issue_type.name.lower() in taken:
            skipped.append(issue_type.name)
            continue
        ProjectIssueType.objects.create(project=project, issue_type=issue_type, created_by=user, updated_by=user)
        imported.append(issue_type)
    return imported, skipped


def workspace_issue_types(workspace_id):
    """Every shareable type in the workspace with the projects that use it."""
    links = {}
    for type_id, project_id in ProjectIssueType.objects.filter(
        workspace_id=workspace_id, deleted_at__isnull=True
    ).values_list("issue_type_id", "project_id"):
        links.setdefault(type_id, []).append(str(project_id))
    types = IssueType.objects.filter(workspace_id=workspace_id, is_default=False, is_epic=False).order_by("name")
    return [
        {
            "id": str(t.id),
            "name": t.name,
            "description": t.description,
            "logo_props": t.logo_props or {},
            "is_active": t.is_active,
            "project_ids": links.get(t.id, []),
            "property_count": IssueTypeProperty.objects.filter(issue_type=t).count(),
        }
        for t in types
        if links.get(t.id)
    ]


def project_properties(project_id):
    """The project's property pool: properties made in the project plus those of types it shares."""
    linked = IssueTypeProperty.objects.filter(issue_type__in=project_issue_types(project_id)).values("property_id")
    return IssueProperty.objects.filter(Q(project_id=project_id) | Q(id__in=linked))


def type_properties(type_id, active_only=False):
    """Properties a type uses, in the type's order."""
    links = (
        IssueTypeProperty.objects.filter(issue_type_id=type_id, property__deleted_at__isnull=True)
        .select_related("property")
        .order_by("sort_order", "created_at")
    )
    props = [link.property for link in links]
    return [p for p in props if p.is_active] if active_only else props


def property_type_ids(prop):
    return [
        str(type_id)
        for type_id in IssueTypeProperty.objects.filter(property=prop).values_list("issue_type_id", flat=True)
    ]


def type_property(project_id, property_id):
    """A property of the project's pool."""
    return project_properties(project_id).filter(id=property_id).first()


def type_uses_property(type_id, property_id):
    return IssueTypeProperty.objects.filter(issue_type_id=type_id, property_id=property_id).exists()


def type_name_taken(project_id, name, exclude_id=None):
    qs = project_issue_types(project_id).filter(name__iexact=name.strip())
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.exists()


# ---------------------------------------------------------------------------
# Serialisation (plain dicts: the shapes are small and read-heavy)
# ---------------------------------------------------------------------------


def serialize_option(option: IssuePropertyOption):
    return {
        "id": str(option.id),
        "name": option.name,
        "description": option.description,
        "color": option.color,
        "parent_id": str(option.parent_id) if option.parent_id else None,
        "sort_order": option.sort_order,
        "is_default": option.is_default,
        "is_active": option.is_active,
    }


class _Batch:
    """Links, usage and options of many properties loaded at once (lists stay at a fixed number of queries)."""

    def __init__(self, type_ids=None, properties=None):
        self.by_type = defaultdict(list)
        if type_ids is not None:
            links = (
                IssueTypeProperty.objects.filter(issue_type_id__in=type_ids, property__deleted_at__isnull=True)
                .select_related("property")
                .order_by("sort_order", "created_at")
            )
            for link in links:
                self.by_type[link.issue_type_id].append(link.property)
            properties = [p for props in self.by_type.values() for p in props]
        prop_ids = {p.id for p in properties or []}
        self.usage = defaultdict(list)
        for type_id, prop_id in IssueTypeProperty.objects.filter(property_id__in=prop_ids).values_list(
            "issue_type_id", "property_id"
        ):
            self.usage[prop_id].append(str(type_id))
        self.options = defaultdict(list)
        for option in IssuePropertyOption.objects.filter(property_id__in=prop_ids).order_by("sort_order", "created_at"):
            self.options[option.property_id].append(option)
        self.projects = defaultdict(list)
        if type_ids is not None:
            for type_id, project_id in ProjectIssueType.objects.filter(
                issue_type_id__in=type_ids, deleted_at__isnull=True
            ).values_list("issue_type_id", "project_id"):
                self.projects[type_id].append(str(project_id))


def serialize_property(prop: IssueProperty, issue_type_id=None, batch=None):
    type_ids = batch.usage.get(prop.id, []) if batch else property_type_ids(prop)
    options = batch.options.get(prop.id, []) if batch else [o for o in prop.options.all() if o.deleted_at is None]
    return {
        "id": str(prop.id),
        # the type this property was listed under (when serialised as part of a type)
        "issue_type_id": str(issue_type_id) if issue_type_id else (type_ids[0] if type_ids else None),
        "issue_type_ids": type_ids,
        "project_id": str(prop.project_id),
        "display_name": prop.display_name,
        "description": prop.description,
        "property_type": prop.property_type,
        "is_multi": prop.is_multi,
        "is_required": prop.is_required,
        "is_active": prop.is_active,
        "is_public": prop.is_public,
        "sort_order": prop.sort_order,
        "default_value": prop.default_value or [],
        "settings": prop.settings or {},
        "logo_props": prop.logo_props or {},
        "options": [serialize_option(o) for o in options],
    }


def serialize_properties(props):
    props = list(props)
    batch = _Batch(properties=props)
    return [serialize_property(p, batch=batch) for p in props]


def serialize_issue_type(issue_type: IssueType, project_id, issue_count=None, batch=None):
    batch = batch or _Batch(type_ids=[issue_type.id])
    props = batch.by_type.get(issue_type.id, [])
    data = {
        "id": str(issue_type.id),
        "name": issue_type.name,
        "description": issue_type.description,
        "logo_props": issue_type.logo_props or {},
        "is_default": issue_type.is_default,
        "is_active": issue_type.is_active,
        "project_id": str(project_id),
        "project_ids": batch.projects.get(issue_type.id, []),
        "properties": [serialize_property(p, issue_type.id, batch) for p in props],
    }
    if issue_count is not None:
        data["issue_count"] = issue_count
    return data


def serialize_project_issue_types(project_id):
    types = project_issue_types(project_id).order_by("-is_default", "created_at")
    counts = {
        row["type_id"]: row["n"]
        for row in Issue.issue_objects.filter(project_id=project_id).values("type_id").annotate(n=Count("id"))
    }
    types = list(types)
    batch = _Batch(type_ids=[t.id for t in types])
    return [serialize_issue_type(t, project_id, counts.get(t.id, 0), batch) for t in types]


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------

PROPERTY_FIELDS = (
    "display_name",
    "description",
    "is_required",
    "is_active",
    "is_public",
    "sort_order",
    "settings",
    "logo_props",
)

# Kinds that can be shown on published pages (files, relations and rich text stay private).
PUBLIC_KINDS = (
    IssuePropertyType.TEXT,
    IssuePropertyType.PARAGRAPH,
    IssuePropertyType.NUMBER,
    IssuePropertyType.OPTION,
    IssuePropertyType.BOOLEAN,
    IssuePropertyType.DATE,
    IssuePropertyType.URL,
    IssuePropertyType.EMAIL,
    IssuePropertyType.MEMBER,
    IssuePropertyType.FORMULA,
    IssuePropertyType.CASCADING,
)


def _clean_property_payload(data, prop=None):
    errors = {}
    name = (data.get("display_name") if "display_name" in data else getattr(prop, "display_name", "")) or ""
    if not name.strip():
        errors["display_name"] = "Name is required."
    ptype = data.get("property_type") if prop is None else prop.property_type
    if ptype not in IssuePropertyType.values:
        errors["property_type"] = "Unknown property type."
    if prop is not None and "property_type" in data and data["property_type"] != prop.property_type:
        errors["property_type"] = "The type of an existing property cannot change; create a new property instead."
    is_multi = data.get("is_multi", getattr(prop, "is_multi", False))
    if is_multi and ptype not in MULTI_VALUE_PROPERTY_TYPES:
        errors["is_multi"] = "Only dropdown, member, file and relation properties can hold several values."
    if data.get("is_public", getattr(prop, "is_public", False)) and ptype not in PUBLIC_KINDS:
        errors["is_public"] = "Files, relations and rich text cannot be shown on published pages."
    if ptype in OPTION_TYPES:
        options = data.get("options")
        if prop is None and not options:
            errors["options"] = "This property needs at least one option."
        if options is not None:
            groups = [options] + [o.get("children") or [] for o in options]
            for group in groups:
                names = [str(o.get("name") or "").strip().lower() for o in group]
                if any(not n for n in names):
                    errors["options"] = "Every option needs a name."
                elif len(names) != len(set(names)):
                    errors["options"] = "Option names must be unique within their level."
            if ptype == IssuePropertyType.OPTION and any(o.get("children") for o in options):
                errors["options"] = "Only cascading properties have second-level options."
    if ptype == IssuePropertyType.FORMULA:
        if data.get("is_required", getattr(prop, "is_required", False)):
            errors["is_required"] = "A formula is computed, so it cannot be required."
        settings = data.get("settings") if "settings" in data else getattr(prop, "settings", {})
        project_id = getattr(prop, "project_id", None) or data.get("_project_id")
        numbers = project_properties(project_id).filter(property_type=IssuePropertyType.NUMBER)
        try:
            work_item_formula.validate((settings or {}).get("formula"), numbers.values_list("display_name", flat=True))
        except work_item_formula.FormulaError as e:
            errors["formula"] = str(e)
    if errors:
        raise PropertyValueError(errors)
    return bool(is_multi)


def _sync_options(prop: IssueProperty, options, user, parent=None, keep=None):
    """Make the property's options match the list: keep ids, add new ones, drop the rest.

    Cascading properties nest second-level options under ``children``.
    """
    top_level = keep is None
    keep = [] if keep is None else keep
    for index, raw in enumerate(options):
        fields = {
            "name": str(raw.get("name")).strip(),
            "description": raw.get("description") or "",
            "color": raw.get("color") or "",
            "sort_order": raw.get("sort_order") or (index + 1) * 10000,
            "is_default": bool(raw.get("is_default")),
            "is_active": raw.get("is_active") is not False,
        }
        option = None
        if raw.get("id"):
            option = IssuePropertyOption.objects.filter(property=prop, id=raw["id"]).first()
        if option:
            for key, value in fields.items():
                setattr(option, key, value)
            option.parent = parent
            option.updated_by = user
            option.save()
        else:
            option = IssuePropertyOption.objects.create(
                property=prop, project_id=prop.project_id, parent=parent, created_by=user, updated_by=user, **fields
            )
        keep.append(option.id)
        if prop.property_type == IssuePropertyType.CASCADING and parent is None:
            _sync_options(prop, raw.get("children") or [], user, parent=option, keep=keep)
    if not top_level:
        return
    removed = IssuePropertyOption.objects.filter(property=prop).exclude(id__in=keep)
    IssuePropertyValue.objects.filter(value_option__in=removed).delete(soft=False)
    removed.delete()


def _name_taken(project_id, name, exclude_id=None):
    qs = project_properties(project_id).filter(display_name__iexact=name.strip())
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return qs.exists()


@transaction.atomic
def link_properties(issue_type: IssueType, property_ids, user):
    """Let a type use properties of the pool (already linked ones are left alone)."""
    last = IssueTypeProperty.objects.filter(issue_type=issue_type).aggregate(m=Max("sort_order"))["m"] or 0
    linked = set(IssueTypeProperty.objects.filter(issue_type=issue_type).values_list("property_id", flat=True))
    props = IssueProperty.objects.filter(id__in=property_ids)
    for prop in props:
        if prop.id in linked:
            continue
        last += 10000
        IssueTypeProperty.objects.create(
            issue_type=issue_type,
            property=prop,
            sort_order=last,
            workspace_id=issue_type.workspace_id,
            project_id=prop.project_id,
            created_by=user,
            updated_by=user,
        )
        if prop.property_type == IssuePropertyType.FORMULA:
            recompute_formulas_for_type(issue_type.id)
    return props


def unlink_property(issue_type: IssueType, prop: IssueProperty):
    """Stop a type using a property. Values stay, so linking it again brings them back."""
    IssueTypeProperty.all_objects.filter(issue_type=issue_type, property=prop).delete()


def move_property(issue_type: IssueType, prop: IssueProperty, sort_order):
    IssueTypeProperty.objects.filter(issue_type=issue_type, property=prop).update(sort_order=sort_order)


@transaction.atomic
def create_property(project_id, issue_type, user, data):
    """Add a property to the project's pool, and to ``issue_type`` when given."""
    is_multi = _clean_property_payload({**data, "_project_id": project_id})
    if _name_taken(project_id, data["display_name"]):
        raise PropertyValueError({"display_name": "A property with this name already exists in this project."})
    last = project_properties(project_id).aggregate(m=Max("sort_order"))["m"]
    prop = IssueProperty.objects.create(
        project_id=project_id,
        display_name=data["display_name"].strip(),
        description=data.get("description") or "",
        property_type=data["property_type"],
        is_multi=is_multi,
        is_required=bool(data.get("is_required", False)),
        is_public=bool(data.get("is_public", False)),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order", (last or 0) + 10000),
        settings=data.get("settings") or {},
        logo_props=data.get("logo_props") or {},
        created_by=user,
        updated_by=user,
    )
    if prop.property_type in OPTION_TYPES:
        _sync_options(prop, data.get("options") or [], user)
    if "default_value" in data:
        prop.default_value = _normalise_values(prop, data.get("default_value") or [], "default_value")
        prop.save(update_fields=["default_value"])
    type_ids = [issue_type.id] if issue_type is not None else []
    type_ids += [t for t in data.get("issue_type_ids") or [] if t not in type_ids]
    for type_obj in project_issue_types(project_id).filter(id__in=type_ids):
        link_properties(type_obj, [prop.id], user)
    return prop


@transaction.atomic
def update_property(prop: IssueProperty, user, data):
    is_multi = _clean_property_payload(data, prop)
    if "display_name" in data and _name_taken(prop.project_id, data["display_name"], exclude_id=prop.id):
        raise PropertyValueError({"display_name": "A property with this name already exists in this project."})
    for key in PROPERTY_FIELDS:
        if key in data:
            value = data[key]
            setattr(prop, key, value.strip() if key == "display_name" else value)
    prop.is_multi = is_multi
    prop.updated_by = user
    prop.save()
    if prop.property_type in OPTION_TYPES and "options" in data:
        _sync_options(prop, data["options"], user)
    if prop.property_type == IssuePropertyType.FORMULA and "settings" in data:
        for type_id in property_type_ids(prop):
            recompute_formulas_for_type(type_id)
    if "default_value" in data:
        prop.default_value = _normalise_values(prop, data.get("default_value") or [], "default_value")
        prop.save(update_fields=["default_value"])
    return prop


@transaction.atomic
def delete_property(prop: IssueProperty):
    IssuePropertyValue.objects.filter(property=prop).delete(soft=False)
    IssuePropertyOption.objects.filter(property=prop).delete()
    IssueTypeProperty.all_objects.filter(property=prop).delete()
    prop.delete()


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------


def _normalise_values(prop: IssueProperty, raw, field_key, project_id=None, issue=None):
    """Validate one property's incoming values; return them as clean strings or raise PropertyValueError."""
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raw = [raw]
    raw = [v for v in raw if v is not None and str(v).strip() != ""]
    if len(raw) > 1 and not prop.is_multi:
        raise PropertyValueError({field_key: f"{prop.display_name} takes a single value."})

    clean = []
    ptype = prop.property_type
    for value in raw:
        text = str(value).strip()
        if ptype == IssuePropertyType.TEXT:
            if len(text) > MAX_TEXT_LENGTH:
                raise PropertyValueError(
                    {field_key: f"{prop.display_name} is limited to {MAX_TEXT_LENGTH} characters."}
                )
        elif ptype == IssuePropertyType.PARAGRAPH:
            if len(text) > MAX_PARAGRAPH_LENGTH:
                raise PropertyValueError(
                    {field_key: f"{prop.display_name} is limited to {MAX_PARAGRAPH_LENGTH} characters."}
                )
        elif ptype == IssuePropertyType.NUMBER:
            try:
                number = Decimal(text)
            except InvalidOperation:
                raise PropertyValueError({field_key: f"{prop.display_name} must be a number."})
            if not number.is_finite():
                raise PropertyValueError({field_key: f"{prop.display_name} must be a number."})
            text = format(number.normalize(), "f")
        elif ptype == IssuePropertyType.BOOLEAN:
            if text.lower() not in ("true", "false"):
                raise PropertyValueError({field_key: f"{prop.display_name} must be true or false."})
            text = text.lower()
        elif ptype == IssuePropertyType.DATE:
            try:
                date.fromisoformat(text)
            except ValueError:
                raise PropertyValueError({field_key: f"{prop.display_name} must be a date (YYYY-MM-DD)."})
        elif ptype == IssuePropertyType.URL:
            parsed = urlparse(text)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise PropertyValueError({field_key: f"{prop.display_name} must be an http(s) link."})
        elif ptype == IssuePropertyType.OPTION:
            if not IssuePropertyOption.objects.filter(property=prop, id=text, is_active=True).exists():
                raise PropertyValueError({field_key: f"Unknown option for {prop.display_name}."})
        elif ptype == IssuePropertyType.EMAIL:
            if len(text) > MAX_TEXT_LENGTH or not EMAIL_PATTERN.match(text):
                raise PropertyValueError({field_key: f"{prop.display_name} must be an email address."})
            text = text.lower()
        elif ptype == IssuePropertyType.RICH_TEXT:
            if len(text) > MAX_RICH_TEXT_LENGTH:
                raise PropertyValueError({field_key: f"{prop.display_name} is too long."})
            is_valid, _error, sanitized = validate_html_content(text)
            if not is_valid:
                raise PropertyValueError({field_key: f"{prop.display_name} contains content that is not allowed."})
            text = sanitized if sanitized is not None else text
            if text in ("<p></p>", ""):
                continue
        elif ptype == IssuePropertyType.CASCADING:
            option = IssuePropertyOption.objects.filter(property=prop, id=text, is_active=True).first()
            if option is None:
                raise PropertyValueError({field_key: f"Unknown option for {prop.display_name}."})
            if option.parent_id is None and option.children.filter(deleted_at__isnull=True).exists():
                raise PropertyValueError({field_key: f"Pick a second-level option for {prop.display_name}."})
        elif ptype == IssuePropertyType.FILE:
            if issue is None:
                raise PropertyValueError({field_key: f"{prop.display_name} cannot have a default file."})
            if not FileAsset.objects.filter(
                id=text, issue_id=issue.id, entity_type=FileAsset.EntityTypeContext.ISSUE_ATTACHMENT
            ).exists():
                raise PropertyValueError({field_key: f"{prop.display_name} must be an attachment of this work item."})
        elif ptype == IssuePropertyType.RELATION:
            if issue is not None and text == str(issue.id):
                raise PropertyValueError({field_key: f"{prop.display_name} cannot point at the work item itself."})
            if not Issue.issue_objects.filter(id=text, workspace_id=prop.workspace_id).exists():
                raise PropertyValueError({field_key: f"{prop.display_name} must be a work item of this workspace."})
        elif ptype == IssuePropertyType.FORMULA:
            raise PropertyValueError({field_key: f"{prop.display_name} is computed and cannot be set."})
        elif ptype == IssuePropertyType.MEMBER:
            # Members are checked against the work item's project: shared types span projects.
            member_project_id = project_id or prop.project_id
            if not ProjectMember.objects.filter(project_id=member_project_id, member_id=text, is_active=True).exists():
                raise PropertyValueError({field_key: f"{prop.display_name} must be a member of this project."})
        if text not in clean:
            clean.append(text)
    return clean


def _row_value(row: IssuePropertyValue, ptype):
    if ptype in TEXT_COLUMN_TYPES:
        return row.value_text
    if ptype in (IssuePropertyType.NUMBER, IssuePropertyType.FORMULA):
        return None if row.value_number is None else format(row.value_number.normalize(), "f")
    if ptype == IssuePropertyType.BOOLEAN:
        return None if row.value_boolean is None else ("true" if row.value_boolean else "false")
    if ptype == IssuePropertyType.DATE:
        return None if row.value_date is None else row.value_date.isoformat()
    if ptype in OPTION_TYPES:
        return None if row.value_option_id is None else str(row.value_option_id)
    if ptype == IssuePropertyType.MEMBER:
        return None if row.value_member_id is None else str(row.value_member_id)
    if ptype == IssuePropertyType.FILE:
        return None if row.value_asset_id is None else str(row.value_asset_id)
    if ptype == IssuePropertyType.RELATION:
        return None if row.value_issue_id is None else str(row.value_issue_id)
    return None


def _row_fields(ptype, text):
    if ptype in TEXT_COLUMN_TYPES:
        return {"value_text": text}
    if ptype in (IssuePropertyType.NUMBER, IssuePropertyType.FORMULA):
        return {"value_number": Decimal(text)}
    if ptype == IssuePropertyType.BOOLEAN:
        return {"value_boolean": text == "true"}
    if ptype == IssuePropertyType.DATE:
        return {"value_date": date.fromisoformat(text)}
    if ptype in OPTION_TYPES:
        return {"value_option_id": text}
    if ptype == IssuePropertyType.MEMBER:
        return {"value_member_id": text}
    if ptype == IssuePropertyType.FILE:
        return {"value_asset_id": text}
    if ptype == IssuePropertyType.RELATION:
        return {"value_issue_id": text}
    return {}


def issue_property_values(issue: Issue):
    """Current values of the work item's type properties, property id -> list of strings."""
    result = {}
    if not issue.type_id:
        return result
    props = {p.id: p for p in type_properties(issue.type_id)}
    for prop_id in props:
        result[str(prop_id)] = []
    rows = (
        IssuePropertyValue.objects.filter(issue=issue, property_id__in=props.keys())
        # files and related work items that were deleted no longer count as values
        .exclude(value_asset__deleted_at__isnull=False)
        .exclude(value_issue__deleted_at__isnull=False)
        .order_by("created_at")
    )
    for row in rows:
        value = _row_value(row, props[row.property_id].property_type)
        if value is not None:
            result[str(row.property_id)].append(value)
    return result


def _display(prop: IssueProperty, values):
    """Readable text of values, for the activity feed and notifications."""
    if prop.property_type == IssuePropertyType.OPTION:
        names = dict(IssuePropertyOption.all_objects.filter(id__in=values).values_list("id", "name"))
        return ", ".join(str(names.get(_uuid(v), v)) for v in values)
    if prop.property_type == IssuePropertyType.CASCADING:
        options = IssuePropertyOption.all_objects.filter(id__in=values).select_related("parent")
        return ", ".join(f"{o.parent.name} › {o.name}" if o.parent else o.name for o in options)
    if prop.property_type == IssuePropertyType.FILE:
        names = {
            a.id: (a.attributes or {}).get("name") or str(a.asset) for a in FileAsset.all_objects.filter(id__in=values)
        }
        return ", ".join(str(names.get(_uuid(v), v)) for v in values)
    if prop.property_type == IssuePropertyType.RELATION:
        issues = Issue.all_objects.filter(id__in=values).select_related("project")
        return ", ".join(f"{i.project.identifier}-{i.sequence_id}" for i in issues)
    if prop.property_type == IssuePropertyType.RICH_TEXT:
        text = re.sub(r"<[^>]+>", " ", " ".join(values))
        text = re.sub(r"\s+", " ", text).strip()
        return text[:200] + ("…" if len(text) > 200 else "")
    if prop.property_type == IssuePropertyType.MEMBER:
        from plane.db.models import User

        names = dict(User.objects.filter(id__in=values).values_list("id", "display_name"))
        return ", ".join(str(names.get(_uuid(v), v)) for v in values)
    return ", ".join(values)


def _uuid(value):
    import uuid

    try:
        return uuid.UUID(str(value))
    except ValueError:
        return value


@transaction.atomic
def save_issue_property_values(issue: Issue, values, actor, check_required=False, notify=True):
    """Replace the given properties' values on a work item.

    Only properties present in ``values`` change. With ``check_required`` every
    required property of the type must end up with a value (used on create).
    Raises PropertyValueError with a map of property id -> message.
    """
    if not isinstance(values, dict):
        raise PropertyValueError({"values": "Expected an object of property id to values."})
    if not issue.type_id:
        if values:
            raise PropertyValueError({"type_id": "This work item has no type, so it has no properties."})
        return {}

    props = {str(p.id): p for p in type_properties(issue.type_id, active_only=True)}
    errors, clean = {}, {}
    for prop_id, raw in values.items():
        prop = props.get(str(prop_id))
        if prop is None:
            errors[str(prop_id)] = "This property does not belong to the work item's type."
            continue
        if prop.property_type == IssuePropertyType.FORMULA and not raw:
            # Forms send every property; computed ones are simply skipped.
            continue
        try:
            clean[prop_id] = _normalise_values(prop, raw, str(prop_id), issue.project_id, issue)
        except PropertyValueError as e:
            errors.update(e.errors)

    current = issue_property_values(issue)
    for prop_id, prop in props.items():
        if not prop.is_required:
            continue
        # On create every required property must be given; on edit only the ones being changed are checked.
        if prop_id in clean:
            final = clean[prop_id]
        elif check_required:
            final = current.get(prop_id, [])
        else:
            continue
        if not final:
            errors[prop_id] = f"{prop.display_name} is required."
    if errors:
        raise PropertyValueError(errors)

    epoch = int(time.time())
    activities = []
    for prop_id, new_values in clean.items():
        prop = props[prop_id]
        old_values = current.get(prop_id, [])
        if old_values == new_values:
            continue
        IssuePropertyValue.objects.filter(issue=issue, property=prop).delete(soft=False)
        IssuePropertyValue.objects.bulk_create(
            [
                IssuePropertyValue(
                    issue=issue,
                    property=prop,
                    project_id=issue.project_id,
                    workspace_id=issue.workspace_id,
                    created_by=actor,
                    updated_by=actor,
                    **_row_fields(prop.property_type, text),
                )
                for text in new_values
            ]
        )
        activities.append(
            IssueActivity.objects.create(
                issue=issue,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                actor=actor,
                verb="updated",
                field="custom_property",
                old_value=_display(prop, old_values) or None,
                new_value=_display(prop, new_values) or None,
                # The frontend shows this as the property name in the activity feed
                comment=prop.display_name,
                epoch=epoch,
            )
        )
    recompute_formulas(issue)
    if activities and notify:
        transaction.on_commit(lambda: notify_subscribers(issue, actor, activities))
    return issue_property_values(issue)


def recompute_formulas(issue: Issue):
    """Store the value of every formula property of the work item's type from its number properties."""
    if not issue.type_id:
        return
    props = type_properties(issue.type_id, active_only=True)
    formulas = [p for p in props if p.property_type == IssuePropertyType.FORMULA]
    if not formulas:
        return
    numbers = {}
    number_props = {p.id: p.display_name for p in props if p.property_type == IssuePropertyType.NUMBER}
    for row in IssuePropertyValue.objects.filter(issue=issue, property_id__in=number_props.keys()):
        if row.value_number is not None:
            numbers[number_props[row.property_id]] = row.value_number
    for prop in formulas:
        try:
            result = work_item_formula.evaluate((prop.settings or {}).get("formula"), numbers)
        except work_item_formula.FormulaError:
            result = None
        existing = IssuePropertyValue.objects.filter(issue=issue, property=prop)
        if result is None:
            existing.delete(soft=False)
        elif not existing.update(value_number=result):
            IssuePropertyValue.objects.create(
                issue=issue,
                property=prop,
                project_id=issue.project_id,
                workspace_id=issue.workspace_id,
                value_number=result,
            )


def recompute_formulas_for_type(issue_type_id):
    """After a formula changes, refresh it on every work item of the type."""
    for issue in Issue.issue_objects.filter(type_id=issue_type_id):
        recompute_formulas(issue)


def notify_subscribers(issue: Issue, actor, activities):
    """Hand recorded activities to the regular notification task (in-app + email for subscribers)."""
    # Imported here: the task module imports serializers, which import this module.
    from django.core.serializers.json import DjangoJSONEncoder

    from plane.app.serializers import IssueActivitySerializer
    from plane.bgtasks.notification_task import notifications

    notifications.delay(
        type="issue.activity.updated",
        issue_id=str(issue.id),
        project_id=str(issue.project_id),
        actor_id=str(actor.id),
        subscriber=False,
        issue_activities_created=json.dumps(IssueActivitySerializer(activities, many=True).data, cls=DjangoJSONEncoder),
        requested_data=json.dumps({}),
        current_instance=json.dumps({}),
    )


@transaction.atomic
def bulk_assign_type(project_id, type_id, issue_ids, actor):
    """Move work items of a project to one of its types, recording a type change on each."""
    issue_type = project_issue_types(project_id).filter(id=type_id, is_active=True).first()
    if issue_type is None:
        raise PropertyValueError({"type_id": "Work item type is not valid for this project."})
    issues = list(Issue.issue_objects.filter(project_id=project_id, id__in=issue_ids).exclude(type_id=issue_type.id))
    old_names = dict(IssueType.objects.filter(id__in={i.type_id for i in issues}).values_list("id", "name"))
    epoch = int(time.time())
    for issue in issues:
        activity = IssueActivity.objects.create(
            issue=issue,
            project_id=issue.project_id,
            workspace_id=issue.workspace_id,
            actor=actor,
            verb="updated",
            field="type",
            old_value=old_names.get(issue.type_id, ""),
            new_value=issue_type.name,
            old_identifier=issue.type_id,
            new_identifier=issue_type.id,
            comment="updated the work item type to",
            epoch=epoch,
        )
        transaction.on_commit(lambda issue=issue, activity=activity: notify_subscribers(issue, actor, [activity]))
    Issue.issue_objects.filter(id__in=[i.id for i in issues]).update(type=issue_type)
    for issue in issues:
        issue.type_id = issue_type.id
        recompute_formulas(issue)
    return len(issues)


def apply_default_values(issue: Issue, actor, provided):
    """Fill properties the caller left out with their type defaults."""
    if not issue.type_id:
        return provided
    merged = dict(provided or {})
    for prop in type_properties(issue.type_id, active_only=True):
        if str(prop.id) not in merged and prop.default_value:
            merged[str(prop.id)] = prop.default_value
    return merged


VALUE_COLUMNS = (
    "value_text",
    "value_number",
    "value_boolean",
    "value_date",
    "value_option_id",
    "value_member_id",
    "value_asset_id",
    "value_issue_id",
)


def _raw_value(ptype, text, number, boolean, day, option, member, asset, issue):
    """Like _row_value, for rows read with values_list (no model instances)."""
    if ptype in TEXT_COLUMN_TYPES:
        return text
    if ptype in (IssuePropertyType.NUMBER, IssuePropertyType.FORMULA):
        return None if number is None else format(number.normalize(), "f")
    if ptype == IssuePropertyType.BOOLEAN:
        return None if boolean is None else ("true" if boolean else "false")
    if ptype == IssuePropertyType.DATE:
        return None if day is None else day.isoformat()
    if ptype in OPTION_TYPES:
        return None if option is None else str(option)
    if ptype == IssuePropertyType.MEMBER:
        return None if member is None else str(member)
    if ptype == IssuePropertyType.FILE:
        return None if asset is None else str(asset)
    if ptype == IssuePropertyType.RELATION:
        return None if issue is None else str(issue)
    return None


def project_property_values(project_id, issue_ids=None):
    """Values of a project's work items: issue id -> property id -> list of strings.

    Lists ask for the items on screen (``issue_ids``); without it every item of the project is read.
    """
    rows = IssuePropertyValue.objects.filter(project_id=project_id, issue__deleted_at__isnull=True)
    if issue_ids is not None:
        rows = rows.filter(issue_id__in=issue_ids)
    result = {}
    for issue_id, property_id, ptype, *columns in rows.order_by("created_at").values_list(
        "issue_id", "property_id", "property__property_type", *VALUE_COLUMNS
    ):
        value = _raw_value(ptype, *columns)
        if value is None:
            continue
        result.setdefault(str(issue_id), {}).setdefault(str(property_id), []).append(value)
    return result
