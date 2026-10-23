/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import type { IIssueDisplayProperties } from "@plane/types";
// hooks
import { useUserPermissions } from "@/hooks/store/user";

export const customPropertyDisplayKey = (propertyId: string) => `customproperty_${propertyId}` as const;

/** Custom properties are shown unless their display switch was turned off. */
export const isCustomPropertyShown = (displayProperties: IIssueDisplayProperties | undefined, propertyId: string) =>
  displayProperties?.[customPropertyDisplayKey(propertyId)] !== false;

/** Guests cannot see customers, so customer properties are left out for them. */
export const useCanSeeCustomers = () => {
  const { allowPermissions } = useUserPermissions();
  return allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
};

/** Drop customer properties when the viewer may not see customers. */
export const visibleToViewer = <T extends { property_type: string }>(properties: T[], canSeeCustomers: boolean) =>
  canSeeCustomers ? properties : properties.filter((property) => property.property_type !== "CUSTOMER");
