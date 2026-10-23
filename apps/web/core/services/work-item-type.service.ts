/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TWorkItemPropertyType =
  | "TEXT"
  | "PARAGRAPH"
  | "NUMBER"
  | "OPTION"
  | "BOOLEAN"
  | "DATE"
  | "URL"
  | "MEMBER"
  | "EMAIL"
  | "FILE"
  | "FORMULA"
  | "CASCADING"
  | "RICH_TEXT"
  | "RELATION"
  | "CUSTOMER";

export type TWorkItemPropertyOption = {
  id?: string;
  name: string;
  /** Set on second-level options of a cascading property. */
  parent_id?: string | null;
  /** Second-level options, when sending a cascading property's options. */
  children?: TWorkItemPropertyOption[];
  description?: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
  is_active?: boolean;
};

export type TWorkItemProperty = {
  id: string;
  /** The type this property was listed under (or the first type using it, for pool listings). */
  issue_type_id: string | null;
  /** Every type of the project that uses this property (properties live in a project pool). */
  issue_type_ids?: string[];
  project_id?: string;
  display_name: string;
  description: string;
  property_type: TWorkItemPropertyType;
  is_multi: boolean;
  is_required: boolean;
  is_active: boolean;
  /** Shown read-only on published project and view pages. */
  is_public?: boolean;
  sort_order: number;
  default_value: string[];
  settings: Record<string, unknown>;
  logo_props: Record<string, unknown>;
  options: TWorkItemPropertyOption[];
};

export type TWorkItemType = {
  id: string;
  name: string;
  description: string;
  logo_props: { in_use?: string; icon?: { name?: string; color?: string } } & Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  project_id: string;
  /** Projects using this type; more than one means it is shared. */
  project_ids?: string[];
  issue_count?: number;
  properties: TWorkItemProperty[];
};

export type TProjectWorkItemTypes = { is_enabled: boolean; types: TWorkItemType[] };

/** Property id -> values as strings (option/member ids, "true"/"false", ISO dates, numbers as text). */
export type TWorkItemPropertyValues = Record<string, string[]>;

export type TWorkspaceWorkItemType = {
  id: string;
  name: string;
  description: string;
  logo_props: TWorkItemType["logo_props"];
  is_active: boolean;
  project_ids: string[];
  property_count: number;
};

/** Issue id -> property id -> values. */
export type TProjectPropertyValues = Record<string, TWorkItemPropertyValues>;

export type TRelatedWorkItem = {
  id: string;
  name: string;
  sequence_id: number;
  project_id: string;
  project_identifier: string;
};

export type TWorkItemPropertyPayload = Partial<Omit<TWorkItemProperty, "id" | "issue_type_id">>;

/** A parent label with child labels, e.g. "Reporter" over "Reporter: Triska". */
export type TLabelGroup = { id: string; name: string; labels: number; uses: number };

export type TLabelConversionRequest = {
  label_id: string;
  /** Add to this dropdown property; without it a new property is created. */
  property_id?: string;
  name?: string;
  type_ids?: string[];
  remove_labels?: boolean;
  dry_run?: boolean;
};

export type TLabelConversionResult = {
  label_group: string;
  options: string[];
  work_items: number;
  conflicts: number;
  already_set: number;
  other_types: number;
  is_multi: boolean;
  property_id?: string;
};

export class WorkItemTypeService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}`;
  }

  private unwrap = <T>(promise: Promise<{ data: T }>): Promise<T> =>
    promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });

  list(workspaceSlug: string, projectId: string) {
    return this.unwrap<TProjectWorkItemTypes>(this.get(`${this.base(workspaceSlug, projectId)}/work-item-types/`));
  }

  enable(workspaceSlug: string, projectId: string) {
    return this.unwrap<TProjectWorkItemTypes>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/enable/`, {})
    );
  }

  createType(workspaceSlug: string, projectId: string, data: Partial<TWorkItemType>) {
    return this.unwrap<TWorkItemType>(this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/`, data));
  }

  updateType(workspaceSlug: string, projectId: string, typeId: string, data: Partial<TWorkItemType>) {
    return this.unwrap<TWorkItemType>(
      this.patch(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/`, data)
    );
  }

  deleteType(workspaceSlug: string, projectId: string, typeId: string) {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/`));
  }

  createProperty(workspaceSlug: string, projectId: string, typeId: string, data: TWorkItemPropertyPayload) {
    return this.unwrap<TWorkItemProperty>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/properties/`, data)
    );
  }

  updateProperty(
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    propertyId: string,
    data: TWorkItemPropertyPayload
  ) {
    return this.unwrap<TWorkItemProperty>(
      this.patch(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/properties/${propertyId}/`, data)
    );
  }

  deleteProperty(workspaceSlug: string, projectId: string, typeId: string, propertyId: string) {
    return this.unwrap<void>(
      this.delete(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/properties/${propertyId}/`)
    );
  }

  listPool(workspaceSlug: string, projectId: string) {
    return this.unwrap<TWorkItemProperty[]>(this.get(`${this.base(workspaceSlug, projectId)}/work-item-properties/`));
  }

  createPoolProperty(workspaceSlug: string, projectId: string, data: TWorkItemPropertyPayload) {
    return this.unwrap<TWorkItemProperty>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-properties/`, data)
    );
  }

  updatePoolProperty(workspaceSlug: string, projectId: string, propertyId: string, data: TWorkItemPropertyPayload) {
    return this.unwrap<TWorkItemProperty>(
      this.patch(`${this.base(workspaceSlug, projectId)}/work-item-properties/${propertyId}/`, data)
    );
  }

  deletePoolProperty(workspaceSlug: string, projectId: string, propertyId: string) {
    return this.unwrap<void>(this.delete(`${this.base(workspaceSlug, projectId)}/work-item-properties/${propertyId}/`));
  }

  listLabelGroups(workspaceSlug: string, projectId: string) {
    return this.unwrap<TLabelGroup[]>(
      this.get(`${this.base(workspaceSlug, projectId)}/work-item-properties/from-labels/`)
    );
  }

  convertLabels(workspaceSlug: string, projectId: string, data: TLabelConversionRequest) {
    return this.unwrap<TLabelConversionResult>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-properties/from-labels/`, data)
    );
  }

  linkProperties(workspaceSlug: string, projectId: string, typeId: string, propertyIds: string[]) {
    return this.unwrap<TWorkItemType>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/${typeId}/properties/link/`, {
        property_ids: propertyIds,
      })
    );
  }

  getValues(workspaceSlug: string, projectId: string, issueId: string) {
    return this.unwrap<TWorkItemPropertyValues>(
      this.get(`${this.base(workspaceSlug, projectId)}/issues/${issueId}/property-values/`)
    );
  }

  saveValues(
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    values: TWorkItemPropertyValues,
    checkRequired = false
  ) {
    return this.unwrap<TWorkItemPropertyValues>(
      this.put(`${this.base(workspaceSlug, projectId)}/issues/${issueId}/property-values/`, {
        values,
        check_required: checkRequired,
      })
    );
  }

  listWorkspaceTypes(workspaceSlug: string) {
    return this.unwrap<TWorkspaceWorkItemType[]>(this.get(`/api/workspaces/${workspaceSlug}/work-item-types/`));
  }

  importTypes(workspaceSlug: string, projectId: string, typeIds: string[]) {
    return this.unwrap<TProjectWorkItemTypes & { imported: string[]; skipped: string[] }>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/import/`, { type_ids: typeIds })
    );
  }

  bulkAssign(workspaceSlug: string, projectId: string, typeId: string, issueIds: string[]) {
    return this.unwrap<{ updated: number }>(
      this.post(`${this.base(workspaceSlug, projectId)}/work-item-types/bulk-assign/`, {
        type_id: typeId,
        issue_ids: issueIds,
      })
    );
  }

  /** Values of the given work items (at most 200 per call), or of the whole project without ids. */
  getProjectValues(workspaceSlug: string, projectId: string, issueIds?: string[]) {
    return this.unwrap<TProjectPropertyValues>(
      this.get(`${this.base(workspaceSlug, projectId)}/property-values/`, {
        params: issueIds ? { issue_ids: issueIds.join(",") } : undefined,
      })
    );
  }

  getRelationDetails(workspaceSlug: string, projectId: string, ids: string[]) {
    return this.unwrap<TRelatedWorkItem[]>(
      this.get(`${this.base(workspaceSlug, projectId)}/property-values/relations/`, { params: { ids: ids.join(",") } })
    );
  }
}
