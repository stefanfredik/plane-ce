/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCustomer, TCustomerProperty, TCustomerPropertyType } from "@/services/customer.service";
import type { TWorkItemProperty } from "@/services/work-item-type.service";

export const CUSTOMER_PROPERTY_TYPES: TCustomerPropertyType[] = [
  "TEXT",
  "PARAGRAPH",
  "NUMBER",
  "OPTION",
  "BOOLEAN",
  "DATE",
  "URL",
  "EMAIL",
  "MEMBER",
];

export const CUSTOMER_MULTI_TYPES: TCustomerPropertyType[] = ["OPTION", "MEMBER"];

/** Contract status choices for a customer. */
export const CUSTOMER_CONTRACT_STATUSES = ["Active", "Pre contract", "Signed", "Inactive"];

export const errorMessage = (error: unknown, fallback: string) => {
  const data = error as { errors?: Record<string, unknown>; error?: string } | undefined;
  if (data?.errors) return Object.values(data.errors).map(String).join(" ");
  return data?.error ?? fallback;
};

/** Customer properties share the work item property editor; MEMBER without a project lists workspace members. */
export const asFieldProperty = (property: TCustomerProperty): TWorkItemProperty => ({
  ...property,
  issue_type_id: "",
  default_value: [],
  settings: {},
  options: property.options.map((o) => ({ ...o, is_active: true })),
});

export const customerInitial = (customer: Pick<TCustomer, "name">) => customer.name.trim().charAt(0).toUpperCase();
