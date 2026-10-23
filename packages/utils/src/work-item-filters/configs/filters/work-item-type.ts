/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import type { TFilterProperty, TSupportedOperators } from "@plane/types";
import { COLLECTION_OPERATOR, COMPARISON_OPERATOR, EQUALITY_OPERATOR, FILTER_FIELD_TYPE } from "@plane/types";
// local imports
import type {
  IFilterIconConfig,
  TCreateDateFilterParams,
  TCreateFilterConfig,
  TCreateFilterConfigParams,
  TCreateUserFilterParams,
} from "../../../rich-filters";
import {
  createFilterConfig,
  createFilterFieldConfig,
  createOperatorConfigEntry,
  getMemberMultiSelectConfig,
  getMultiSelectConfig,
  getSupportedDateOperators,
} from "../../../rich-filters";

/** A pickable value for the work item type and custom property filters. */
export type TNamedFilterItem = { id: string; name: string; color?: string };

export type TCreateNamedItemFilterParams = TCreateFilterConfigParams &
  IFilterIconConfig<string> & {
    items: TNamedFilterItem[];
  };

const getNamedItemMultiSelectConfig = (
  params: TCreateNamedItemFilterParams,
  singleValueOperator: TSupportedOperators
) =>
  getMultiSelectConfig<TNamedFilterItem, string, string>(
    {
      items: params.items,
      getId: (item) => item.id,
      getLabel: (item) => item.name,
      getValue: (item) => item.id,
      getIconData: (item) => item.color ?? "",
    },
    { singleValueOperator, ...params },
    { getOptionIcon: params.getOptionIcon }
  );

const getNamedItemFilterConfig =
  (label: string) =>
  <P extends TFilterProperty>(key: P): TCreateFilterConfig<P, TCreateNamedItemFilterParams> =>
  (params: TCreateNamedItemFilterParams) =>
    createFilterConfig<P>({
      id: key,
      label,
      ...params,
      icon: params.filterIcon,
      supportedOperatorConfigsMap: new Map([
        createOperatorConfigEntry(COLLECTION_OPERATOR.IN, params, (updatedParams) =>
          getNamedItemMultiSelectConfig(updatedParams, EQUALITY_OPERATOR.EXACT)
        ),
      ]),
    });

/** Filter by work item type. */
export const getWorkItemTypeFilterConfig = getNamedItemFilterConfig("Type");

/** Filter by linked customer. */
export const getCustomerFilterConfig = getNamedItemFilterConfig("Customer");

/** Filter by a custom property option, listed as "Property: Option". */
export const getPropertyOptionFilterConfig = getNamedItemFilterConfig("Custom property");

/**
 * One filter per custom property, keyed `customproperty_<property id>`; the backend
 * reads the id from the key. Dropdown and Yes/No properties pick values, members pick
 * people, dates take a day or a range.
 */
export const getCustomPropertyFilterConfig = <P extends TFilterProperty>(
  key: P,
  label: string,
  params:
    | ({ kind: "option" | "boolean" } & TCreateNamedItemFilterParams)
    | ({ kind: "member" } & TCreateUserFilterParams)
    | ({ kind: "date" } & TCreateDateFilterParams)
    | ({ kind: "text" | "number" } & TCreateFilterConfigParams & IFilterIconConfig<string>)
) => {
  if (params.kind === "text" || params.kind === "number") {
    const type = params.kind === "text" ? FILTER_FIELD_TYPE.TEXT : FILTER_FIELD_TYPE.NUMBER;
    const input = (updatedParams: TCreateFilterConfigParams) =>
      createFilterFieldConfig<typeof type, string>({ type, ...updatedParams } as never);
    const operators =
      params.kind === "text"
        ? [COMPARISON_OPERATOR.CONTAINS, EQUALITY_OPERATOR.EXACT]
        : [EQUALITY_OPERATOR.EXACT, COMPARISON_OPERATOR.GTE, COMPARISON_OPERATOR.LTE];
    return createFilterConfig<P>({
      id: key,
      label,
      ...params,
      icon: params.filterIcon,
      allowMultipleFilters: true,
      supportedOperatorConfigsMap: new Map(operators.map((op) => createOperatorConfigEntry(op, params, input))),
    });
  }
  if (params.kind === "date")
    return createFilterConfig<P>({
      id: key,
      label,
      ...params,
      icon: params.filterIcon,
      allowMultipleFilters: true,
      supportedOperatorConfigsMap: getSupportedDateOperators(params),
    });
  if (params.kind === "member")
    return createFilterConfig<P>({
      id: key,
      label,
      ...params,
      icon: params.filterIcon,
      supportedOperatorConfigsMap: new Map([
        createOperatorConfigEntry(COLLECTION_OPERATOR.IN, params, (updatedParams) =>
          getMemberMultiSelectConfig(updatedParams, EQUALITY_OPERATOR.EXACT)
        ),
      ]),
    });
  return getNamedItemFilterConfig(label)(key)(params as TCreateNamedItemFilterParams);
};
