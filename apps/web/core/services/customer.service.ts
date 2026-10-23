/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TCustomer = {
  id: string;
  name: string;
  description_html: string;
  email: string | null;
  website_url: string | null;
  domain: string | null;
  employees: number | null;
  stage: string | null;
  contract_status: string | null;
  revenue: string | null;
  logo_props: Record<string, unknown>;
  archived_at: string | null;
  customer_request_count: number;
  work_item_count: number;
  created_at: string;
  updated_at: string;
  property_values?: Record<string, string[]>;
};

export type TCustomerPropertyType =
  | "TEXT"
  | "PARAGRAPH"
  | "NUMBER"
  | "OPTION"
  | "BOOLEAN"
  | "DATE"
  | "URL"
  | "EMAIL"
  | "MEMBER";

export type TCustomerProperty = {
  id: string;
  display_name: string;
  description: string;
  property_type: TCustomerPropertyType;
  is_multi: boolean;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  logo_props: Record<string, unknown>;
  options: { id?: string; name: string; color?: string; sort_order?: number }[];
};

export type TCustomerRequest = {
  id: string;
  customer_id: string;
  name: string;
  description_html: string;
  link: string | null;
  work_item_ids: string[];
  created_at: string;
};

export type TCustomerWorkItem = {
  id: string;
  name: string;
  state_name: string | null;
  state_group: string | null;
  state_color: string | null;
  priority: string;
  sequence_id: number;
  project_id: string;
  project__identifier: string;
  created_at: string;
};

export type TIssueCustomer = { id: string; name: string; logo_props: Record<string, unknown>; request_count: number };

export class CustomerService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private ws(workspaceSlug: string) {
    return `/api/workspaces/${workspaceSlug}`;
  }

  private unwrap = <T>(promise: Promise<{ data: T }>): Promise<T> =>
    promise
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });

  list(workspaceSlug: string, params?: { search?: string; archived?: boolean }) {
    return this.unwrap<TCustomer[]>(this.get(`${this.ws(workspaceSlug)}/customers/`, { params }));
  }
  retrieve(workspaceSlug: string, customerId: string) {
    return this.unwrap<TCustomer>(this.get(`${this.ws(workspaceSlug)}/customers/${customerId}/`));
  }
  create(workspaceSlug: string, data: Partial<TCustomer>) {
    return this.unwrap<TCustomer>(this.post(`${this.ws(workspaceSlug)}/customers/`, data));
  }
  update(workspaceSlug: string, customerId: string, data: Partial<TCustomer> & { archived?: boolean }) {
    return this.unwrap<TCustomer>(this.patch(`${this.ws(workspaceSlug)}/customers/${customerId}/`, data));
  }
  remove(workspaceSlug: string, customerId: string) {
    return this.unwrap<void>(this.delete(`${this.ws(workspaceSlug)}/customers/${customerId}/`));
  }

  listProperties(workspaceSlug: string) {
    return this.unwrap<TCustomerProperty[]>(this.get(`${this.ws(workspaceSlug)}/customer-properties/`));
  }
  createProperty(workspaceSlug: string, data: Partial<TCustomerProperty>) {
    return this.unwrap<TCustomerProperty>(this.post(`${this.ws(workspaceSlug)}/customer-properties/`, data));
  }
  updateProperty(workspaceSlug: string, propertyId: string, data: Partial<TCustomerProperty>) {
    return this.unwrap<TCustomerProperty>(
      this.patch(`${this.ws(workspaceSlug)}/customer-properties/${propertyId}/`, data)
    );
  }
  removeProperty(workspaceSlug: string, propertyId: string) {
    return this.unwrap<void>(this.delete(`${this.ws(workspaceSlug)}/customer-properties/${propertyId}/`));
  }
  saveValues(workspaceSlug: string, customerId: string, values: Record<string, string[]>) {
    return this.unwrap<Record<string, string[]>>(
      this.put(`${this.ws(workspaceSlug)}/customers/${customerId}/property-values/`, { values })
    );
  }

  listRequests(workspaceSlug: string, customerId: string) {
    return this.unwrap<TCustomerRequest[]>(this.get(`${this.ws(workspaceSlug)}/customers/${customerId}/requests/`));
  }
  createRequest(workspaceSlug: string, customerId: string, data: Partial<TCustomerRequest>) {
    return this.unwrap<TCustomerRequest>(
      this.post(`${this.ws(workspaceSlug)}/customers/${customerId}/requests/`, data)
    );
  }
  updateRequest(workspaceSlug: string, customerId: string, requestId: string, data: Partial<TCustomerRequest>) {
    return this.unwrap<TCustomerRequest>(
      this.patch(`${this.ws(workspaceSlug)}/customers/${customerId}/requests/${requestId}/`, data)
    );
  }
  removeRequest(workspaceSlug: string, customerId: string, requestId: string) {
    return this.unwrap<void>(this.delete(`${this.ws(workspaceSlug)}/customers/${customerId}/requests/${requestId}/`));
  }

  listWorkItems(workspaceSlug: string, customerId: string) {
    return this.unwrap<TCustomerWorkItem[]>(this.get(`${this.ws(workspaceSlug)}/customers/${customerId}/issues/`));
  }
  linkWorkItems(workspaceSlug: string, customerId: string, issueIds: string[]) {
    return this.unwrap<unknown>(
      this.post(`${this.ws(workspaceSlug)}/customers/${customerId}/issues/`, { issue_ids: issueIds })
    );
  }
  unlinkWorkItem(workspaceSlug: string, customerId: string, issueId: string) {
    return this.unwrap<void>(this.delete(`${this.ws(workspaceSlug)}/customers/${customerId}/issues/${issueId}/`));
  }

  issueCustomers(workspaceSlug: string, projectId: string, issueId: string) {
    return this.unwrap<TIssueCustomer[]>(
      this.get(`${this.ws(workspaceSlug)}/projects/${projectId}/issues/${issueId}/customers/`)
    );
  }
  setIssueCustomers(workspaceSlug: string, projectId: string, issueId: string, customerIds: string[]) {
    return this.unwrap<TIssueCustomer[]>(
      this.put(`${this.ws(workspaceSlug)}/projects/${projectId}/issues/${issueId}/customers/`, {
        customer_ids: customerIds,
      })
    );
  }
}
