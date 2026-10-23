/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  AlignLeft,
  Calendar,
  CircleCheck,
  CircleDot,
  Contact,
  Clock,
  FileText,
  Flag,
  Gauge,
  Globe,
  Hash,
  Layers,
  Link,
  Link2,
  ListTree,
  Mail,
  MapPin,
  Monitor,
  Paperclip,
  Server,
  Sigma,
  Smartphone,
  Tag,
  ToggleLeft,
  Type,
  User,
  Users,
  Wifi,
} from "lucide-react";
// plane imports
import { cn } from "@plane/utils";
// local
import type { TWorkItemProperty, TWorkItemPropertyType } from "@/services/work-item-type.service";

/** Icon used when a property has not picked one. */
export const DEFAULT_PROPERTY_ICON: Record<TWorkItemPropertyType, string> = {
  TEXT: "Type",
  PARAGRAPH: "AlignLeft",
  RICH_TEXT: "FileText",
  NUMBER: "Hash",
  FORMULA: "Sigma",
  OPTION: "CircleDot",
  CASCADING: "ListTree",
  BOOLEAN: "ToggleLeft",
  DATE: "Calendar",
  MEMBER: "User",
  RELATION: "Link2",
  CUSTOMER: "Contact",
  URL: "Link",
  EMAIL: "Mail",
  FILE: "Paperclip",
};

/** Icons a property can use; the name is stored in logo_props.icon.name. */
export const PROPERTY_ICONS: Record<string, LucideIcon> = {
  Type,
  AlignLeft,
  FileText,
  Hash,
  Sigma,
  Gauge,
  CircleDot,
  ListTree,
  Tag,
  Flag,
  AlertTriangle,
  CircleCheck,
  ToggleLeft,
  Calendar,
  Clock,
  User,
  Users,
  Contact,
  Link2,
  Link,
  Globe,
  Mail,
  Paperclip,
  Monitor,
  Smartphone,
  Server,
  Wifi,
  MapPin,
  Layers,
};

type TLogoProps = { icon?: { name?: string; color?: string } } | Record<string, unknown> | undefined;

export const propertyIconName = (property: Pick<TWorkItemProperty, "property_type" | "logo_props">) =>
  ((property.logo_props as TLogoProps & { icon?: { name?: string } })?.icon?.name as string | undefined) ??
  DEFAULT_PROPERTY_ICON[property.property_type] ??
  "Tag";

/** The lucide component for a property (its chosen icon, or its type's default). */
export const getPropertyIconComponent = (property: Pick<TWorkItemProperty, "property_type" | "logo_props">) =>
  PROPERTY_ICONS[propertyIconName(property)] ?? Tag;

type Props = {
  property: Pick<TWorkItemProperty, "property_type" | "logo_props">;
  className?: string;
};

export function WorkItemPropertyIcon({ property, className }: Props) {
  const Icon = getPropertyIconComponent(property);
  const color = (property.logo_props as { icon?: { color?: string } } | undefined)?.icon?.color;
  return <Icon className={cn("size-3.5 shrink-0", className)} style={color ? { color } : undefined} />;
}
