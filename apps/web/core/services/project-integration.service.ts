/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TIntegrationProvider = "gitlab" | "sentry";

export type TProjectIntegration = {
  id: string;
  provider: TIntegrationProvider;
  is_enabled: boolean;
  /** Path of the webhook on the API host; the anchor in it is the secret part. */
  webhook_path: string;
  /** GitLab only: the secret token GitLab sends back. */
  secret?: string;
  /** Sentry only: whether a client secret is saved (it is never sent back). */
  has_secret?: boolean;
  config: {
    // GitLab
    post_comments?: boolean;
    states?: { mr_opened: string | null; mr_merged: string | null; mr_closed: string | null };
    // Sentry
    issue_type_id?: string | null;
    state_id?: string | null;
    resolved_state_id?: string | null;
    reopened_state_id?: string | null;
    priorities?: Record<string, string>;
    assignee_ids?: string[];
    label_ids?: string[];
  };
  last_event_at: string | null;
  last_event: string | null;
};

export class ProjectIntegrationService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string, provider: TIntegrationProvider) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/integrations/${provider}/`;
  }

  async retrieve(
    workspaceSlug: string,
    projectId: string,
    provider: TIntegrationProvider
  ): Promise<TProjectIntegration> {
    return this.get(this.url(workspaceSlug, projectId, provider))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(
    workspaceSlug: string,
    projectId: string,
    provider: TIntegrationProvider,
    data: { is_enabled?: boolean; config?: Record<string, unknown>; secret?: string; rotate_secret?: boolean }
  ): Promise<TProjectIntegration> {
    return this.patch(this.url(workspaceSlug, projectId, provider), data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
