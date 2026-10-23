/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// services
import type {
  TProjectWorkItemTypes,
  TWorkItemProperty,
  TWorkItemPropertyPayload,
  TWorkItemPropertyValues,
  TWorkItemType,
  TWorkspaceWorkItemType,
} from "@/services/work-item-type.service";
import { WorkItemTypeService } from "@/services/work-item-type.service";
import type { CoreRootStore } from "./root.store";

/** Work items per property-values request (the server accepts up to 200). */
const VALUE_BATCH_SIZE = 100;

export type TPropertyColumn = { property: TWorkItemProperty; typeIds: string[] };

export interface IWorkItemTypeStore {
  projectTypes: Record<string, TProjectWorkItemTypes | undefined>;
  issueValues: Record<string, TWorkItemPropertyValues | undefined>;
  // getters
  isEnabled: (projectId: string | null | undefined) => boolean;
  getProjectTypes: (projectId: string | null | undefined) => TWorkItemType[];
  getTypeById: (projectId: string | null | undefined, typeId: string | null | undefined) => TWorkItemType | undefined;
  getDefaultType: (projectId: string | null | undefined) => TWorkItemType | undefined;
  getActiveProperties: (projectId: string | null | undefined, typeId: string | null | undefined) => TWorkItemProperty[];
  /**
   * Active properties used by the project's active types, once each (a property can be shared by
   * several types), with the types that use it.
   */
  getProjectPropertyColumns: (projectId: string | null | undefined) => TPropertyColumn[];
  // actions
  fetchProjectTypes: (workspaceSlug: string, projectId: string, force?: boolean) => Promise<TProjectWorkItemTypes>;
  enable: (workspaceSlug: string, projectId: string) => Promise<void>;
  createType: (workspaceSlug: string, projectId: string, data: Partial<TWorkItemType>) => Promise<TWorkItemType>;
  updateType: (workspaceSlug: string, projectId: string, typeId: string, data: Partial<TWorkItemType>) => Promise<void>;
  deleteType: (workspaceSlug: string, projectId: string, typeId: string) => Promise<void>;
  createProperty: (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    data: TWorkItemPropertyPayload
  ) => Promise<void>;
  updateProperty: (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    propertyId: string,
    data: TWorkItemPropertyPayload
  ) => Promise<void>;
  /** Take a property off a type; it stays in the project's pool with its values. */
  deleteProperty: (workspaceSlug: string, projectId: string, typeId: string, propertyId: string) => Promise<void>;
  /** The project's property pool (every property, whichever types use it). */
  projectProperties: Record<string, TWorkItemProperty[] | undefined>;
  fetchProjectProperties: (workspaceSlug: string, projectId: string) => Promise<TWorkItemProperty[]>;
  createPoolProperty: (
    workspaceSlug: string,
    projectId: string,
    data: TWorkItemPropertyPayload & { issue_type_ids?: string[] }
  ) => Promise<TWorkItemProperty>;
  updatePoolProperty: (
    workspaceSlug: string,
    projectId: string,
    propertyId: string,
    data: TWorkItemPropertyPayload
  ) => Promise<void>;
  /** Delete a property everywhere, with its values. */
  deletePoolProperty: (workspaceSlug: string, projectId: string, propertyId: string) => Promise<void>;
  linkProperties: (workspaceSlug: string, projectId: string, typeId: string, propertyIds: string[]) => Promise<void>;
  fetchIssueValues: (workspaceSlug: string, projectId: string, issueId: string) => Promise<TWorkItemPropertyValues>;
  saveIssueValues: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    values: TWorkItemPropertyValues,
    checkRequired?: boolean
  ) => Promise<TWorkItemPropertyValues>;
  workspaceTypes: TWorkspaceWorkItemType[] | undefined;
  fetchWorkspaceTypes: (workspaceSlug: string) => Promise<TWorkspaceWorkItemType[]>;
  importTypes: (
    workspaceSlug: string,
    projectId: string,
    typeIds: string[]
  ) => Promise<{ imported: string[]; skipped: string[] }>;
  bulkAssign: (workspaceSlug: string, projectId: string, typeId: string, issueIds: string[]) => Promise<number>;
  /**
   * Ask for one work item's values; requests made while rendering a list are sent together,
   * a page at a time, so only the items on screen are loaded.
   */
  requestIssueValues: (workspaceSlug: string, projectId: string, issueId: string) => void;
}

export class WorkItemTypeStore implements IWorkItemTypeStore {
  projectTypes: Record<string, TProjectWorkItemTypes | undefined> = {};
  issueValues: Record<string, TWorkItemPropertyValues | undefined> = {};
  workspaceTypes: TWorkspaceWorkItemType[] | undefined = undefined;
  projectProperties: Record<string, TWorkItemProperty[] | undefined> = {};
  private service = new WorkItemTypeService();
  private inflight: Record<string, Promise<TProjectWorkItemTypes> | undefined> = {};
  /** Work items whose values were asked for (loaded or on their way). */
  private valuesRequested = new Set<string>();
  private pendingValues: Record<string, Set<string>> = {};
  private flushTimers: Record<string, ReturnType<typeof setTimeout> | undefined> = {};

  constructor(private rootStore?: CoreRootStore) {
    makeObservable(this, {
      projectTypes: observable,
      issueValues: observable,
      workspaceTypes: observable,
      projectProperties: observable,
      fetchProjectProperties: action,
      createPoolProperty: action,
      updatePoolProperty: action,
      deletePoolProperty: action,
      linkProperties: action,
      fetchWorkspaceTypes: action,
      importTypes: action,
      bulkAssign: action,
      fetchProjectTypes: action,
      enable: action,
      createType: action,
      updateType: action,
      deleteType: action,
      createProperty: action,
      updateProperty: action,
      deleteProperty: action,
      fetchIssueValues: action,
      saveIssueValues: action,
    });
  }

  isEnabled = (projectId: string | null | undefined) => !!projectId && !!this.projectTypes[projectId]?.is_enabled;

  getProjectTypes = (projectId: string | null | undefined) => (projectId && this.projectTypes[projectId]?.types) || [];

  getTypeById = (projectId: string | null | undefined, typeId: string | null | undefined) =>
    typeId ? this.getProjectTypes(projectId).find((t) => t.id === typeId) : undefined;

  getDefaultType = (projectId: string | null | undefined) => this.getProjectTypes(projectId).find((t) => t.is_default);

  getActiveProperties = (projectId: string | null | undefined, typeId: string | null | undefined) =>
    (this.getTypeById(projectId, typeId)?.properties ?? []).filter((p) => p.is_active);

  getProjectPropertyColumns = (projectId: string | null | undefined) => {
    const columns = new Map<string, TPropertyColumn>();
    for (const type of this.getProjectTypes(projectId)) {
      if (!type.is_active) continue;
      for (const property of type.properties) {
        if (!property.is_active) continue;
        const column = columns.get(property.id);
        if (column) column.typeIds.push(type.id);
        else columns.set(property.id, { property, typeIds: [type.id] });
      }
    }
    return [...columns.values()];
  };

  fetchProjectTypes = async (workspaceSlug: string, projectId: string, force = false) => {
    const cached = this.projectTypes[projectId];
    if (cached && !force) return cached;
    const pending = this.inflight[projectId];
    if (pending && !force) return pending;
    const request = this.service.list(workspaceSlug, projectId);
    this.inflight[projectId] = request;
    try {
      const data = await request;
      runInAction(() => {
        this.projectTypes[projectId] = data;
      });
      return data;
    } finally {
      this.inflight[projectId] = undefined;
    }
  };

  enable = async (workspaceSlug: string, projectId: string) => {
    const data = await this.service.enable(workspaceSlug, projectId);
    runInAction(() => {
      this.projectTypes[projectId] = data;
    });
  };

  /** Types and, once loaded, the pool change together (links show on both). */
  private refresh = async (workspaceSlug: string, projectId: string) => {
    const types = this.fetchProjectTypes(workspaceSlug, projectId, true);
    if (this.projectProperties[projectId]) await this.fetchProjectProperties(workspaceSlug, projectId);
    return types;
  };

  fetchProjectProperties = async (workspaceSlug: string, projectId: string) => {
    const properties = await this.service.listPool(workspaceSlug, projectId);
    runInAction(() => {
      this.projectProperties[projectId] = properties;
    });
    return properties;
  };

  createPoolProperty = async (
    workspaceSlug: string,
    projectId: string,
    data: TWorkItemPropertyPayload & { issue_type_ids?: string[] }
  ) => {
    const created = await this.service.createPoolProperty(workspaceSlug, projectId, data);
    await this.fetchProjectProperties(workspaceSlug, projectId);
    await this.refresh(workspaceSlug, projectId);
    return created;
  };

  updatePoolProperty = async (
    workspaceSlug: string,
    projectId: string,
    propertyId: string,
    data: TWorkItemPropertyPayload
  ) => {
    await this.service.updatePoolProperty(workspaceSlug, projectId, propertyId, data);
    await this.refresh(workspaceSlug, projectId);
  };

  deletePoolProperty = async (workspaceSlug: string, projectId: string, propertyId: string) => {
    await this.service.deletePoolProperty(workspaceSlug, projectId, propertyId);
    await this.refresh(workspaceSlug, projectId);
  };

  linkProperties = async (workspaceSlug: string, projectId: string, typeId: string, propertyIds: string[]) => {
    await this.service.linkProperties(workspaceSlug, projectId, typeId, propertyIds);
    await this.refresh(workspaceSlug, projectId);
  };

  createType = async (workspaceSlug: string, projectId: string, data: Partial<TWorkItemType>) => {
    const created = await this.service.createType(workspaceSlug, projectId, data);
    await this.refresh(workspaceSlug, projectId);
    return created;
  };

  updateType = async (workspaceSlug: string, projectId: string, typeId: string, data: Partial<TWorkItemType>) => {
    await this.service.updateType(workspaceSlug, projectId, typeId, data);
    await this.refresh(workspaceSlug, projectId);
  };

  deleteType = async (workspaceSlug: string, projectId: string, typeId: string) => {
    await this.service.deleteType(workspaceSlug, projectId, typeId);
    await this.refresh(workspaceSlug, projectId);
  };

  createProperty = async (workspaceSlug: string, projectId: string, typeId: string, data: TWorkItemPropertyPayload) => {
    await this.service.createProperty(workspaceSlug, projectId, typeId, data);
    await this.refresh(workspaceSlug, projectId);
  };

  updateProperty = async (
    workspaceSlug: string,
    projectId: string,
    typeId: string,
    propertyId: string,
    data: TWorkItemPropertyPayload
  ) => {
    await this.service.updateProperty(workspaceSlug, projectId, typeId, propertyId, data);
    await this.refresh(workspaceSlug, projectId);
  };

  deleteProperty = async (workspaceSlug: string, projectId: string, typeId: string, propertyId: string) => {
    await this.service.deleteProperty(workspaceSlug, projectId, typeId, propertyId);
    await this.refresh(workspaceSlug, projectId);
  };

  fetchIssueValues = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const values = await this.service.getValues(workspaceSlug, projectId, issueId);
    runInAction(() => {
      this.issueValues[issueId] = values;
    });
    return values;
  };

  saveIssueValues = async (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    values: TWorkItemPropertyValues,
    checkRequired = false
  ) => {
    const saved = await this.service.saveValues(workspaceSlug, projectId, issueId, values, checkRequired);
    runInAction(() => {
      this.issueValues[issueId] = saved;
    });
    this.refreshGroupedList(workspaceSlug, projectId, Object.keys(values));
    return saved;
  };

  fetchWorkspaceTypes = async (workspaceSlug: string) => {
    const types = await this.service.listWorkspaceTypes(workspaceSlug);
    runInAction(() => {
      this.workspaceTypes = types;
    });
    return types;
  };

  importTypes = async (workspaceSlug: string, projectId: string, typeIds: string[]) => {
    const { imported, skipped, ...data } = await this.service.importTypes(workspaceSlug, projectId, typeIds);
    runInAction(() => {
      this.projectTypes[projectId] = data;
    });
    void this.fetchWorkspaceTypes(workspaceSlug);
    return { imported, skipped };
  };

  bulkAssign = async (workspaceSlug: string, projectId: string, typeId: string, issueIds: string[]) => {
    const { updated } = await this.service.bulkAssign(workspaceSlug, projectId, typeId, issueIds);
    await this.refresh(workspaceSlug, projectId);
    return updated;
  };

  /** Values of every work item in the project, merged into the per-issue cache (for list columns). */
  /** A list grouped by one of these properties regroups on the server, so reload it. */
  private refreshGroupedList = (workspaceSlug: string, projectId: string, propertyIds: string[]) => {
    const issueRoot = this.rootStore?.issue;
    const groupBy = issueRoot?.projectIssuesFilter.getIssueFilters(projectId)?.displayFilters?.group_by;
    if (!issueRoot || !groupBy?.startsWith("customproperty_")) return;
    if (!propertyIds.includes(groupBy.replace("customproperty_", ""))) return;
    void issueRoot.projectIssues.fetchIssuesWithExistingPagination(workspaceSlug, projectId, "mutation");
  };

  requestIssueValues = (workspaceSlug: string, projectId: string, issueId: string) => {
    if (this.issueValues[issueId] !== undefined || this.valuesRequested.has(issueId)) return;
    this.valuesRequested.add(issueId);
    (this.pendingValues[projectId] ??= new Set()).add(issueId);
    if (this.flushTimers[projectId]) return;
    // wait a tick so every row rendered in the same pass joins one request
    this.flushTimers[projectId] = setTimeout(() => void this.flushValueRequests(workspaceSlug, projectId), 30);
  };

  private flushValueRequests = async (workspaceSlug: string, projectId: string) => {
    this.flushTimers[projectId] = undefined;
    const ids = [...(this.pendingValues[projectId] ?? [])];
    this.pendingValues[projectId]?.clear();
    for (let start = 0; start < ids.length; start += VALUE_BATCH_SIZE) {
      const batch = ids.slice(start, start + VALUE_BATCH_SIZE);
      try {
        // oxlint-disable-next-line no-await-in-loop -- batches go one after another to keep the server load even
        const values = await this.service.getProjectValues(workspaceSlug, projectId, batch);
        runInAction(() => {
          // items without values are remembered as empty so they are not asked for again
          for (const id of batch) this.issueValues[id] = values[id] ?? {};
        });
      } catch {
        for (const id of batch) this.valuesRequested.delete(id);
      }
    }
  };
}
