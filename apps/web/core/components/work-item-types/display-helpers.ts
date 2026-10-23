/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { IIssueDisplayProperties } from "@plane/types";

export const customPropertyDisplayKey = (propertyId: string) => `customproperty_${propertyId}` as const;

/** Custom properties are shown unless their display switch was turned off. */
export const isCustomPropertyShown = (displayProperties: IIssueDisplayProperties | undefined, propertyId: string) =>
  displayProperties?.[customPropertyDisplayKey(propertyId)] !== false;
