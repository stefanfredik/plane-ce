/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Check, Minus } from "lucide-react";
// plane imports
import type { TPublishedProperty } from "@plane/services";
import { renderFormattedDate } from "@plane/utils";

type Props = { property: TPublishedProperty; values: string[] | undefined };

/** One custom property value in the published table (the server sends display text). */
export function PublishedCustomValue({ property, values }: Props) {
  if (!values?.length) return <span className="text-placeholder">—</span>;
  switch (property.property_type) {
    case "BOOLEAN":
      return values[0] === "true" ? (
        <Check className="size-3.5 text-success-primary" aria-label="Yes" />
      ) : (
        <Minus className="size-3.5 text-tertiary" aria-label="No" />
      );
    case "DATE":
      return <span>{renderFormattedDate(values[0]) ?? values[0]}</span>;
    case "URL":
      return (
        <a
          href={values[0]}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="truncate text-accent-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {values[0]}
        </a>
      );
    case "OPTION":
    case "CASCADING":
    case "MEMBER":
      return (
        <span className="flex flex-wrap gap-1">
          {values.map((value) => {
            const color = property.options.find((option) => option.name === value)?.color;
            return (
              <span
                key={value}
                className="flex items-center gap-1 rounded-sm border-[0.5px] border-strong px-1.5 py-0.5 text-11"
              >
                {color && <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
                {value}
              </span>
            );
          })}
        </span>
      );
    default:
      return (
        <span className="block truncate" title={values.join(", ")}>
          {values.join(", ")}
        </span>
      );
  }
}
