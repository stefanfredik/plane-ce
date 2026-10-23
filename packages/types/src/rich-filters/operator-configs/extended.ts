/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TFilterValue } from "../expression";
import type { TNumberFilterFieldConfig, TTextFilterFieldConfig } from "../field-types/extended";

// ----------------------------- EXACT Operator -----------------------------
export type TExtendedExactOperatorConfigs =
  | TTextFilterFieldConfig<TFilterValue>
  | TNumberFilterFieldConfig<TFilterValue>;

// ----------------------------- IN Operator -----------------------------
export type TExtendedInOperatorConfigs = never;

// ----------------------------- RANGE Operator -----------------------------
export type TExtendedRangeOperatorConfigs = never;

// ----------------------------- Extended Operator Specific Configs -----------------------------
export type TExtendedOperatorSpecificConfigs = {
  icontains: TTextFilterFieldConfig<TFilterValue>;
  gte: TNumberFilterFieldConfig<TFilterValue>;
  lte: TNumberFilterFieldConfig<TFilterValue>;
};
