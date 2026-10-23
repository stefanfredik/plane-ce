/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TProjectIssuesSearchParams } from "@plane/types";
// services
import { ProjectService } from "@/services/project";

const projectService = new ProjectService();

/**
 * Customers live at workspace level, so their work item picker searches every project the user has joined.
 * The search endpoint needs some project in the URL; `workspace_search` widens it to the whole workspace.
 */
export const workspaceWorkItemSearch =
  (workspaceSlug: string, anyProjectId: string | undefined) => (params: TProjectIssuesSearchParams) =>
    anyProjectId
      ? projectService.projectIssuesSearch(workspaceSlug, anyProjectId, { ...params, workspace_search: true })
      : Promise.resolve([]);
