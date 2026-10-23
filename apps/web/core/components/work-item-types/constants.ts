/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TWorkItemPropertyPayload, TWorkItemPropertyType } from "@/services/work-item-type.service";

export const PROPERTY_TYPES: TWorkItemPropertyType[] = [
  "TEXT",
  "PARAGRAPH",
  "RICH_TEXT",
  "NUMBER",
  "FORMULA",
  "OPTION",
  "CASCADING",
  "BOOLEAN",
  "DATE",
  "MEMBER",
  "RELATION",
  "URL",
  "EMAIL",
  "FILE",
];

export const MULTI_VALUE_TYPES: TWorkItemPropertyType[] = ["OPTION", "MEMBER", "FILE", "RELATION"];

/** Kinds whose options are edited in the property form. */
export const OPTION_TYPES: TWorkItemPropertyType[] = ["OPTION", "CASCADING"];

/** Kinds that can carry a default value for new work items. */
export const DEFAULTABLE_TYPES: TWorkItemPropertyType[] = [
  "TEXT",
  "PARAGRAPH",
  "NUMBER",
  "OPTION",
  "CASCADING",
  "BOOLEAN",
  "DATE",
  "MEMBER",
  "URL",
  "EMAIL",
];

export const TYPE_COLORS = ["#6b7280", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

export const typeColor = (logoProps: { icon?: { color?: string } } | undefined) => logoProps?.icon?.color || "#6b7280";

/** A ready-made Bug type: what a bug report needs to be actionable. */
export const BUG_TEMPLATE: {
  name: string;
  description: string;
  color: string;
  properties: TWorkItemPropertyPayload[];
} = {
  name: "Bug",
  description: "Something that does not work as it should",
  color: "#ef4444",
  properties: [
    {
      display_name: "Severity",
      property_type: "OPTION",
      is_required: true,
      options: [
        { name: "Critical", color: "#dc2626" },
        { name: "Major", color: "#f97316" },
        { name: "Minor", color: "#eab308" },
        { name: "Trivial", color: "#6b7280" },
      ],
    },
    { display_name: "Langkah reproduksi", property_type: "PARAGRAPH", is_required: true },
    { display_name: "Hasil yang diharapkan", property_type: "PARAGRAPH" },
    { display_name: "Hasil aktual", property_type: "PARAGRAPH" },
    {
      display_name: "Environment",
      property_type: "OPTION",
      options: [{ name: "Production" }, { name: "Staging" }, { name: "Development" }],
    },
    { display_name: "URL halaman", property_type: "URL" },
    { display_name: "Browser / perangkat", property_type: "TEXT" },
  ],
};

export const errorMessage = (error: unknown, fallback: string) => {
  const data = error as { errors?: Record<string, string>; error?: string } | undefined;
  if (data?.errors) return Object.values(data.errors).join(" ");
  return data?.error ?? fallback;
};
