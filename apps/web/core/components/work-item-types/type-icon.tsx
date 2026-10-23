/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BookOpen,
  Bug,
  CheckSquare,
  Flag,
  Layers,
  Lightbulb,
  Rocket,
  ShieldAlert,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
// plane imports
import { cn } from "@plane/utils";
// local
import { typeColor } from "./constants";

/** Icons a work item type can use; the name is stored in logo_props.icon.name. */
export const TYPE_ICONS: Record<string, LucideIcon> = {
  Layers,
  Bug,
  CheckSquare,
  Star,
  Sparkles,
  Lightbulb,
  Rocket,
  Wrench,
  Flag,
  AlertTriangle,
  ShieldAlert,
  BookOpen,
};

type Props = {
  logoProps: { icon?: { name?: string; color?: string } } | undefined;
  className?: string;
};

export function WorkItemTypeIcon({ logoProps, className }: Props) {
  const Icon = TYPE_ICONS[logoProps?.icon?.name ?? ""] ?? Layers;
  return <Icon className={cn("size-3.5 shrink-0", className)} style={{ color: typeColor(logoProps) }} />;
}

/** The type icon on a tinted square, as shown in the type settings tables and headers. */
export function WorkItemTypeIconTile({
  logoProps,
  size = "sm",
}: {
  logoProps: Props["logoProps"];
  size?: "sm" | "lg";
}) {
  const color = typeColor(logoProps);
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-md", size === "lg" ? "size-8" : "size-5")}
      style={{ backgroundColor: `${color}22` }}
    >
      <WorkItemTypeIcon logoProps={logoProps} className={size === "lg" ? "size-4.5" : "size-3"} />
    </span>
  );
}
