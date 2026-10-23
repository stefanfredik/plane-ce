/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// services
import type {
  TAutomationAction,
  TAutomationActionType,
  TAutomationEvent,
  TAutomationRun,
  TAutomationTrigger,
} from "@/services/automation.service";

export const EVENT_TRIGGERS: TAutomationEvent[] = [
  "work_item_created",
  "state_changed",
  "priority_changed",
  "assignee_changed",
  "label_changed",
  "property_changed",
  "comment_added",
  "sla_breached",
];

export const ACTION_TYPES: TAutomationActionType[] = [
  "change_state",
  "change_priority",
  "add_assignees",
  "remove_assignees",
  "add_labels",
  "set_property",
  "add_comment",
  "send_telegram",
  "send_webhook",
];

export const PLACEHOLDERS = [
  "{{work_item.id}}",
  "{{work_item.name}}",
  "{{work_item.state}}",
  "{{work_item.priority}}",
  "{{work_item.assignees}}",
  "{{work_item.url}}",
  "{{project.name}}",
  "{{property.Severity}}",
];

export const localTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const timezones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", localTimezone()];
  }
};

export const defaultTrigger = (type: TAutomationTrigger["type"]): TAutomationTrigger =>
  type === "schedule" ? { type, frequency: "daily", time: "09:00", timezone: localTimezone() } : { type };

export const emptyAction = (type: TAutomationActionType): TAutomationAction => {
  switch (type) {
    case "change_state":
      return { type, state_id: "" };
    case "change_priority":
      return { type, priority: "urgent" };
    case "add_assignees":
    case "remove_assignees":
      return { type, member_ids: [] };
    case "add_labels":
      return { type, label_ids: [] };
    case "set_property":
      return { type, property_id: "", values: [] };
    case "add_comment":
      return { type, text: "" };
    case "send_telegram":
      return { type, bot_token: "", chat_id: "", text: "{{work_item.id}} {{work_item.name}}\n{{work_item.url}}" };
    case "send_webhook":
      return { type, url: "", text: "" };
  }
};

export const errorText = (error: unknown, fallback: string) => {
  const data = error as { errors?: Record<string, unknown>; error?: string } | undefined;
  return data?.errors ? Object.values(data.errors).map(String).join(" ") : (data?.error ?? fallback);
};

const STATUS_CLASSES: Record<TAutomationRun["status"], string> = {
  success: "bg-success-subtle text-success-primary",
  failed: "bg-danger-subtle text-danger-primary",
  skipped: "bg-layer-2 text-tertiary",
};

export function StatusBadge({ status }: { status: TAutomationRun["status"] }) {
  const { t } = useTranslation();
  return (
    <span className={cn("rounded-sm px-1.5 py-0.5 text-caption-sm-medium", STATUS_CLASSES[status])}>
      {t(`automations.custom.status.${status}`)}
    </span>
  );
}
