/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useParams } from "next/navigation";
// plane imports
import type { TIssueGroupByOptions, TIssueOrderByOptions } from "@plane/types";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useCanSeeCustomers } from "./display-helpers";

const GROUPABLE = new Set(["OPTION", "CASCADING", "MEMBER", "BOOLEAN", "CUSTOMER"]);
const SORTABLE = new Set([
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
]);

/** Group-by and order-by choices for the current project's custom properties (project pages only). */
export const useCustomPropertyDisplayOptions = () => {
  const { projectId } = useParams();
  const store = useWorkItemType();
  const canSeeCustomers = useCanSeeCustomers();
  const project = projectId?.toString();
  if (!project || !store.isEnabled(project)) return { groupBy: [], orderBy: [] };

  // once per property, even when several types share it
  const properties = store
    .getProjectPropertyColumns(project)
    .filter(({ property }) => canSeeCustomers || property.property_type !== "CUSTOMER")
    .map(({ property }) => ({ property, title: property.display_name }));
  return {
    groupBy: properties
      .filter(({ property }) => GROUPABLE.has(property.property_type) && !property.is_multi)
      .map(({ property, title }) => ({ key: `customproperty_${property.id}` as TIssueGroupByOptions, title })),
    orderBy: properties
      .filter(({ property }) => SORTABLE.has(property.property_type))
      .flatMap(({ property, title }) => [
        { key: `customproperty_${property.id}` as TIssueOrderByOptions, title: `${title} ↑` },
        { key: `-customproperty_${property.id}` as TIssueOrderByOptions, title: `${title} ↓` },
      ]),
  };
};
