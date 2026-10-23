/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TAutomationEvent =
  | "work_item_created"
  | "state_changed"
  | "priority_changed"
  | "assignee_changed"
  | "label_changed"
  | "property_changed"
  | "comment_added"
  | "sla_breached";

export type TAutomationTrigger =
  | { type: TAutomationEvent; property_id?: string }
  | {
      type: "schedule";
      frequency: "daily" | "weekly" | "monthly";
      time: string;
      timezone: string;
      days?: number[];
      day?: number;
    };

export type TAutomationCondition = {
  field: string;
  operator: "in" | "not_in" | "is_empty" | "is_not_empty" | "gte" | "is";
  value: string[] | number | boolean;
};

export type TAutomationAction =
  | { type: "change_state"; state_id: string }
  | { type: "change_priority"; priority: string }
  | { type: "add_assignees" | "remove_assignees"; member_ids: string[] }
  | { type: "add_labels"; label_ids: string[] }
  | { type: "set_property"; property_id: string; values: string[] }
  | { type: "add_comment"; text: string }
  | { type: "send_telegram"; bot_token: string; chat_id: string; text: string }
  | { type: "send_webhook"; url: string; text: string };

export type TAutomationActionType = TAutomationAction["type"];

export type TAutomation = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  is_enabled: boolean;
  trigger: TAutomationTrigger;
  match: "all" | "any";
  conditions: TAutomationCondition[];
  actions: TAutomationAction[];
  last_run_at: string | null;
  last_run_status: "success" | "failed" | "skipped" | null;
  run_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TAutomationRun = {
  id: string;
  event: string;
  status: "success" | "failed" | "skipped";
  details: { action: string | null; ok: boolean; message: string }[];
  duration_ms: number;
  created_at: string;
  issue: { id: string; name: string; sequence_id: number; project_identifier: string } | null;
};

export class AutomationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string, suffix = "") {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/automations/${suffix}`;
  }

  private async call<T>(request: Promise<{ data: T }>): Promise<T> {
    return request
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  list(workspaceSlug: string, projectId: string): Promise<TAutomation[]> {
    return this.call(this.get(this.url(workspaceSlug, projectId)));
  }

  retrieve(workspaceSlug: string, projectId: string, id: string): Promise<TAutomation> {
    return this.call(this.get(this.url(workspaceSlug, projectId, `${id}/`)));
  }

  create(workspaceSlug: string, projectId: string, data: Partial<TAutomation>): Promise<TAutomation> {
    return this.call(this.post(this.url(workspaceSlug, projectId), data));
  }

  update(workspaceSlug: string, projectId: string, id: string, data: Partial<TAutomation>): Promise<TAutomation> {
    return this.call(this.patch(this.url(workspaceSlug, projectId, `${id}/`), data));
  }

  remove(workspaceSlug: string, projectId: string, id: string): Promise<void> {
    return this.call(this.delete(this.url(workspaceSlug, projectId, `${id}/`)));
  }

  runs(workspaceSlug: string, projectId: string, id: string, status?: string): Promise<TAutomationRun[]> {
    return this.call(this.get(this.url(workspaceSlug, projectId, `${id}/runs/`), { params: status ? { status } : {} }));
  }

  runNow(
    workspaceSlug: string,
    projectId: string,
    id: string,
    issueId?: string
  ): Promise<TAutomationRun | { matched: number }> {
    return this.call(
      this.post(this.url(workspaceSlug, projectId, `${id}/runs/`), issueId ? { issue_id: issueId } : {})
    );
  }
}
