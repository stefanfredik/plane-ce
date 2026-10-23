/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";

type Props = { name: string; size?: "sm" | "md" | "lg"; className?: string };

const SIZES = { sm: "size-5 text-caption-sm-medium", md: "size-7 text-body-xs-medium", lg: "size-12 text-h4-medium" };

/** A customer's initial on a tinted square, the way Plane shows customers without an uploaded logo. */
export function CustomerLogo({ name, size = "md", className }: Props) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-md bg-accent-subtle text-accent-primary",
        SIZES[size],
        className
      )}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}
