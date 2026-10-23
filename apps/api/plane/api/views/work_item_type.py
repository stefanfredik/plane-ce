# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Public (API key) endpoints for work item types and custom properties.

Paths and payloads follow Plane's published REST shape for these resources so
the official SDK and MCP server can talk to this instance. Our storage uses a
smaller vocabulary, mapped here:

    ours        public
    TEXT        TEXT (settings.display_format = "single-line")
    PARAGRAPH   TEXT (settings.display_format = "multi-line")
    NUMBER      DECIMAL
    DATE        DATETIME
    MEMBER      RELATION (relation_type = "USER")
    OPTION, BOOLEAN, URL unchanged

``/work-items/<id>/property-values/`` is an extra endpoint that reads and
writes every property of a work item at once, by property name or id and with
option/member names accepted, for scripts and assistants.
"""

# Python imports
import uuid

# Django imports
from django.db.models import Q

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.api.views.base import BaseAPIView
from plane.app.permissions import ProjectEntityPermission
from plane.db.models import (
    Issue,
    IssuePropertyOption,
    IssuePropertyValue,
    Project,
    ProjectMember,
    User,
    WorkspaceMember,
)
from plane.utils import work_item_types as wit

TO_PUBLIC = {
    "NUMBER": "DECIMAL",
    "DATE": "DATETIME",
    "MEMBER": "RELATION",
    "PARAGRAPH": "TEXT",
    "RICH_TEXT": "RELATION",
}
RELATION_TYPE = {"MEMBER": "USER", "RELATION": "ISSUE", "RICH_TEXT": "RICH_TEXT"}
UNSUPPORTED_PUBLIC_TYPES = set()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _is_project_admin(user, slug, project_id):
    """Same rule as the web app: project admin, or workspace admin who is a project member."""
    member = ProjectMember.objects.filter(
        member=user, workspace__slug=slug, project_id=project_id, is_active=True
    ).first()
    if member is None:
        return False
    if member.role == 20:
        return True
    return WorkspaceMember.objects.filter(member=user, workspace__slug=slug, role=20, is_active=True).exists()


def _forbidden():
    return Response({"error": "Only project admins can change work item types."}, status=status.HTTP_403_FORBIDDEN)


def _not_found(what):
    return Response({"error": f"{what} not found"}, status=status.HTTP_404_NOT_FOUND)


def _bad_request(errors):
    return Response({"error": "Invalid data", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


def _type_or_none(project_id, type_id):
    return wit.project_issue_types(project_id).filter(id=type_id).first()


def public_type(issue_type, project_id):
    return {
        "id": str(issue_type.id),
        "name": issue_type.name,
        "description": issue_type.description,
        "logo_props": issue_type.logo_props or {},
        "is_epic": issue_type.is_epic,
        "is_default": issue_type.is_default,
        "is_active": issue_type.is_active,
        "level": int(issue_type.level or 0),
        "project_ids": [str(project_id)],
        "workspace": str(issue_type.workspace_id),
        "external_source": issue_type.external_source,
        "external_id": issue_type.external_id,
        "created_at": issue_type.created_at.isoformat() if issue_type.created_at else None,
        "updated_at": issue_type.updated_at.isoformat() if issue_type.updated_at else None,
    }


def public_option(option):
    return {
        "id": str(option.id),
        "name": option.name,
        "description": option.description,
        "sort_order": option.sort_order,
        "is_active": option.is_active,
        "is_default": option.is_default,
        "logo_props": {"in_use": "icon", "icon": {"color": option.color}} if option.color else {},
        "property": str(option.property_id),
        "parent": str(option.parent_id) if option.parent_id else None,
        "project": str(option.project_id),
        "workspace": str(option.workspace_id),
        "external_source": option.external_source,
        "external_id": option.external_id,
    }


def public_property(prop, issue_type_id=None):
    settings = dict(prop.settings or {})
    if prop.property_type in ("TEXT", "PARAGRAPH"):
        settings["display_format"] = "multi-line" if prop.property_type == "PARAGRAPH" else "single-line"
    return {
        "id": str(prop.id),
        "name": prop.display_name,
        "display_name": prop.display_name,
        "description": prop.description,
        "logo_props": prop.logo_props or {},
        "sort_order": prop.sort_order,
        "property_type": TO_PUBLIC.get(prop.property_type, prop.property_type),
        "relation_type": RELATION_TYPE.get(prop.property_type),
        "is_required": prop.is_required,
        "default_value": prop.default_value or [],
        "settings": settings,
        "is_active": prop.is_active,
        "is_multi": prop.is_multi,
        "issue_type": str(issue_type_id) if issue_type_id else next(iter(wit.property_type_ids(prop)), None),
        "project": str(prop.project_id),
        "workspace": str(prop.workspace_id),
        "external_source": prop.external_source,
        "external_id": prop.external_id,
        "options": [public_option(o) for o in prop.options.all()],
    }


def from_public_property(data, existing=None):
    """Translate a public property payload into our create/update payload."""
    out = {
        k: data[k]
        for k in ("display_name", "description", "is_required", "is_active", "is_multi", "logo_props")
        if k in data
    }
    if "default_value" in data:
        out["default_value"] = data["default_value"]
    settings = data.get("settings") or {}
    if "property_type" in data and existing is None:
        ptype = str(data["property_type"]).upper()
        if ptype in UNSUPPORTED_PUBLIC_TYPES:
            raise wit.PropertyValueError({"property_type": f"{ptype} properties are not supported on this instance."})
        if ptype == "TEXT":
            ptype = "PARAGRAPH" if settings.get("display_format") == "multi-line" else "TEXT"
        elif ptype == "DECIMAL":
            ptype = "NUMBER"
        elif ptype == "DATETIME":
            ptype = "DATE"
        elif ptype == "RELATION":
            relation = str(data.get("relation_type") or "").upper()
            ptype = {"USER": "MEMBER", "ISSUE": "RELATION", "RICH_TEXT": "RICH_TEXT"}.get(relation)
            if ptype is None:
                raise wit.PropertyValueError({"relation_type": "Supported relations here: USER, ISSUE and RICH_TEXT."})
        out["property_type"] = ptype
    if "options" in data:
        out["options"] = [
            {
                "id": o.get("id"),
                "name": o.get("name"),
                "description": o.get("description") or "",
                "is_default": o.get("is_default", False),
                "is_active": o.get("is_active", True),
                "sort_order": o.get("sort_order"),
                "children": o.get("children") or [],
            }
            for o in data["options"] or []
        ]
    return out


def _typed(prop, text):
    if text is None:
        return None
    if prop.property_type in ("NUMBER", "FORMULA"):
        return float(text)
    if prop.property_type == "BOOLEAN":
        return text == "true"
    return text


def public_values(issue, prop):
    """Public value detail(s) of one property; None when unset."""
    rows = list(IssuePropertyValue.objects.filter(issue=issue, property=prop).order_by("created_at"))
    current = wit.issue_property_values(issue).get(str(prop.id), [])
    details = [
        {
            "id": str(row.id),
            "property_id": str(prop.id),
            "issue_id": str(issue.id),
            "value": _typed(prop, text),
            "value_type": TO_PUBLIC.get(prop.property_type, prop.property_type),
        }
        for row, text in zip(rows, current)
    ]
    if not details:
        return None
    return details if prop.is_multi else details[0]


def _as_uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def resolve_value(prop, raw, project_id=None):
    """Accept friendly input: option names, member emails/display names, booleans, numbers."""
    items = raw if isinstance(raw, list) else ([] if raw is None else [raw])
    out = []
    for item in items:
        if isinstance(item, bool):
            out.append("true" if item else "false")
            continue
        text = str(item).strip()
        if prop.property_type == "OPTION" and _as_uuid(text) is None:
            option = IssuePropertyOption.objects.filter(property=prop, name__iexact=text).first()
            if option is None:
                raise wit.PropertyValueError({str(prop.id): f'"{text}" is not an option of {prop.display_name}.'})
            text = str(option.id)
        elif prop.property_type == "MEMBER" and _as_uuid(text) is None:
            member_ids = ProjectMember.objects.filter(project_id=project_id or prop.project_id, is_active=True).values(
                "member_id"
            )
            user = User.objects.filter(Q(email__iexact=text) | Q(display_name__iexact=text), id__in=member_ids).first()
            if user is None:
                raise wit.PropertyValueError({str(prop.id): f'"{text}" is not a member of this project.'})
            text = str(user.id)
        out.append(text)
    return out


def _issue(slug, project_id, issue_id):
    return Issue.issue_objects.filter(workspace__slug=slug, project_id=project_id, id=issue_id).first()


# ---------------------------------------------------------------------------
# types
# ---------------------------------------------------------------------------


class WorkItemTypeListCreateAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def get(self, request, slug, project_id):
        types = wit.project_issue_types(project_id).order_by("-is_default", "created_at")
        return Response([public_type(t, project_id) for t in types])

    def post(self, request, slug, project_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        name = (request.data.get("name") or "").strip()
        if not name:
            return _bad_request({"name": "Name is required."})
        if not project.is_issue_type_enabled:
            wit.enable_issue_types(project, request.user)
        if wit.type_name_taken(project_id, name):
            return _bad_request({"name": "A type with this name already exists in this project."})
        issue_type = wit.create_issue_type(project, request.user, request.data)
        if request.data.get("external_id") or request.data.get("external_source"):
            issue_type.external_id = request.data.get("external_id")
            issue_type.external_source = request.data.get("external_source")
            issue_type.save(update_fields=["external_id", "external_source"])
        return Response(public_type(issue_type, project_id), status=status.HTTP_201_CREATED)


class WorkItemTypeDetailAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def get(self, request, slug, project_id, type_id):
        issue_type = _type_or_none(project_id, type_id)
        return Response(public_type(issue_type, project_id)) if issue_type else _not_found("Work item type")

    def patch(self, request, slug, project_id, type_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        issue_type = _type_or_none(project_id, type_id)
        if issue_type is None:
            return _not_found("Work item type")
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name or wit.type_name_taken(project_id, name, exclude_id=issue_type.id):
                return _bad_request({"name": "Name is required and must be unique in the project."})
            issue_type.name = name
        for key in ("description", "logo_props", "external_id", "external_source"):
            if key in request.data:
                setattr(issue_type, key, request.data[key])
        if "is_active" in request.data:
            if issue_type.is_default and not request.data["is_active"]:
                return _bad_request({"is_active": "The default type cannot be turned off."})
            issue_type.is_active = bool(request.data["is_active"])
        issue_type.save()
        return Response(public_type(issue_type, project_id))

    def delete(self, request, slug, project_id, type_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        issue_type = _type_or_none(project_id, type_id)
        if issue_type is None:
            return _not_found("Work item type")
        if issue_type.is_default:
            return _bad_request({"type": "The default type cannot be deleted."})
        wit.delete_issue_type(project_id, issue_type)
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# properties and options
# ---------------------------------------------------------------------------


class WorkItemPropertyListCreateAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def get(self, request, slug, project_id, type_id):
        if _type_or_none(project_id, type_id) is None:
            return _not_found("Work item type")
        return Response([public_property(p, type_id) for p in wit.type_properties(type_id)])

    def post(self, request, slug, project_id, type_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        issue_type = _type_or_none(project_id, type_id)
        if issue_type is None:
            return _not_found("Work item type")
        try:
            prop = wit.create_property(project_id, issue_type, request.user, from_public_property(request.data))
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(public_property(prop, issue_type.id), status=status.HTTP_201_CREATED)


class WorkItemPropertyDetailAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def _prop(self, project_id, type_id, property_id):
        prop = wit.type_property(project_id, property_id)
        return prop if prop and wit.type_uses_property(type_id, prop.id) else None

    def get(self, request, slug, project_id, type_id, property_id):
        prop = self._prop(project_id, type_id, property_id)
        return Response(public_property(prop, type_id)) if prop else _not_found("Property")

    def patch(self, request, slug, project_id, type_id, property_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        prop = self._prop(project_id, type_id, property_id)
        if prop is None:
            return _not_found("Property")
        try:
            prop = wit.update_property(prop, request.user, from_public_property(request.data, existing=prop))
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(public_property(prop, type_id))

    def delete(self, request, slug, project_id, type_id, property_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        prop = self._prop(project_id, type_id, property_id)
        if prop is None:
            return _not_found("Property")
        # Take it off the type; a property no other type uses is deleted, as before the pool existed.
        wit.unlink_property(_type_or_none(project_id, type_id), prop)
        if not wit.property_type_ids(prop):
            wit.delete_property(prop)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemProjectPropertyListAPIEndpoint(BaseAPIView):
    """The project's property pool."""

    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def get(self, request, slug, project_id):
        props = wit.project_properties(project_id).prefetch_related("options")
        return Response([public_property(p) for p in props])


class WorkItemPropertyOptionListCreateAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def get(self, request, slug, project_id, property_id):
        prop = wit.type_property(project_id, property_id)
        if prop is None:
            return _not_found("Property")
        return Response([public_option(o) for o in prop.options.all()])

    def post(self, request, slug, project_id, property_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        prop = wit.type_property(project_id, property_id)
        if prop is not None and prop.property_type != "OPTION":
            prop = None
        if prop is None:
            return _not_found("Option property")
        options = [{"id": str(o.id), "name": o.name} for o in prop.options.all()]
        options.append({"name": request.data.get("name"), "description": request.data.get("description") or ""})
        try:
            wit.update_property(prop, request.user, {"options": options})
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        created = prop.options.filter(name=str(request.data.get("name")).strip()).first()
        return Response(public_option(created), status=status.HTTP_201_CREATED)


class WorkItemPropertyOptionDetailAPIEndpoint(BaseAPIView):
    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def _option(self, project_id, property_id, option_id):
        prop = wit.type_property(project_id, property_id)
        return prop.options.filter(id=option_id).first() if prop else None

    def get(self, request, slug, project_id, property_id, option_id):
        option = self._option(project_id, property_id, option_id)
        return Response(public_option(option)) if option else _not_found("Option")

    def patch(self, request, slug, project_id, property_id, option_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        option = self._option(project_id, property_id, option_id)
        if option is None:
            return _not_found("Option")
        options = [
            {"id": str(o.id), "name": request.data.get("name", o.name) if o.id == option.id else o.name}
            for o in option.property.options.all()
        ]
        try:
            wit.update_property(option.property, request.user, {"options": options})
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        for key in ("description", "is_active", "is_default"):
            if key in request.data:
                setattr(option, key, request.data[key])
        option.refresh_from_db(fields=["name"])
        option.save()
        return Response(public_option(option))

    def delete(self, request, slug, project_id, property_id, option_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        option = self._option(project_id, property_id, option_id)
        if option is None:
            return _not_found("Option")
        remaining = [{"id": str(o.id), "name": o.name} for o in option.property.options.exclude(id=option.id)]
        wit.update_property(option.property, request.user, {"options": remaining})
        return Response(status=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# values
# ---------------------------------------------------------------------------


class WorkItemPropertyValueAPIEndpoint(BaseAPIView):
    """One property's value(s) on a work item (SDK-compatible)."""

    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def _context(self, slug, project_id, work_item_id, property_id):
        issue = _issue(slug, project_id, work_item_id)
        if issue is None:
            return None, None, _not_found("Work item")
        prop = wit.type_property(project_id, property_id)
        if prop is None:
            return issue, None, _not_found("Property")
        return issue, prop, None

    def get(self, request, slug, project_id, work_item_id, property_id):
        issue, prop, error = self._context(slug, project_id, work_item_id, property_id)
        if error:
            return error
        data = public_values(issue, prop)
        return Response(data) if data is not None else _not_found("Property value")

    def post(self, request, slug, project_id, work_item_id, property_id):
        issue, prop, error = self._context(slug, project_id, work_item_id, property_id)
        if error:
            return error
        try:
            values = resolve_value(prop, request.data.get("value", request.data.get("values")), project_id)
            wit.save_issue_property_values(issue, {str(prop.id): values}, request.user)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        data = public_values(issue, prop)
        return Response(data if data is not None else [], status=status.HTTP_201_CREATED)

    def patch(self, request, slug, project_id, work_item_id, property_id):
        return self.post(request, slug, project_id, work_item_id, property_id)

    def delete(self, request, slug, project_id, work_item_id, property_id):
        issue, prop, error = self._context(slug, project_id, work_item_id, property_id)
        if error:
            return error
        try:
            wit.save_issue_property_values(issue, {str(prop.id): []}, request.user)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemAllPropertyValuesAPIEndpoint(BaseAPIView):
    """All custom properties of a work item at once, keyed by property name."""

    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def _describe(self, issue):
        props = wit.type_properties(issue.type_id, active_only=True)
        values = wit.issue_property_values(issue)
        option_names = dict(IssuePropertyOption.objects.filter(property__in=props).values_list("id", "name"))
        out = {}
        for prop in props:
            raw = values.get(str(prop.id), [])
            if prop.property_type == "OPTION":
                shown = [option_names.get(_as_uuid(v), v) for v in raw]
            elif prop.property_type == "MEMBER":
                shown = list(User.objects.filter(id__in=raw).values_list("display_name", flat=True))
            else:
                shown = [_typed(prop, v) for v in raw]
            out[prop.display_name] = {
                "property_id": str(prop.id),
                "property_type": prop.property_type,
                "is_required": prop.is_required,
                "is_multi": prop.is_multi,
                "value": shown if prop.is_multi else (shown[0] if shown else None),
                "options": [o.name for o in prop.options.all()] if prop.property_type == "OPTION" else None,
            }
        return {
            "work_item_id": str(issue.id),
            "type_id": str(issue.type_id) if issue.type_id else None,
            "properties": out,
        }

    def get(self, request, slug, project_id, work_item_id):
        issue = _issue(slug, project_id, work_item_id)
        return Response(self._describe(issue)) if issue else _not_found("Work item")

    def put(self, request, slug, project_id, work_item_id):
        issue = _issue(slug, project_id, work_item_id)
        if issue is None:
            return _not_found("Work item")
        incoming = request.data.get("values", request.data)
        if not isinstance(incoming, dict):
            return _bad_request({"values": "Expected an object of property name or id to value."})
        props = wit.type_properties(issue.type_id)
        by_key = {str(p.id): p for p in props} | {p.display_name.lower(): p for p in props}
        resolved, errors = {}, {}
        for key, raw in incoming.items():
            prop = by_key.get(str(key)) or by_key.get(str(key).lower())
            if prop is None:
                errors[str(key)] = "No such property on this work item's type."
                continue
            try:
                resolved[str(prop.id)] = resolve_value(prop, raw, issue.project_id)
            except wit.PropertyValueError as e:
                errors.update(e.errors)
        if errors:
            return _bad_request(errors)
        try:
            wit.save_issue_property_values(issue, resolved, request.user)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(self._describe(issue))

    patch = put


class WorkItemTypeImportAPIEndpoint(BaseAPIView):
    """Share existing workspace types with a project (SDK: work_item_types.import_to_project)."""

    permission_classes = [ProjectEntityPermission]
    use_read_replica = False

    def post(self, request, slug, project_id):
        if not _is_project_admin(request.user, slug, project_id):
            return _forbidden()
        type_ids = request.data.get("work_item_type_ids") or request.data.get("type_ids") or []
        if not isinstance(type_ids, list) or not type_ids:
            return _bad_request({"work_item_type_ids": "Pick at least one type."})
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        imported, skipped = wit.import_issue_types(project, request.user, type_ids)
        return Response({"imported": [public_type(t, project_id) for t in imported], "skipped": skipped})
