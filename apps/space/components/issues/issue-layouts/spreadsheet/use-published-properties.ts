/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
// plane imports
import type { TPublishedProperty, TPublishedPropertyValues } from "@plane/services";
import { SitesCustomPropertyService } from "@plane/services";

const service = new SitesCustomPropertyService();
const BATCH = 100;

/** Public custom properties of the page and their values for the work items loaded so far. */
export const usePublishedProperties = (anchor: string, issueIds: string[]) => {
  const [properties, setProperties] = useState<TPublishedProperty[]>([]);
  const [values, setValues] = useState<TPublishedPropertyValues>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    service
      .list(anchor)
      .then(setProperties)
      .catch(() => setProperties([]));
  }, [anchor]);

  const key = issueIds.join(",");
  useEffect(() => {
    if (properties.length === 0) return;
    const missing = issueIds.filter((id) => !requested.current.has(id));
    for (let start = 0; start < missing.length; start += BATCH) {
      const batch = missing.slice(start, start + BATCH);
      batch.forEach((id) => requested.current.add(id));
      service
        .values(anchor, batch)
        .then((loaded) => setValues((prev) => ({ ...prev, ...loaded })))
        .catch(() => batch.forEach((id) => requested.current.delete(id)));
    }
    // issueIds is tracked through its joined key
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, key, properties.length]);

  return { properties, values };
};
