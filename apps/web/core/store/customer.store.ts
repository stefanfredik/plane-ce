/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
// services
import type {
  TCustomer,
  TCustomerProperty,
  TCustomerRequest,
  TCustomerWorkItem,
  TIssueCustomer,
} from "@/services/customer.service";
import { CustomerService } from "@/services/customer.service";

export interface ICustomerStore {
  customers: TCustomer[] | undefined;
  details: Record<string, TCustomer | undefined>;
  properties: TCustomerProperty[] | undefined;
  requests: Record<string, TCustomerRequest[] | undefined>;
  workItems: Record<string, TCustomerWorkItem[] | undefined>;
  issueCustomers: Record<string, TIssueCustomer[] | undefined>;
  /** Customer names seen so far, for showing customer property values without loading every customer. */
  customerNames: Record<string, string>;
  getCustomerName: (customerId: string) => string | undefined;
  /** Load the names of these customers (batched with other calls made in the same render). */
  requestCustomerNames: (workspaceSlug: string, customerIds: string[]) => void;
  /** First matches of a search, for pickers (at most 50). */
  searchCustomers: (workspaceSlug: string, query: string) => Promise<TCustomer[]>;
  fetchCustomers: (workspaceSlug: string, params?: { search?: string; archived?: boolean }) => Promise<void>;
  fetchCustomer: (workspaceSlug: string, customerId: string) => Promise<TCustomer>;
  createCustomer: (workspaceSlug: string, data: Partial<TCustomer>) => Promise<TCustomer>;
  updateCustomer: (
    workspaceSlug: string,
    customerId: string,
    data: Partial<TCustomer> & { archived?: boolean }
  ) => Promise<void>;
  deleteCustomer: (workspaceSlug: string, customerId: string) => Promise<void>;
  fetchProperties: (workspaceSlug: string) => Promise<void>;
  saveProperty: (workspaceSlug: string, data: Partial<TCustomerProperty>, propertyId?: string) => Promise<void>;
  deleteProperty: (workspaceSlug: string, propertyId: string) => Promise<void>;
  saveValues: (workspaceSlug: string, customerId: string, values: Record<string, string[]>) => Promise<void>;
  fetchRequests: (workspaceSlug: string, customerId: string) => Promise<void>;
  saveRequest: (
    workspaceSlug: string,
    customerId: string,
    data: Partial<TCustomerRequest>,
    requestId?: string
  ) => Promise<void>;
  deleteRequest: (workspaceSlug: string, customerId: string, requestId: string) => Promise<void>;
  fetchWorkItems: (workspaceSlug: string, customerId: string) => Promise<void>;
  linkWorkItems: (workspaceSlug: string, customerId: string, issueIds: string[]) => Promise<void>;
  unlinkWorkItem: (workspaceSlug: string, customerId: string, issueId: string) => Promise<void>;
  fetchIssueCustomers: (workspaceSlug: string, projectId: string, issueId: string) => Promise<void>;
  setIssueCustomers: (
    workspaceSlug: string,
    projectId: string,
    issueId: string,
    customerIds: string[]
  ) => Promise<void>;
}

export class CustomerStore implements ICustomerStore {
  customers: TCustomer[] | undefined = undefined;
  details: Record<string, TCustomer | undefined> = {};
  properties: TCustomerProperty[] | undefined = undefined;
  requests: Record<string, TCustomerRequest[] | undefined> = {};
  workItems: Record<string, TCustomerWorkItem[] | undefined> = {};
  issueCustomers: Record<string, TIssueCustomer[] | undefined> = {};
  customerNames: Record<string, string> = {};
  private service = new CustomerService();
  private namesRequested = new Set<string>();
  private pendingNames = new Set<string>();
  private namesTimer: ReturnType<typeof setTimeout> | undefined;
  private inflight: Record<string, Promise<TCustomer[]> | undefined> = {};

  constructor() {
    makeObservable(this, {
      customers: observable,
      details: observable,
      properties: observable,
      requests: observable,
      workItems: observable,
      issueCustomers: observable,
      customerNames: observable,
      fetchCustomers: action,
      fetchCustomer: action,
      createCustomer: action,
      updateCustomer: action,
      deleteCustomer: action,
      fetchProperties: action,
      saveProperty: action,
      deleteProperty: action,
      saveValues: action,
      fetchRequests: action,
      saveRequest: action,
      deleteRequest: action,
      fetchWorkItems: action,
      linkWorkItems: action,
      unlinkWorkItem: action,
      fetchIssueCustomers: action,
      setIssueCustomers: action,
    });
  }

  private remember = (customers: TCustomer[]) =>
    runInAction(() => {
      for (const customer of customers) this.customerNames[customer.id] = customer.name;
    });

  getCustomerName = (customerId: string) => this.customerNames[customerId];

  requestCustomerNames = (workspaceSlug: string, customerIds: string[]) => {
    for (const id of customerIds) {
      if (this.customerNames[id] !== undefined || this.namesRequested.has(id)) continue;
      this.namesRequested.add(id);
      this.pendingNames.add(id);
    }
    if (this.pendingNames.size === 0 || this.namesTimer) return;
    this.namesTimer = setTimeout(() => {
      this.namesTimer = undefined;
      const ids = [...this.pendingNames];
      this.pendingNames.clear();
      for (let start = 0; start < ids.length; start += 200) {
        const batch = ids.slice(start, start + 200);
        this.service
          .list(workspaceSlug, { ids: batch.join(","), archived: true })
          .then(this.remember)
          .catch(() => batch.forEach((id) => this.namesRequested.delete(id)));
      }
    }, 30);
  };

  searchCustomers = async (workspaceSlug: string, query: string) => {
    const customers = await this.service.list(workspaceSlug, { ...(query ? { search: query } : {}), limit: 50 });
    this.remember(customers);
    return customers;
  };

  fetchCustomers = async (workspaceSlug: string, params?: { search?: string; archived?: boolean }) => {
    // components that mount together share one request for the same list
    const key = `${workspaceSlug}|${params?.search ?? ""}|${params?.archived ? 1 : 0}`;
    const request = (this.inflight[key] ??= this.service.list(workspaceSlug, params).finally(() => {
      delete this.inflight[key];
    }));
    const customers = await request;
    this.remember(customers);
    runInAction(() => {
      this.customers = customers;
    });
  };

  fetchCustomer = async (workspaceSlug: string, customerId: string) => {
    const customer = await this.service.retrieve(workspaceSlug, customerId);
    runInAction(() => {
      this.details[customerId] = customer;
    });
    return customer;
  };

  createCustomer = async (workspaceSlug: string, data: Partial<TCustomer>) => {
    const customer = await this.service.create(workspaceSlug, data);
    runInAction(() => {
      this.customers = sortBy([...(this.customers ?? []), customer], (c) => c.name.toLowerCase());
    });
    return customer;
  };

  updateCustomer = async (
    workspaceSlug: string,
    customerId: string,
    data: Partial<TCustomer> & { archived?: boolean }
  ) => {
    await this.service.update(workspaceSlug, customerId, data);
    await this.fetchCustomer(workspaceSlug, customerId);
  };

  deleteCustomer = async (workspaceSlug: string, customerId: string) => {
    await this.service.remove(workspaceSlug, customerId);
    runInAction(() => {
      this.customers = this.customers?.filter((c) => c.id !== customerId);
      this.details[customerId] = undefined;
    });
  };

  fetchProperties = async (workspaceSlug: string) => {
    const properties = await this.service.listProperties(workspaceSlug);
    runInAction(() => {
      this.properties = properties;
    });
  };

  saveProperty = async (workspaceSlug: string, data: Partial<TCustomerProperty>, propertyId?: string) => {
    if (propertyId) await this.service.updateProperty(workspaceSlug, propertyId, data);
    else await this.service.createProperty(workspaceSlug, data);
    await this.fetchProperties(workspaceSlug);
  };

  deleteProperty = async (workspaceSlug: string, propertyId: string) => {
    await this.service.removeProperty(workspaceSlug, propertyId);
    await this.fetchProperties(workspaceSlug);
  };

  saveValues = async (workspaceSlug: string, customerId: string, values: Record<string, string[]>) => {
    const saved = await this.service.saveValues(workspaceSlug, customerId, values);
    runInAction(() => {
      const current = this.details[customerId];
      if (current) this.details[customerId] = { ...current, property_values: saved };
    });
  };

  fetchRequests = async (workspaceSlug: string, customerId: string) => {
    const requests = await this.service.listRequests(workspaceSlug, customerId);
    runInAction(() => {
      this.requests[customerId] = requests;
    });
  };

  saveRequest = async (
    workspaceSlug: string,
    customerId: string,
    data: Partial<TCustomerRequest>,
    requestId?: string
  ) => {
    if (requestId) await this.service.updateRequest(workspaceSlug, customerId, requestId, data);
    else await this.service.createRequest(workspaceSlug, customerId, data);
    await Promise.all([
      this.fetchRequests(workspaceSlug, customerId),
      this.fetchWorkItems(workspaceSlug, customerId),
      this.fetchCustomer(workspaceSlug, customerId),
    ]);
  };

  deleteRequest = async (workspaceSlug: string, customerId: string, requestId: string) => {
    await this.service.removeRequest(workspaceSlug, customerId, requestId);
    await Promise.all([this.fetchRequests(workspaceSlug, customerId), this.fetchCustomer(workspaceSlug, customerId)]);
  };

  fetchWorkItems = async (workspaceSlug: string, customerId: string) => {
    const items = await this.service.listWorkItems(workspaceSlug, customerId);
    runInAction(() => {
      this.workItems[customerId] = items;
    });
  };

  linkWorkItems = async (workspaceSlug: string, customerId: string, issueIds: string[]) => {
    await this.service.linkWorkItems(workspaceSlug, customerId, issueIds);
    await Promise.all([this.fetchWorkItems(workspaceSlug, customerId), this.fetchCustomer(workspaceSlug, customerId)]);
  };

  unlinkWorkItem = async (workspaceSlug: string, customerId: string, issueId: string) => {
    await this.service.unlinkWorkItem(workspaceSlug, customerId, issueId);
    await Promise.all([this.fetchWorkItems(workspaceSlug, customerId), this.fetchCustomer(workspaceSlug, customerId)]);
  };

  fetchIssueCustomers = async (workspaceSlug: string, projectId: string, issueId: string) => {
    const customers = await this.service.issueCustomers(workspaceSlug, projectId, issueId);
    runInAction(() => {
      this.issueCustomers[issueId] = customers;
    });
  };

  setIssueCustomers = async (workspaceSlug: string, projectId: string, issueId: string, customerIds: string[]) => {
    const customers = await this.service.setIssueCustomers(workspaceSlug, projectId, issueId, customerIds);
    runInAction(() => {
      this.issueCustomers[issueId] = customers;
    });
  };
}
