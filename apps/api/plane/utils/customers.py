# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Customers: organisations the workspace serves, their custom fields, requests and linked work items.

Shared by the web app API and the public v1 API. Property values travel as a
map of property id -> list of strings, like work item properties.
"""

# Python imports
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

# Django imports
from django.db import IntegrityError, transaction
from django.db.models import Count, IntegerField, Max, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce

# Module imports
from plane.db.models import (
    Customer,
    CustomerIssue,
    CustomerProperty,
    CustomerPropertyOption,
    CustomerPropertyValue,
    CustomerRequest,
    Issue,
    WorkspaceMember,
)
from plane.utils.content_validator import validate_html_content

PROPERTY_TYPES = {"TEXT", "PARAGRAPH", "NUMBER", "OPTION", "BOOLEAN", "DATE", "URL", "EMAIL", "MEMBER"}
MULTI_TYPES = {"OPTION", "MEMBER"}
CUSTOMER_FIELDS = (
    "name",
    "description_html",
    "email",
    "website_url",
    "domain",
    "employees",
    "stage",
    "contract_status",
    "revenue",
    "logo_props",
    "external_source",
    "external_id",
)
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class CustomerError(Exception):
    def __init__(self, errors):
        super().__init__("Invalid customer data")
        self.errors = errors


# ---------------------------------------------------------------------------
# customers
# ---------------------------------------------------------------------------


def visible_issue_q(user):
    """Work items in projects the user is an active member of."""
    return Q(
        project__project_projectmember__member=user,
        project__project_projectmember__is_active=True,
        project__archived_at__isnull=True,
    )


def visible_project_ids(user):
    """Projects whose work items the user may see (active member, project not archived)."""
    from plane.db.models import ProjectMember

    return list(
        ProjectMember.objects.filter(member=user, is_active=True, project__archived_at__isnull=True).values_list(
            "project_id", flat=True
        )
    )


def with_counts(customers, user=None):
    """Annotate request and visible work item counts in SQL, so lists do not query per customer."""
    requests = (
        CustomerRequest.objects.filter(customer=OuterRef("pk")).values("customer").annotate(n=Count("id")).values("n")
    )
    # same rules as Issue.issue_objects (no drafts, archived, triage or deleted items)
    visible = Issue.issue_objects.all()
    if user is not None:
        visible = visible.filter(project_id__in=visible_project_ids(user))
    links = CustomerIssue.objects.filter(customer=OuterRef("pk"), issue__in=visible.values("id"))
    items = links.values("customer").annotate(n=Count("issue_id", distinct=True)).values("n")
    return customers.annotate(
        request_count=Coalesce(Subquery(requests, output_field=IntegerField()), Value(0)),
        visible_item_count=Coalesce(Subquery(items, output_field=IntegerField()), Value(0)),
    )


def serialize_customer(customer, user=None):
    if not hasattr(customer, "visible_item_count"):
        customer = with_counts(Customer.objects.filter(pk=customer.pk), user).first()
    return {
        "id": str(customer.id),
        "name": customer.name,
        "description_html": customer.description_html,
        "email": customer.email,
        "website_url": customer.website_url,
        "domain": customer.domain,
        "employees": customer.employees,
        "stage": customer.stage,
        "contract_status": customer.contract_status,
        "revenue": customer.revenue,
        "logo_props": customer.logo_props or {},
        "archived_at": customer.archived_at.isoformat() if customer.archived_at else None,
        "external_source": customer.external_source,
        "external_id": customer.external_id,
        "customer_request_count": customer.request_count,
        "work_item_count": customer.visible_item_count,
        "workspace": str(customer.workspace_id),
        "created_at": customer.created_at.isoformat(),
        "updated_at": customer.updated_at.isoformat(),
    }


def _clean_customer(data, partial=False):
    errors, clean = {}, {}
    for key in CUSTOMER_FIELDS:
        if key in data:
            clean[key] = data[key]
    if not partial or "name" in clean:
        name = str(clean.get("name") or "").strip()
        if not name:
            errors["name"] = "Name is required."
        clean["name"] = name[:255]
    if clean.get("email"):
        if not EMAIL_PATTERN.match(str(clean["email"]).strip()):
            errors["email"] = "Enter a valid email address."
        clean["email"] = str(clean["email"]).strip().lower()
    if clean.get("website_url"):
        parsed = urlparse(str(clean["website_url"]))
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            errors["website_url"] = "Enter an http(s) link."
    if clean.get("employees") not in (None, ""):
        try:
            clean["employees"] = max(0, int(clean["employees"]))
        except (TypeError, ValueError):
            errors["employees"] = "Employees must be a number."
    elif "employees" in clean:
        clean["employees"] = None
    if clean.get("description_html"):
        ok, _msg, sanitized = validate_html_content(clean["description_html"])
        if not ok:
            errors["description_html"] = "The description contains content that is not allowed."
        elif sanitized is not None:
            clean["description_html"] = sanitized
    for key in ("stage", "contract_status", "revenue", "domain"):
        if key in clean and clean[key] is not None:
            clean[key] = str(clean[key]).strip()[:255] or None
    if errors:
        raise CustomerError(errors)
    return clean


def create_customer(workspace_id, user, data):
    clean = _clean_customer(data)
    try:
        with transaction.atomic():
            return Customer.objects.create(workspace_id=workspace_id, created_by=user, updated_by=user, **clean)
    except IntegrityError:
        raise CustomerError({"name": "A customer with this name already exists."})


def update_customer(customer, user, data):
    clean = _clean_customer(data, partial=True)
    for key, value in clean.items():
        setattr(customer, key, value)
    if "archived" in data:
        from django.utils import timezone

        customer.archived_at = timezone.now() if data["archived"] else None
    customer.updated_by = user
    try:
        with transaction.atomic():
            customer.save()
    except IntegrityError:
        raise CustomerError({"name": "A customer with this name already exists."})
    return customer


@transaction.atomic
def delete_customer(customer):
    CustomerIssue.objects.filter(customer=customer).delete(soft=False)
    CustomerPropertyValue.objects.filter(customer=customer).delete(soft=False)
    CustomerRequest.objects.filter(customer=customer).delete()
    customer.delete()


# ---------------------------------------------------------------------------
# properties
# ---------------------------------------------------------------------------


def serialize_property(prop):
    return {
        "id": str(prop.id),
        "display_name": prop.display_name,
        "name": prop.display_name,
        "description": prop.description,
        "property_type": prop.property_type,
        "is_multi": prop.is_multi,
        "is_required": prop.is_required,
        "is_active": prop.is_active,
        "sort_order": prop.sort_order,
        "settings": prop.settings or {},
        "logo_props": prop.logo_props or {},
        "options": [
            {
                "id": str(o.id),
                "name": o.name,
                "description": o.description,
                "color": o.color,
                "sort_order": o.sort_order,
                "is_default": o.is_default,
                "is_active": o.is_active,
            }
            for o in prop.options.all()
        ],
    }


def _sync_options(prop, options, user):
    keep = []
    for index, raw in enumerate(options or []):
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        option = (
            CustomerPropertyOption.objects.filter(property=prop, id=raw.get("id")).first() if raw.get("id") else None
        )
        fields = {
            "name": name[:255],
            "description": raw.get("description") or "",
            "color": raw.get("color") or "",
            "sort_order": raw.get("sort_order") or (index + 1) * 10000,
            "is_default": bool(raw.get("is_default")),
            "is_active": raw.get("is_active") is not False,
        }
        if option:
            for key, value in fields.items():
                setattr(option, key, value)
            option.save()
        else:
            option = CustomerPropertyOption.objects.create(
                workspace_id=prop.workspace_id, property=prop, created_by=user, updated_by=user, **fields
            )
        keep.append(option.id)
    removed = CustomerPropertyOption.objects.filter(property=prop).exclude(id__in=keep)
    CustomerPropertyValue.objects.filter(value_option__in=removed).delete(soft=False)
    removed.delete()


def _clean_property(data, prop=None):
    errors = {}
    ptype = prop.property_type if prop else data.get("property_type")
    if ptype not in PROPERTY_TYPES:
        errors["property_type"] = "Unknown property type."
    if prop and "property_type" in data and data["property_type"] != prop.property_type:
        errors["property_type"] = "The type of an existing property cannot change."
    name = str(data.get("display_name", getattr(prop, "display_name", "")) or "").strip()
    if not name:
        errors["display_name"] = "Name is required."
    is_multi = bool(data.get("is_multi", getattr(prop, "is_multi", False)))
    if is_multi and ptype not in MULTI_TYPES:
        errors["is_multi"] = "Only dropdown and member properties can hold several values."
    if (
        ptype == "OPTION"
        and prop is None
        and not [o for o in data.get("options") or [] if str(o.get("name") or "").strip()]
    ):
        errors["options"] = "A dropdown needs at least one option."
    if errors:
        raise CustomerError(errors)
    return name[:255], is_multi


@transaction.atomic
def create_property(workspace_id, user, data):
    name, is_multi = _clean_property(data)
    if CustomerProperty.objects.filter(workspace_id=workspace_id, display_name__iexact=name).exists():
        raise CustomerError({"display_name": "A property with this name already exists."})
    last = CustomerProperty.objects.filter(workspace_id=workspace_id).aggregate(m=Max("sort_order"))["m"] or 0
    prop = CustomerProperty.objects.create(
        workspace_id=workspace_id,
        display_name=name,
        description=data.get("description") or "",
        property_type=data["property_type"],
        is_multi=is_multi,
        is_required=bool(data.get("is_required")),
        is_active=data.get("is_active", True),
        sort_order=data.get("sort_order") or last + 10000,
        settings=data.get("settings") or {},
        logo_props=data.get("logo_props") or {},
        external_source=data.get("external_source"),
        external_id=data.get("external_id"),
        created_by=user,
        updated_by=user,
    )
    if prop.property_type == "OPTION":
        _sync_options(prop, data.get("options"), user)
    return prop


@transaction.atomic
def update_property(prop, user, data):
    name, is_multi = _clean_property(data, prop)
    if (
        CustomerProperty.objects.filter(workspace_id=prop.workspace_id, display_name__iexact=name)
        .exclude(id=prop.id)
        .exists()
    ):
        raise CustomerError({"display_name": "A property with this name already exists."})
    prop.display_name = name
    prop.is_multi = is_multi
    for key in ("description", "is_required", "is_active", "sort_order", "settings", "logo_props"):
        if key in data:
            setattr(prop, key, data[key])
    prop.updated_by = user
    prop.save()
    if prop.property_type == "OPTION" and "options" in data:
        _sync_options(prop, data["options"], user)
    return prop


@transaction.atomic
def delete_property(prop):
    CustomerPropertyValue.objects.filter(property=prop).delete(soft=False)
    CustomerPropertyOption.objects.filter(property=prop).delete()
    prop.delete()


# ---------------------------------------------------------------------------
# property values
# ---------------------------------------------------------------------------


def _row_value(row, ptype):
    if ptype in ("TEXT", "PARAGRAPH", "URL", "EMAIL"):
        return row.value_text
    if ptype == "NUMBER":
        return None if row.value_number is None else format(row.value_number.normalize(), "f")
    if ptype == "BOOLEAN":
        return None if row.value_boolean is None else ("true" if row.value_boolean else "false")
    if ptype == "DATE":
        return row.value_date.isoformat() if row.value_date else None
    if ptype == "OPTION":
        return str(row.value_option_id) if row.value_option_id else None
    if ptype == "MEMBER":
        return str(row.value_member_id) if row.value_member_id else None
    return None


def property_values(customer):
    props = {p.id: p for p in CustomerProperty.objects.filter(workspace_id=customer.workspace_id)}
    result = {str(pid): [] for pid in props}
    for row in CustomerPropertyValue.objects.filter(customer=customer).order_by("created_at"):
        prop = props.get(row.property_id)
        value = _row_value(row, prop.property_type) if prop else None
        if value is not None:
            result[str(row.property_id)].append(value)
    return result


def _normalise(prop, raw, workspace_id):
    items = raw if isinstance(raw, list) else ([] if raw in (None, "") else [raw])
    items = [str(v).strip() for v in items if v is not None and str(v).strip() != ""]
    if len(items) > 1 and not prop.is_multi:
        raise CustomerError({str(prop.id): f"{prop.display_name} takes a single value."})
    clean = []
    for text in items:
        if prop.property_type == "NUMBER":
            try:
                number = Decimal(text)
                if not number.is_finite():
                    raise InvalidOperation
            except InvalidOperation:
                raise CustomerError({str(prop.id): f"{prop.display_name} must be a number."})
            text = format(number.normalize(), "f")
        elif prop.property_type == "BOOLEAN":
            if text.lower() not in ("true", "false"):
                raise CustomerError({str(prop.id): f"{prop.display_name} must be true or false."})
            text = text.lower()
        elif prop.property_type == "DATE":
            try:
                date.fromisoformat(text)
            except ValueError:
                raise CustomerError({str(prop.id): f"{prop.display_name} must be a date (YYYY-MM-DD)."})
        elif prop.property_type == "URL":
            parsed = urlparse(text)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise CustomerError({str(prop.id): f"{prop.display_name} must be an http(s) link."})
        elif prop.property_type == "EMAIL":
            if not EMAIL_PATTERN.match(text):
                raise CustomerError({str(prop.id): f"{prop.display_name} must be an email address."})
            text = text.lower()
        elif prop.property_type in ("TEXT", "PARAGRAPH"):
            limit = 255 if prop.property_type == "TEXT" else 10000
            if len(text) > limit:
                raise CustomerError({str(prop.id): f"{prop.display_name} is limited to {limit} characters."})
        elif prop.property_type == "OPTION":
            if not CustomerPropertyOption.objects.filter(property=prop, id=text, is_active=True).exists():
                raise CustomerError({str(prop.id): f"Unknown option for {prop.display_name}."})
        elif prop.property_type == "MEMBER":
            if not WorkspaceMember.objects.filter(workspace_id=workspace_id, member_id=text, is_active=True).exists():
                raise CustomerError({str(prop.id): f"{prop.display_name} must be a workspace member."})
        if text not in clean:
            clean.append(text)
    return clean


def _fields(ptype, text):
    if ptype in ("TEXT", "PARAGRAPH", "URL", "EMAIL"):
        return {"value_text": text}
    if ptype == "NUMBER":
        return {"value_number": Decimal(text)}
    if ptype == "BOOLEAN":
        return {"value_boolean": text == "true"}
    if ptype == "DATE":
        return {"value_date": date.fromisoformat(text)}
    if ptype == "OPTION":
        return {"value_option_id": text}
    return {"value_member_id": text}


@transaction.atomic
def save_property_values(customer, values, user):
    if not isinstance(values, dict):
        raise CustomerError({"values": "Expected an object of property id to values."})
    props = {str(p.id): p for p in CustomerProperty.objects.filter(workspace_id=customer.workspace_id, is_active=True)}
    errors, clean = {}, {}
    for key, raw in values.items():
        prop = props.get(str(key))
        if prop is None:
            errors[str(key)] = "Unknown customer property."
            continue
        try:
            clean[prop] = _normalise(prop, raw, customer.workspace_id)
        except CustomerError as e:
            errors.update(e.errors)
        if prop.is_required and not clean.get(prop):
            errors.setdefault(str(prop.id), f"{prop.display_name} is required.")
    if errors:
        raise CustomerError(errors)
    for prop, items in clean.items():
        CustomerPropertyValue.objects.filter(customer=customer, property=prop).delete(soft=False)
        CustomerPropertyValue.objects.bulk_create(
            [
                CustomerPropertyValue(
                    workspace_id=customer.workspace_id,
                    customer=customer,
                    property=prop,
                    created_by=user,
                    updated_by=user,
                    **_fields(prop.property_type, text),
                )
                for text in items
            ]
        )
    return property_values(customer)


# ---------------------------------------------------------------------------
# requests and linked work items
# ---------------------------------------------------------------------------


def serialize_request(request, user=None):
    links = request.request_issues.filter(issue__deleted_at__isnull=True)
    if user is not None:
        links = links.filter(issue__in=Issue.issue_objects.filter(visible_issue_q(user)))
    return {
        "id": str(request.id),
        "customer_id": str(request.customer_id),
        "name": request.name,
        "description_html": request.description_html,
        "link": request.link,
        "work_item_ids": [str(i) for i in links.values_list("issue_id", flat=True)],
        "external_source": request.external_source,
        "external_id": request.external_id,
        "created_at": request.created_at.isoformat(),
        "updated_at": request.updated_at.isoformat(),
    }


def serialize_work_item(issue):
    return {
        "id": str(issue.id),
        "name": issue.name,
        "state_id": str(issue.state_id) if issue.state_id else None,
        "state_name": issue.state.name if issue.state else None,
        "state_group": issue.state.group if issue.state else None,
        "state_color": issue.state.color if issue.state else None,
        "priority": issue.priority,
        "sequence_id": issue.sequence_id,
        "project_id": str(issue.project_id),
        "project__identifier": issue.project.identifier,
        "created_at": issue.created_at.isoformat(),
        "updated_at": issue.updated_at.isoformat(),
    }


def _clean_request(data, partial=False):
    clean, errors = {}, {}
    for key in ("name", "description_html", "link", "external_source", "external_id"):
        if key in data:
            clean[key] = data[key]
    if not partial or "name" in clean:
        name = str(clean.get("name") or "").strip()
        if not name:
            errors["name"] = "Name is required."
        clean["name"] = name[:255]
    if clean.get("link"):
        parsed = urlparse(str(clean["link"]))
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            errors["link"] = "Enter an http(s) link."
    if clean.get("description_html"):
        ok, _msg, sanitized = validate_html_content(clean["description_html"])
        if not ok:
            errors["description_html"] = "The description contains content that is not allowed."
        elif sanitized is not None:
            clean["description_html"] = sanitized
    if errors:
        raise CustomerError(errors)
    return clean


def _linkable_issues(customer, user, issue_ids):
    """Work items of this workspace the user can see; anything else rejects the call."""
    ids = [str(i) for i in issue_ids or []]
    issues = list(
        Issue.issue_objects.filter(visible_issue_q(user), workspace_id=customer.workspace_id, id__in=ids).distinct()
    )
    if len({str(i.id) for i in issues}) != len(set(ids)):
        raise CustomerError({"issue_ids": "Some work items do not exist or are not visible to you."})
    return issues


@transaction.atomic
def link_issues(customer, user, issue_ids, request=None):
    issues = _linkable_issues(customer, user, issue_ids)
    for issue in issues:
        CustomerIssue.objects.get_or_create(
            customer=customer,
            issue=issue,
            customer_request=request,
            defaults={"workspace_id": customer.workspace_id, "created_by": user, "updated_by": user},
        )
    return issues


@transaction.atomic
def unlink_issue(customer, issue_id, request=None):
    links = CustomerIssue.objects.filter(customer=customer, issue_id=issue_id)
    if request is not None:
        links = links.filter(customer_request=request)
    links.delete(soft=False)


@transaction.atomic
def create_request(customer, user, data):
    clean = _clean_request(data)
    request = CustomerRequest.objects.create(
        workspace_id=customer.workspace_id, customer=customer, created_by=user, updated_by=user, **clean
    )
    if data.get("work_item_ids"):
        link_issues(customer, user, data["work_item_ids"], request)
    return request


@transaction.atomic
def update_request(request, user, data):
    clean = _clean_request(data, partial=True)
    for key, value in clean.items():
        setattr(request, key, value)
    request.updated_by = user
    request.save()
    if "work_item_ids" in data:
        wanted = {str(i) for i in data["work_item_ids"] or []}
        current = {str(i) for i in request.request_issues.values_list("issue_id", flat=True)}
        request.request_issues.filter(issue_id__in=current - wanted).delete(soft=False)
        if wanted - current:
            link_issues(request.customer, user, list(wanted - current), request)
    return request


def customer_work_items(customer, user, search=None):
    issues = (
        Issue.issue_objects.filter(
            visible_issue_q(user), customer_links__customer=customer, customer_links__deleted_at__isnull=True
        )
        .select_related("project", "state")
        .distinct()
        .order_by("-created_at")
    )
    if search:
        issues = issues.filter(Q(name__icontains=search) | Q(sequence_id__icontains=search.split("-")[-1]))
    return issues


def issue_customers(issue):
    rows = (
        CustomerIssue.objects.filter(issue=issue, customer__deleted_at__isnull=True)
        .values("customer_id", "customer__name", "customer__logo_props")
        .annotate(requests=Count("customer_request", distinct=True))
    )
    return [
        {
            "id": str(r["customer_id"]),
            "name": r["customer__name"],
            "logo_props": r["customer__logo_props"] or {},
            "request_count": r["requests"],
        }
        for r in rows
    ]
