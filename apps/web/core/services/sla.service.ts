/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TSlaStatus = "on_track" | "at_risk" | "breached" | "met" | "missed";

export type TSlaTarget = { response: number | null; resolution: number | null };

export type TSlaPolicy = {
  project_id: string;
  is_enabled: boolean;
  /** "priority" or the id of a dropdown property */
  based_on: string;
  /** Minutes per priority or option id. */
  targets: Record<string, TSlaTarget>;
  at_risk_percent: number;
};

export type TIssueSla = {
  key: string;
  status: TSlaStatus | null;
  response: { due_at: string | null; done_at: string | null; status: TSlaStatus | null };
  resolution: { due_at: string | null; done_at: string | null; status: TSlaStatus | null };
};

export type TSlaSummary = {
  is_enabled: boolean;
  counts: { on_track: number; at_risk: number; breached: number };
  attention: {
    id: string;
    project_id: string;
    name: string;
    sequence_id: number;
    project_identifier: string;
    status: TSlaStatus;
    due_at: string | null;
  }[];
};

export class SlaService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private async call<T>(request: Promise<{ data: T }>): Promise<T> {
    return request
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  policy(workspaceSlug: string, projectId: string): Promise<TSlaPolicy> {
    return this.call(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sla/`));
  }

  updatePolicy(workspaceSlug: string, projectId: string, data: Partial<TSlaPolicy>): Promise<TSlaPolicy> {
    return this.call(this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sla/`, data));
  }

  summary(workspaceSlug: string, projectId: string): Promise<TSlaSummary> {
    return this.call(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/sla/summary/`));
  }

  issueSla(workspaceSlug: string, projectId: string, issueId: string): Promise<TIssueSla | null> {
    return this.call(this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/sla/`));
  }
}
