/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { cn } from "@plane/utils";

type Props = { label: string; tone: "success" | "accent" | "neutral" };

const TONES = {
  success: "bg-success-subtle text-success-primary",
  accent: "bg-accent-subtle text-accent-primary",
  neutral: "bg-layer-2 text-tertiary",
};

/** Small pill used for Active / Inactive / Mandatory / Default labels in the type settings. */
export function WorkItemTypeBadge({ label, tone }: Props) {
  return (
    <span className={cn("inline-flex shrink-0 rounded-sm px-1.5 py-0.5 text-caption-sm-medium", TONES[tone])}>
      {label}
    </span>
  );
}
