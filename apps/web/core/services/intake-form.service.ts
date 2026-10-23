/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
// services
import { APIService } from "@/services/api.service";

export type TIntakeFormSettings = {
  id: string;
  anchor: string;
  is_enabled: boolean;
  title: string;
  description: string;
  issue_type_id: string | null;
  property_ids: string[];
  require_email: boolean;
  success_message: string;
};

export class IntakeFormService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private url(workspaceSlug: string, projectId: string) {
    return `/api/workspaces/${workspaceSlug}/projects/${projectId}/intake-form/`;
  }

  async retrieve(workspaceSlug: string, projectId: string): Promise<TIntakeFormSettings> {
    return this.get(this.url(workspaceSlug, projectId))
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  async update(workspaceSlug: string, projectId: string, data: Partial<TIntakeFormSettings>) {
    return this.patch(this.url(workspaceSlug, projectId), data)
      .then((response) => response?.data as TIntakeFormSettings)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
