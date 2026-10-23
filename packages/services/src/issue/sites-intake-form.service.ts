/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// api service
import { APIService } from "../api.service";

export type TPublicIntakeField = {
  id: string;
  name: string;
  description: string;
  property_type: string;
  is_multi: boolean;
  is_required: boolean;
  options: { id: string; name: string; parent_id: string | null }[];
};

export type TPublicIntakeForm = {
  title: string;
  description: string;
  require_email: boolean;
  success_message: string;
  project: { name: string; identifier: string; logo_props: Record<string, unknown> };
  workspace: { name: string };
  fields: TPublicIntakeField[];
};

export type TIntakeSubmission = {
  name: string;
  email: string;
  title: string;
  description: string;
  values: Record<string, string[]>;
  /** Honeypot: hidden from people, filled by bots. */
  website?: string;
};

/** Public intake forms (no sign-in). */
export class SitesIntakeFormService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  async retrieve(anchor: string): Promise<TPublicIntakeForm> {
    return this.get(`/api/public/intake-forms/${anchor}/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response;
      });
  }

  async submit(anchor: string, data: TIntakeSubmission): Promise<{ ok: boolean; reference?: string }> {
    return this.post(`/api/public/intake-forms/${anchor}/`, data)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
