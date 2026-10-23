/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type { TProjectPublishViewProps } from "@plane/types";
// services
import { APIService } from "@/services/api.service";

export type TViewPublishSettings = {
  id: string;
  anchor: string;
  entity_name: "view";
  entity_identifier: string;
  is_comments_enabled: boolean;
  is_reactions_enabled: boolean;
  is_votes_enabled: boolean;
  view_props: TProjectPublishViewProps;
};

export type TViewPublishPayload = Partial<
  Pick<TViewPublishSettings, "is_comments_enabled" | "is_reactions_enabled" | "is_votes_enabled" | "view_props">
>;

export class ViewPublishService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string, viewId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/views/${viewId}/publish/`;
  }

  /** Resolves to null when the view is not published. */
  async retrieve(workspaceSlug: string, projectId: string, viewId: string): Promise<TViewPublishSettings | null> {
    return this.get(this.url(workspaceSlug, projectId, viewId))
      .then((response) => response?.data)
      .catch((error) => {
        if (error?.response?.status === 404) return null;
        throw error?.response?.data;
      });
  }

  async publish(workspaceSlug: string, projectId: string, viewId: string, data: TViewPublishPayload) {
    return this.post(this.url(workspaceSlug, projectId, viewId), data)
      .then((response) => response?.data as TViewPublishSettings)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, projectId: string, viewId: string, data: TViewPublishPayload) {
    return this.patch(this.url(workspaceSlug, projectId, viewId), data)
      .then((response) => response?.data as TViewPublishSettings)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async unpublish(workspaceSlug: string, projectId: string, viewId: string) {
    return this.delete(this.url(workspaceSlug, projectId, viewId)).catch((error) => {
      throw error?.response?.data;
    });
  }
}
