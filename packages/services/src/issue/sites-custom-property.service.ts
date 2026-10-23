/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL } from "@plane/constants";
// api service
import { APIService } from "../api.service";

/** A custom property the project chose to show on its published pages. */
export type TPublishedProperty = {
  id: string;
  name: string;
  description: string;
  property_type: string;
  is_multi: boolean;
  logo_props: { icon?: { name?: string } } & Record<string, unknown>;
  /** Dropdown option colours, by option name. */
  options: { name: string; color: string }[];
};

/** Work item id -> property id -> display text of each value. */
export type TPublishedPropertyValues = Record<string, Record<string, string[]>>;

/**
 * Read-only custom properties of a published project or view.
 * @remarks This service is only available for plane sites
 */
export class SitesCustomPropertyService extends APIService {
  constructor(BASE_URL?: string) {
    super(BASE_URL || API_BASE_URL);
  }

  async list(anchor: string): Promise<TPublishedProperty[]> {
    return this.get(`/api/public/anchor/${anchor}/properties/`)
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }

  /** Values of up to 200 work items shown on the page. */
  async values(anchor: string, issueIds: string[]): Promise<TPublishedPropertyValues> {
    return this.get(`/api/public/anchor/${anchor}/property-values/`, { params: { issue_ids: issueIds.join(",") } })
      .then((response) => response?.data)
      .catch((error) => {
        throw error?.response?.data;
      });
  }
}
