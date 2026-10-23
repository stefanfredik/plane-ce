# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Third Party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from plane.app.permissions import ROLE, allow_permission
from plane.app.views.base import BaseAPIView
from plane.db.models import Issue, Project, Workspace
from plane.utils import work_item_types as wit


# Lists load property values for the work items on screen, in batches of at most this many.
MAX_VALUE_BATCH = 200


def _issue_type_or_404(project_id, type_id):
    return wit.project_issue_types(project_id).filter(id=type_id).first()


def _bad_request(errors):
    return Response({"error": "Invalid data", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)


class WorkItemTypeEndpoint(BaseAPIView):
    """List and create the work item types of a project."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        return Response(
            {"is_enabled": project.is_issue_type_enabled, "types": wit.serialize_project_issue_types(project_id)}
        )

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        if not project.is_issue_type_enabled:
            return _bad_request({"project": "Turn on work item types for this project first."})
        name = (request.data.get("name") or "").strip()
        if not name:
            return _bad_request({"name": "Name is required."})
        if wit.type_name_taken(project_id, name):
            return _bad_request({"name": "A type with this name already exists in this project."})
        issue_type = wit.create_issue_type(project, request.user, request.data)
        return Response(wit.serialize_issue_type(issue_type, project_id, 0), status=status.HTTP_201_CREATED)


class WorkItemTypeEnableEndpoint(BaseAPIView):
    """Turn work item types on for a project (creates the default type)."""

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        wit.enable_issue_types(project, request.user)
        return Response({"is_enabled": True, "types": wit.serialize_project_issue_types(project_id)})


class WorkItemTypeDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, type_id):
        issue_type = _issue_type_or_404(project_id, type_id)
        if issue_type is None:
            return Response({"error": "Work item type not found"}, status=status.HTTP_404_NOT_FOUND)
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return _bad_request({"name": "Name is required."})
            if wit.type_name_taken(project_id, name, exclude_id=issue_type.id):
                return _bad_request({"name": "A type with this name already exists in this project."})
            issue_type.name = name
        for key in ("description", "logo_props"):
            if key in request.data:
                setattr(issue_type, key, request.data.get(key) or ("" if key == "description" else {}))
        if "is_active" in request.data:
            if issue_type.is_default and not request.data["is_active"]:
                return _bad_request({"is_active": "The default type cannot be turned off."})
            issue_type.is_active = bool(request.data["is_active"])
        issue_type.updated_by = request.user
        issue_type.save()
        count = Issue.issue_objects.filter(project_id=project_id, type=issue_type).count()
        return Response(wit.serialize_issue_type(issue_type, project_id, count))

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, type_id):
        issue_type = _issue_type_or_404(project_id, type_id)
        if issue_type is None:
            return Response({"error": "Work item type not found"}, status=status.HTTP_404_NOT_FOUND)
        if issue_type.is_default:
            return _bad_request({"type": "The default type cannot be deleted."})
        wit.delete_issue_type(project_id, issue_type)
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkItemTypePropertyEndpoint(BaseAPIView):
    """Create a property in the pool and add it to this type."""

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, type_id):
        issue_type = _issue_type_or_404(project_id, type_id)
        if issue_type is None:
            return Response({"error": "Work item type not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            prop = wit.create_property(project_id, issue_type, request.user, request.data)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(wit.serialize_property(prop, issue_type.id), status=status.HTTP_201_CREATED)


class WorkItemTypePropertyLinkEndpoint(BaseAPIView):
    """Add existing pool properties to a type."""

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id, type_id):
        issue_type = _issue_type_or_404(project_id, type_id)
        if issue_type is None:
            return Response({"error": "Work item type not found"}, status=status.HTTP_404_NOT_FOUND)
        property_ids = request.data.get("property_ids") or []
        if not isinstance(property_ids, list) or not property_ids:
            return _bad_request({"property_ids": "Pick at least one property."})
        pool = wit.project_properties(project_id).filter(id__in=property_ids)
        if pool.count() != len(set(property_ids)):
            return _bad_request({"property_ids": "Some properties are not in this project."})
        wit.link_properties(issue_type, [p.id for p in pool], request.user)
        return Response(wit.serialize_issue_type(issue_type, project_id))


class WorkItemTypePropertyDetailEndpoint(BaseAPIView):
    """A property as used by one type: edit it, move it within the type, or take it off the type."""

    def _property(self, project_id, type_id, property_id):
        prop = wit.type_property(project_id, property_id)
        return prop if prop and wit.type_uses_property(type_id, prop.id) else None

    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, type_id, property_id):
        prop = self._property(project_id, type_id, property_id)
        if prop is None:
            return Response({"error": "Property not found"}, status=status.HTTP_404_NOT_FOUND)
        data = dict(request.data)
        issue_type = _issue_type_or_404(project_id, type_id)
        if "sort_order" in data:
            # the order is per type
            wit.move_property(issue_type, prop, data.pop("sort_order"))
        try:
            prop = wit.update_property(prop, request.user, data)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(wit.serialize_property(prop, type_id))

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, type_id, property_id):
        prop = self._property(project_id, type_id, property_id)
        if prop is None:
            return Response({"error": "Property not found"}, status=status.HTTP_404_NOT_FOUND)
        wit.unlink_property(_issue_type_or_404(project_id, type_id), prop)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectPropertyPoolEndpoint(BaseAPIView):
    """The project's property pool."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        props = wit.project_properties(project_id).order_by("sort_order", "created_at")
        return Response(wit.serialize_properties(props))

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        if not project.is_issue_type_enabled:
            return _bad_request({"project": "Turn on work item types for this project first."})
        try:
            prop = wit.create_property(project_id, None, request.user, request.data)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(wit.serialize_property(prop), status=status.HTTP_201_CREATED)


class ProjectPropertyPoolDetailEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN])
    def patch(self, request, slug, project_id, property_id):
        prop = wit.type_property(project_id, property_id)
        if prop is None:
            return Response({"error": "Property not found"}, status=status.HTTP_404_NOT_FOUND)
        try:
            prop = wit.update_property(prop, request.user, request.data)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(wit.serialize_property(prop))

    @allow_permission([ROLE.ADMIN])
    def delete(self, request, slug, project_id, property_id):
        """Delete the property everywhere, with every value stored in it."""
        prop = wit.type_property(project_id, property_id)
        if prop is None:
            return Response({"error": "Property not found"}, status=status.HTTP_404_NOT_FOUND)
        wit.delete_property(prop)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PropertyFromLabelsEndpoint(BaseAPIView):
    """Turn a label group into a dropdown property: GET lists label groups, POST previews or converts."""

    @allow_permission([ROLE.ADMIN])
    def get(self, request, slug, project_id):
        from plane.utils.label_conversion import label_groups

        return Response(label_groups(project_id))

    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        from plane.utils.label_conversion import LabelConversionError, convert

        dry_run = request.data.get("dry_run", True) is not False
        try:
            result = convert(project_id, request.user, request.data, dry_run=dry_run)
        except (LabelConversionError, wit.PropertyValueError) as e:
            return _bad_request(e.errors)
        return Response(result)


class IssuePropertyValueEndpoint(BaseAPIView):
    """Read and write a work item's custom property values."""

    def _issue(self, slug, project_id, issue_id):
        return Issue.all_objects.filter(workspace__slug=slug, project_id=project_id, id=issue_id).first()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, issue_id):
        issue = self._issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Work item not found"}, status=status.HTTP_404_NOT_FOUND)
        hidden = wit.hidden_property_ids(request.user, issue.workspace_id)
        return Response({k: v for k, v in wit.issue_property_values(issue).items() if k not in hidden})

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def put(self, request, slug, project_id, issue_id):
        issue = self._issue(slug, project_id, issue_id)
        if issue is None:
            return Response({"error": "Work item not found"}, status=status.HTTP_404_NOT_FOUND)
        values = request.data.get("values", {})
        check_required = bool(request.data.get("check_required", False))
        if check_required:
            values = wit.apply_default_values(issue, request.user, values)
        try:
            result = wit.save_issue_property_values(issue, values, request.user, check_required=check_required)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response(result)


class WorkspaceWorkItemTypeEndpoint(BaseAPIView):
    """Types used anywhere in the workspace, so a project can reuse one instead of re-creating it."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug):
        workspace = Workspace.objects.get(slug=slug)
        return Response(wit.workspace_issue_types(workspace.id))


class WorkItemTypeImportEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN])
    def post(self, request, slug, project_id):
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        type_ids = request.data.get("type_ids") or []
        if not isinstance(type_ids, list) or not type_ids:
            return _bad_request({"type_ids": "Pick at least one type."})
        imported, skipped = wit.import_issue_types(project, request.user, type_ids)
        return Response(
            {
                "imported": [t.name for t in imported],
                "skipped": skipped,
                "is_enabled": True,
                "types": wit.serialize_project_issue_types(project_id),
            }
        )


class WorkItemTypeBulkAssignEndpoint(BaseAPIView):
    """Move many work items to one type at a time (members can do this, like any edit)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        type_id = request.data.get("type_id")
        issue_ids = request.data.get("issue_ids") or []
        if not isinstance(issue_ids, list) or not issue_ids:
            return _bad_request({"issue_ids": "Pick at least one work item."})
        try:
            count = wit.bulk_assign_type(project_id, type_id, issue_ids, request.user)
        except wit.PropertyValueError as e:
            return _bad_request(e.errors)
        return Response({"updated": count})


class ProjectPropertyValuesEndpoint(BaseAPIView):
    """Custom property values of many work items at once (for list and spreadsheet columns)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        raw_ids = request.GET.get("issue_ids")
        issue_ids = None
        if raw_ids is not None:
            issue_ids = [i for i in raw_ids.split(",") if i]
            if len(issue_ids) > MAX_VALUE_BATCH:
                return _bad_request({"issue_ids": f"Ask for at most {MAX_VALUE_BATCH} work items at a time."})
            try:
                issue_ids = [str(uuid.UUID(i)) for i in issue_ids]
            except ValueError:
                return _bad_request({"issue_ids": "Work item ids must be UUIDs."})
        project = Project.objects.get(workspace__slug=slug, pk=project_id)
        hidden = wit.hidden_property_ids(request.user, project.workspace_id)
        values = wit.project_property_values(project_id, issue_ids)
        if hidden:
            values = {i: {k: v for k, v in props.items() if k not in hidden} for i, props in values.items()}
        return Response(values)


class PropertyRelationDetailsEndpoint(BaseAPIView):
    """Identifier and title of work items referenced by relation properties (only projects the user is in)."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id):
        ids = [i for i in (request.GET.get("ids") or "").split(",") if i][:200]
        issues = (
            Issue.issue_objects.filter(
                workspace__slug=slug,
                id__in=ids,
                project__project_projectmember__member=request.user,
                project__project_projectmember__is_active=True,
            )
            .select_related("project")
            .distinct()
        )
        return Response(
            [
                {
                    "id": str(i.id),
                    "name": i.name,
                    "sequence_id": i.sequence_id,
                    "project_id": str(i.project_id),
                    "project_identifier": i.project.identifier,
                }
                for i in issues
            ]
        )
