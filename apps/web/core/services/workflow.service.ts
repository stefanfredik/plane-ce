/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TWorkflowTransition = {
  /** Reviewers allowed to make this move; empty lets anyone. */
  movers: string[];
};

export type TWorkflowRule = {
  /** Whether new work items may start in this state (always true for the default state). */
  allow_creation: boolean;
  /** Permitted moves out of this state, keyed by the state moved to; empty allows any move. */
  transitions: Record<string, TWorkflowTransition>;
  /** Fields and property ids that must be filled before entering this state. */
  require: string[];
};

export type TProjectWorkflow = {
  project_id: string;
  is_enabled: boolean;
  rules: Record<string, TWorkflowRule>;
  /** What the current viewer may do; null when the workflow is off. */
  viewer: {
    /** State id -> states the viewer may move work items to; states not listed allow any move. */
    moves: Record<string, string[]>;
    creation_blocked: string[];
  } | null;
};

export class WorkflowService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/workflow/`;
  }

  async retrieve(workspaceSlug: string, projectId: string): Promise<TProjectWorkflow> {
    return this.get(this.url(workspaceSlug, projectId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    data: Partial<Pick<TProjectWorkflow, "is_enabled" | "rules">>
  ): Promise<TProjectWorkflow> {
    return this.patch(this.url(workspaceSlug, projectId), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
