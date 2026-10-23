/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { action, makeObservable, observable, runInAction } from "mobx";
// services
import type { TProjectWorkflow } from "@/services/workflow.service";
import { WorkflowService } from "@/services/workflow.service";

export interface IWorkflowStore {
  workflows: Record<string, TProjectWorkflow | undefined>;
  getWorkflow: (projectId: string | null | undefined) => TProjectWorkflow | undefined;
  /** Load the project's workflow once; later calls reuse it. */
  ensureWorkflow: (workspaceSlug: string, projectId: string) => Promise<void>;
  fetchWorkflow: (workspaceSlug: string, projectId: string) => Promise<TProjectWorkflow>;
  updateWorkflow: (
    workspaceSlug: string,
    projectId: string,
    data: Partial<Pick<TProjectWorkflow, "is_enabled" | "rules">>
  ) => Promise<TProjectWorkflow>;
  /** Whether the current viewer may move a work item from one state to another. */
  isMoveAllowed: (
    projectId: string | null | undefined,
    fromStateId: string | null | undefined,
    toStateId: string | null | undefined
  ) => boolean;
  /** Whether new work items cannot start in this state. */
  isCreationBlocked: (projectId: string | null | undefined, stateId: string | null | undefined) => boolean;
}

export class WorkflowStore implements IWorkflowStore {
  workflows: Record<string, TProjectWorkflow | undefined> = {};
  private service = new WorkflowService();
  private inflight: Record<string, Promise<TProjectWorkflow> | undefined> = {};

  constructor() {
    makeObservable(this, {
      workflows: observable,
      fetchWorkflow: action,
      updateWorkflow: action,
    });
  }

  getWorkflow = (projectId: string | null | undefined) => (projectId ? this.workflows[projectId] : undefined);

  ensureWorkflow = async (workspaceSlug: string, projectId: string) => {
    if (this.workflows[projectId] || this.inflight[projectId]) return;
    await this.fetchWorkflow(workspaceSlug, projectId).catch(() => undefined);
  };

  fetchWorkflow = async (workspaceSlug: string, projectId: string) => {
    const pending = this.inflight[projectId] ?? this.service.retrieve(workspaceSlug, projectId);
    this.inflight[projectId] = pending;
    try {
      const workflow = await pending;
      runInAction(() => {
        this.workflows[projectId] = workflow;
      });
      return workflow;
    } finally {
      this.inflight[projectId] = undefined;
    }
  };

  updateWorkflow = async (
    workspaceSlug: string,
    projectId: string,
    data: Partial<Pick<TProjectWorkflow, "is_enabled" | "rules">>
  ) => {
    const workflow = await this.service.update(workspaceSlug, projectId, data);
    runInAction(() => {
      this.workflows[projectId] = workflow;
    });
    return workflow;
  };

  isMoveAllowed = (
    projectId: string | null | undefined,
    fromStateId: string | null | undefined,
    toStateId: string | null | undefined
  ) => {
    if (!fromStateId || !toStateId || fromStateId === toStateId) return true;
    const allowed = this.getWorkflow(projectId)?.viewer?.moves[fromStateId];
    return allowed === undefined || allowed.includes(toStateId);
  };

  isCreationBlocked = (projectId: string | null | undefined, stateId: string | null | undefined) =>
    !!stateId && !!this.getWorkflow(projectId)?.viewer?.creation_blocked.includes(stateId);
}
