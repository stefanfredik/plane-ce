# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Rich filter conditions on work item custom properties.

Keys look like ``customproperty_<property uuid>__<lookup>``; the property's
type decides which lookups are allowed and which value column is compared:

    OPTION / CASCADING   in / exact               option ids (a first-level cascading
                                                  option also matches its children)
    MEMBER               in / exact               user ids
    CUSTOMER             in / exact               customer ids
    BOOLEAN              in / exact               "true" / "false"
    DATE                 exact / range            YYYY-MM-DD, range as "from,to" (inclusive)
    NUMBER / FORMULA     exact / gte / lte / range numbers, range as "from,to"
    text kinds           icontains / exact        text (case-insensitive)

Each condition is a subquery on the value table, so conditions on different
properties combine correctly with and/or/not.
"""

# Python imports
import re
import uuid
from datetime import date
from decimal import Decimal, InvalidOperation

# Django imports
from django.db.models import Q

# Third party imports
from rest_framework.exceptions import ValidationError as DRFValidationError

CUSTOM_PROPERTY_KEY = re.compile(r"^customproperty_(?P<property_id>[0-9a-fA-F-]{36})__(?P<lookup>[a-z]+)$")

_TEXT_KINDS = {"TEXT", "PARAGRAPH", "URL", "EMAIL", "RICH_TEXT"}
_NUMBER_KINDS = {"NUMBER", "FORMULA"}
_ALLOWED = {
    "OPTION": {"in", "exact"},
    "CASCADING": {"in", "exact"},
    "MEMBER": {"in", "exact"},
    "CUSTOMER": {"in", "exact"},
    "BOOLEAN": {"in", "exact"},
    "DATE": {"exact", "range"},
    **{kind: {"exact", "gte", "lte", "range"} for kind in _NUMBER_KINDS},
    **{kind: {"icontains", "exact"} for kind in _TEXT_KINDS},
}


def is_custom_property_key(key):
    return bool(CUSTOM_PROPERTY_KEY.match(str(key)))


def _invalid(message):
    return DRFValidationError({"message": message, "code": "invalid_custom_property_filter"})


def _as_list(value):
    if isinstance(value, (list, tuple)):
        items = value
    else:
        items = str(value).split(",")
    return [str(v).strip() for v in items if str(v).strip()]


def _uuids(values):
    try:
        return [uuid.UUID(v) for v in values]
    except ValueError:
        raise _invalid("Expected ids in a custom property filter")


def _numbers(values):
    try:
        numbers = [Decimal(v) for v in values]
    except InvalidOperation:
        raise _invalid("Expected numbers in a custom property filter")
    if not all(n.is_finite() for n in numbers):
        raise _invalid("Expected numbers in a custom property filter")
    return numbers


def _dates(values):
    try:
        return [date.fromisoformat(v[:10]) for v in values]
    except ValueError:
        raise _invalid("Expected YYYY-MM-DD dates in a custom property filter")


def custom_property_q(key, value):
    """The Q for one ``customproperty_<id>__<lookup>`` condition."""
    from plane.db.models import IssueProperty, IssuePropertyValue

    match = CUSTOM_PROPERTY_KEY.match(str(key))
    if not match:
        raise _invalid(f"Unknown filter '{key}'")
    prop = IssueProperty.objects.filter(id=match["property_id"]).first()
    if prop is None:
        raise _invalid("Unknown custom property in filter")
    lookup = match["lookup"]
    if lookup not in _ALLOWED.get(prop.property_type, set()):
        raise _invalid(f"'{lookup}' is not supported for {prop.display_name}")

    # Text is matched as typed, commas included.
    values = [str(value).strip()] if prop.property_type in _TEXT_KINDS else _as_list(value)
    if not values or values == [""]:
        return Q()
    rows = IssuePropertyValue.objects.filter(property=prop, deleted_at__isnull=True)
    if prop.property_type in _TEXT_KINDS:
        lookup_name = "value_text__icontains" if lookup == "icontains" else "value_text__iexact"
        rows = rows.filter(**{lookup_name: values[0]})
    elif prop.property_type in _NUMBER_KINDS:
        numbers = _numbers(values)
        if lookup == "range":
            if len(numbers) != 2:
                raise _invalid("A number range needs a minimum and a maximum")
            rows = rows.filter(value_number__range=(min(numbers), max(numbers)))
        else:
            rows = rows.filter(**{"value_number" if lookup == "exact" else f"value_number__{lookup}": numbers[0]})
    elif prop.property_type == "CASCADING":
        ids = _uuids(values)
        rows = rows.filter(Q(value_option_id__in=ids) | Q(value_option__parent_id__in=ids))
    elif prop.property_type == "OPTION":
        rows = rows.filter(value_option_id__in=_uuids(values))
    elif prop.property_type == "MEMBER":
        rows = rows.filter(value_member_id__in=_uuids(values))
    elif prop.property_type == "CUSTOMER":
        rows = rows.filter(value_customer_id__in=_uuids(values))
    elif prop.property_type == "BOOLEAN":
        wanted = {v.lower() for v in values}
        if not wanted <= {"true", "false"}:
            raise _invalid("Expected true or false")
        if wanted == {"false"}:
            # "No" also covers work items where the box was never ticked.
            return ~Q(id__in=rows.filter(value_boolean=True).values("issue_id"))
        rows = rows.filter(value_boolean__in=[v == "true" for v in wanted])
    elif prop.property_type == "DATE":
        days = _dates(values)
        if lookup == "range":
            if len(days) != 2:
                raise _invalid("A date range needs a start and an end")
            rows = rows.filter(value_date__range=(min(days), max(days)))
        else:
            rows = rows.filter(value_date=days[0])
    return Q(id__in=rows.values("issue_id"))


# ---------------------------------------------------------------------------
# Grouping and ordering work item lists by a custom property
# ---------------------------------------------------------------------------

CUSTOM_PROPERTY_FIELD = re.compile(r"^(?P<desc>-?)customproperty_(?P<property_id>[0-9a-fA-F-]{36})$")
GROUP_FIELD_NAME = "custom_property_group"
SORT_FIELD_NAME = "custom_property_sort"
GROUPABLE_KINDS = {"OPTION", "CASCADING", "MEMBER", "BOOLEAN", "CUSTOMER"}
SORTABLE_KINDS = {
    "NUMBER",
    "FORMULA",
    "DATE",
    "TEXT",
    "EMAIL",
    "URL",
    "OPTION",
    "CASCADING",
    "MEMBER",
    "BOOLEAN",
    "CUSTOMER",
}


def _property_for(value, project_id, kinds):
    from plane.utils.work_item_types import project_properties

    match = CUSTOM_PROPERTY_FIELD.match(str(value or ""))
    if not match:
        return None, False
    prop = (
        project_properties(project_id).filter(id=match["property_id"], property_type__in=kinds, is_active=True).first()
    )
    return prop, bool(match["desc"])


def custom_property_grouping(project_id, group_by):
    """For ``group_by=customproperty_<id>``: (annotation, field name, group keys), else None.

    Only single-value dropdown, cascading, member and yes/no properties group work items;
    items without a value land in "None" ("false" for yes/no).
    """
    from django.db.models import CharField, OuterRef, Subquery, Value
    from django.db.models.functions import Cast, Coalesce

    from plane.db.models import IssuePropertyOption, IssuePropertyValue, ProjectMember

    prop, _desc = _property_for(group_by, project_id, GROUPABLE_KINDS)
    if prop is None or prop.is_multi:
        return None
    column = {
        "OPTION": "value_option_id",
        "CASCADING": "value_option_id",
        "MEMBER": "value_member_id",
        "CUSTOMER": "value_customer_id",
        "BOOLEAN": "value_boolean",
    }[prop.property_type]
    value = Subquery(
        IssuePropertyValue.objects.filter(issue_id=OuterRef("pk"), property=prop, deleted_at__isnull=True)
        .annotate(as_text=Cast(column, CharField()))
        .values("as_text")[:1]
    )
    empty = "false" if prop.property_type == "BOOLEAN" else "None"
    annotation = {GROUP_FIELD_NAME: Coalesce(value, Value(empty), output_field=CharField())}

    if prop.property_type == "BOOLEAN":
        keys = ["true", "false"]
    elif prop.property_type == "MEMBER":
        keys = [
            str(m)
            for m in ProjectMember.objects.filter(project_id=project_id, is_active=True).values_list(
                "member_id", flat=True
            )
        ] + ["None"]
    elif prop.property_type == "CUSTOMER":
        # only customers actually chosen in the project, so thousands of customers do not mean thousands of groups
        chosen = (
            IssuePropertyValue.objects.filter(property=prop, issue__project_id=project_id, value_customer__isnull=False)
            .values_list("value_customer_id", "value_customer__name")
            .distinct()
            .order_by("value_customer__name")
        )
        keys = [str(customer_id) for customer_id, _name in chosen] + ["None"]
    else:
        options = IssuePropertyOption.objects.filter(property=prop, deleted_at__isnull=True)
        if prop.property_type == "CASCADING":
            # values are leaves: second-level options, or first-level ones without children
            options = options.exclude(children__deleted_at__isnull=True, children__isnull=False)
        keys = [str(o) for o in options.order_by("sort_order").values_list("id", flat=True)] + ["None"]
    return annotation, GROUP_FIELD_NAME, keys


def custom_property_ordering(queryset, order_by_param, project_id):
    """For ``order_by=[-]customproperty_<id>``: (ordered queryset, paginator order field), else None."""
    from django.db.models import F, OuterRef, Subquery

    from plane.db.models import IssuePropertyValue

    prop, desc = _property_for(order_by_param, project_id, SORTABLE_KINDS)
    if prop is None:
        return None
    column = {
        "NUMBER": "value_number",
        "FORMULA": "value_number",
        "DATE": "value_date",
        "BOOLEAN": "value_boolean",
        "OPTION": "value_option__sort_order",
        "CASCADING": "value_option__sort_order",
        "MEMBER": "value_member__display_name",
        "CUSTOMER": "value_customer__name",
    }.get(prop.property_type, "value_text")
    rows = IssuePropertyValue.objects.filter(issue_id=OuterRef("pk"), property=prop, deleted_at__isnull=True)
    queryset = queryset.annotate(**{SORT_FIELD_NAME: Subquery(rows.values(column)[:1])})
    ordering = F(SORT_FIELD_NAME).desc(nulls_last=True) if desc else F(SORT_FIELD_NAME).asc(nulls_last=True)
    return queryset.order_by(ordering, "-created_at"), (f"-{SORT_FIELD_NAME}" if desc else SORT_FIELD_NAME)
