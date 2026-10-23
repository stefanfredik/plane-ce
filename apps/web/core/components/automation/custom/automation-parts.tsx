/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import { Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Input, TextArea } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { PropertyValueField } from "@/components/work-item-types/property-value-field";
// services
import type { TAutomationAction, TAutomationCondition, TAutomationTrigger } from "@/services/automation.service";
// local imports
import { ACTION_TYPES, PLACEHOLDERS, emptyAction, timezones } from "./helpers";
import type { TChoice } from "./select";
import { ChoiceMultiSelect, ChoiceSelect } from "./select";
import type { TAutomationChoices } from "./use-choices";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
// 1 January 2024 was a Monday, which the server counts as day 0
const weekdayName = (day: number) => new Date(2024, 0, 1 + day).toLocaleDateString(undefined, { weekday: "short" });
/** Property kinds "Set a property" can fill in. */
const SETTABLE_TYPES = new Set([
  "TEXT",
  "PARAGRAPH",
  "NUMBER",
  "OPTION",
  "BOOLEAN",
  "DATE",
  "MEMBER",
  "URL",
  "EMAIL",
  "CASCADING",
]);

export function RemoveButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="rounded-sm p-1 text-tertiary hover:bg-layer-1 hover:text-danger-primary"
      aria-label={t("common.actions.delete")}
      onClick={onClick}
      disabled={disabled}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Trigger

type TTriggerProps = {
  trigger: TAutomationTrigger;
  onChange: (trigger: TAutomationTrigger) => void;
  choices: TAutomationChoices;
  disabled: boolean;
};

export function TriggerConfig({ trigger, onChange, choices, disabled }: TTriggerProps) {
  const { t } = useTranslation();
  if (trigger.type === "property_changed") {
    const anyChoice = { value: "", label: t("automations.custom.any_property") };
    return (
      <ChoiceSelect
        value={trigger.property_id ?? ""}
        choices={[anyChoice, ...choices.allProperties.map((p) => ({ value: p.id, label: p.display_name }))]}
        onChange={(value) => onChange({ type: "property_changed", property_id: value || undefined })}
        placeholder={t("automations.custom.any_property")}
        disabled={disabled}
      />
    );
  }
  if (trigger.type !== "schedule") return null;

  const frequencies = (["daily", "weekly", "monthly"] as const).map((f) => ({
    value: f,
    label: t(`automations.trigger.schedule.frequency_${f}`),
  }));

  return (
    <div className="flex flex-wrap items-center gap-2 text-caption-md-regular text-secondary">
      <ChoiceSelect
        value={trigger.frequency}
        choices={frequencies}
        onChange={(value) =>
          onChange({
            ...trigger,
            frequency: value as "daily",
            days: value === "weekly" ? (trigger.days ?? [0]) : undefined,
            day: value === "monthly" ? (trigger.day ?? 1) : undefined,
          })
        }
        placeholder={t("automations.trigger.schedule.frequency")}
        disabled={disabled}
        className="min-w-28"
      />
      {trigger.frequency === "weekly" && (
        <div className="flex gap-1">
          {WEEKDAYS.map((day) => {
            const isOn = trigger.days?.includes(day);
            return (
              <button
                key={day}
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange({
                    ...trigger,
                    days: isOn ? (trigger.days ?? []).filter((d) => d !== day) : sortBy([...(trigger.days ?? []), day]),
                  })
                }
                className={cn(
                  "rounded-sm border-[0.5px] px-2 py-1 text-caption-sm-medium",
                  isOn ? "border-accent-strong bg-accent-subtle text-accent-primary" : "border-subtle-1 text-tertiary"
                )}
              >
                {weekdayName(day)}
              </button>
            );
          })}
        </div>
      )}
      {trigger.frequency === "monthly" && (
        <>
          <span>{t("automations.trigger.schedule.monthly_every")}</span>
          <ChoiceSelect
            value={String(trigger.day ?? 1)}
            choices={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
            onChange={(value) => onChange({ ...trigger, day: Number(value) })}
            placeholder={t("automations.trigger.schedule.day_of_month")}
            disabled={disabled}
            className="min-w-16"
          />
        </>
      )}
      <span>{t("automations.trigger.schedule.time")}</span>
      <Input
        type="time"
        value={trigger.time}
        onChange={(e) => onChange({ ...trigger, time: e.target.value || "09:00" })}
        className="w-28 px-2 py-1 text-body-xs-regular"
        disabled={disabled}
      />
      <ChoiceSelect
        value={trigger.timezone}
        choices={timezones().map((tz) => ({ value: tz, label: tz }))}
        onChange={(value) => onChange({ ...trigger, timezone: value })}
        placeholder={t("automations.trigger.schedule.timezone_placeholder")}
        disabled={disabled}
        className="min-w-44"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conditions

const NO_EMPTY = new Set(["state", "state_group", "priority", "sla_status"]);

export function conditionFields(choices: TAutomationChoices, t: (key: string) => string): TChoice[] {
  return [
    ...["state", "state_group", "priority", "type", "assignees", "labels", "sla_status", "stale_days", "overdue"].map(
      (field) => ({ value: field, label: t(`automations.custom.fields.${field}`) })
    ),
    ...choices.properties.map((p) => ({ value: `property:${p.id}`, label: p.display_name })),
  ];
}

export const emptyCondition = (field: string): TAutomationCondition =>
  field === "stale_days"
    ? { field, operator: "gte", value: 3 }
    : field === "overdue"
      ? { field, operator: "is", value: true }
      : { field, operator: "in", value: [] };

type TConditionProps = {
  condition: TAutomationCondition;
  onChange: (condition: TAutomationCondition) => void;
  onRemove: () => void;
  choices: TAutomationChoices;
  disabled: boolean;
};

export const ConditionRow = observer(function ConditionRow(props: TConditionProps) {
  const { condition, onChange, onRemove, choices, disabled } = props;
  const { t } = useTranslation();
  const field = condition.field;

  const valueChoices: TChoice[] =
    field === "state"
      ? choices.states
      : field === "state_group"
        ? choices.stateGroups
        : field === "priority"
          ? choices.priorities
          : field === "type"
            ? choices.types
            : field === "assignees"
              ? choices.members
              : field === "labels"
                ? choices.labels
                : field === "sla_status"
                  ? choices.slaStatuses
                  : field.startsWith("property:")
                    ? choices.propertyValues(field.slice("property:".length))
                    : [];

  const operators = (["in", "not_in", "is_empty", "is_not_empty"] as const)
    .filter((op) => !NO_EMPTY.has(field) || op === "in" || op === "not_in")
    .map((op) => ({ value: op, label: t(`automations.custom.operators.${op}`) }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChoiceSelect
        value={field}
        choices={conditionFields(choices, t)}
        onChange={(value) => onChange(emptyCondition(value))}
        placeholder={t("automations.custom.select")}
        disabled={disabled}
      />
      {field === "stale_days" ? (
        <>
          <Input
            type="number"
            min={1}
            value={String(condition.value)}
            onChange={(e) => onChange({ ...condition, value: Math.max(1, Number(e.target.value) || 1) })}
            className="w-20 px-2 py-1 text-body-xs-regular"
            disabled={disabled}
          />
          <span className="text-caption-md-regular text-tertiary">{t("automations.custom.days")}</span>
        </>
      ) : field === "overdue" ? (
        <ChoiceSelect
          value={condition.value ? "true" : "false"}
          choices={[
            { value: "true", label: t("automations.custom.is_overdue") },
            { value: "false", label: t("automations.custom.is_not_overdue") },
          ]}
          onChange={(value) => onChange({ ...condition, value: value === "true" })}
          placeholder={t("automations.custom.select")}
          disabled={disabled}
        />
      ) : (
        <>
          <ChoiceSelect
            value={condition.operator}
            choices={operators}
            onChange={(value) =>
              onChange({
                ...condition,
                operator: value as TAutomationCondition["operator"],
                value: value === "is_empty" || value === "is_not_empty" ? [] : condition.value,
              })
            }
            placeholder={t("automations.custom.select")}
            disabled={disabled}
            className="min-w-24"
          />
          {(condition.operator === "in" || condition.operator === "not_in") && (
            <ChoiceMultiSelect
              value={Array.isArray(condition.value) ? condition.value : []}
              choices={valueChoices}
              onChange={(value) => onChange({ ...condition, value })}
              placeholder={t("automations.custom.select")}
              disabled={disabled}
            />
          )}
        </>
      )}
      {!disabled && <RemoveButton onClick={onRemove} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Actions

type TActionProps = {
  index: number;
  action: TAutomationAction;
  onChange: (action: TAutomationAction) => void;
  onRemove: () => void;
  choices: TAutomationChoices;
  projectId: string;
  disabled: boolean;
};

function Placeholders() {
  const { t } = useTranslation();
  return (
    <p className="flex flex-wrap items-center gap-1 text-caption-sm-regular text-tertiary">
      {t("automations.custom.placeholders")}
      {PLACEHOLDERS.map((p) => (
        <code key={p} className="rounded-sm bg-layer-2 px-1 py-0.5 text-[11px] text-secondary">
          {p}
        </code>
      ))}
    </p>
  );
}

export const ActionRow = observer(function ActionRow(props: TActionProps) {
  const { index, action, onChange, onRemove, choices, projectId, disabled } = props;
  const { t } = useTranslation();
  const typeChoices = ACTION_TYPES.map((type) => ({ value: type, label: t(`automations.custom.actions.${type}`) }));
  const settable = choices.allProperties.filter((p) => SETTABLE_TYPES.has(p.property_type));
  const textArea = (value: string, update: (text: string) => void, placeholder: string) => (
    <TextArea
      value={value}
      onChange={(e) => update(e.target.value)}
      placeholder={placeholder}
      className="min-h-16 w-full text-body-xs-regular"
      disabled={disabled}
    />
  );

  let config: React.ReactNode = null;
  switch (action.type) {
    case "change_state":
      config = (
        <ChoiceSelect
          value={action.state_id || undefined}
          choices={choices.states}
          onChange={(state_id) => onChange({ ...action, state_id })}
          placeholder={t("automations.custom.select")}
          disabled={disabled}
        />
      );
      break;
    case "change_priority":
      config = (
        <ChoiceSelect
          value={action.priority}
          choices={choices.priorities}
          onChange={(priority) => onChange({ ...action, priority })}
          placeholder={t("automations.custom.select")}
          disabled={disabled}
        />
      );
      break;
    case "add_assignees":
    case "remove_assignees":
      config = (
        <ChoiceMultiSelect
          value={action.member_ids}
          choices={choices.members}
          onChange={(member_ids) => onChange({ ...action, member_ids })}
          placeholder={t("automations.custom.select")}
          disabled={disabled}
        />
      );
      break;
    case "add_labels":
      config = (
        <ChoiceMultiSelect
          value={action.label_ids}
          choices={choices.labels}
          onChange={(label_ids) => onChange({ ...action, label_ids })}
          placeholder={t("automations.custom.select")}
          disabled={disabled}
        />
      );
      break;
    case "set_property": {
      const prop = settable.find((p) => p.id === action.property_id);
      config = (
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceSelect
            value={action.property_id || undefined}
            choices={settable.map((p) => ({ value: p.id, label: p.display_name }))}
            onChange={(property_id) => onChange({ ...action, property_id, values: [] })}
            placeholder={t("automations.custom.select")}
            disabled={disabled}
          />
          {prop && (
            <div className="min-w-48">
              <PropertyValueField
                property={prop}
                projectId={projectId}
                value={action.values}
                onChange={(values) => onChange({ ...action, values })}
                mode="form"
                disabled={disabled}
              />
            </div>
          )}
        </div>
      );
      break;
    }
    case "add_comment":
      config = (
        <div className="w-full space-y-1">
          {textArea(action.text, (text) => onChange({ ...action, text }), t("automations.custom.message"))}
          <Placeholders />
        </div>
      );
      break;
    case "send_telegram":
      config = (
        <div className="w-full space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={action.bot_token}
              onChange={(e) => onChange({ ...action, bot_token: e.target.value })}
              placeholder={t("automations.custom.bot_token")}
              className="min-w-64 flex-1 px-2 py-1 text-body-xs-regular"
              disabled={disabled}
            />
            <Input
              value={action.chat_id}
              onChange={(e) => onChange({ ...action, chat_id: e.target.value })}
              placeholder={t("automations.custom.chat_id")}
              className="w-48 px-2 py-1 text-body-xs-regular"
              disabled={disabled}
            />
          </div>
          {textArea(action.text, (text) => onChange({ ...action, text }), t("automations.custom.message"))}
          <Placeholders />
        </div>
      );
      break;
    case "send_webhook":
      config = (
        <div className="w-full space-y-2">
          <Input
            value={action.url}
            onChange={(e) => onChange({ ...action, url: e.target.value })}
            placeholder="https://"
            className="w-full px-2 py-1 text-body-xs-regular"
            disabled={disabled}
          />
          {textArea(action.text, (text) => onChange({ ...action, text }), t("automations.custom.message"))}
          <Placeholders />
        </div>
      );
      break;
  }

  return (
    <div className="flex gap-3 rounded-md border-[0.5px] border-subtle p-3">
      <span className="mt-1 flex size-5 flex-shrink-0 items-center justify-center rounded-full bg-layer-2 text-caption-sm-medium text-secondary">
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
        <ChoiceSelect
          value={action.type}
          choices={typeChoices}
          onChange={(type) => onChange(emptyAction(type as TAutomationAction["type"]))}
          placeholder={t("automations.action.input_placeholder")}
          disabled={disabled}
        />
        {config}
      </div>
      {!disabled && <RemoveButton onClick={onRemove} />}
    </div>
  );
});
