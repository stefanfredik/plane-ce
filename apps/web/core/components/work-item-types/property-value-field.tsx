/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { CustomSearchSelect, Input, TextArea, ToggleSwitch } from "@plane/ui";
import { cn, getDate, renderFormattedPayloadDate } from "@plane/utils";
// components
import { DateDropdown } from "@/components/dropdowns/date";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
// local
import type { TWorkItemProperty } from "@/services/work-item-type.service";
import { CustomerPropertyField } from "./customer-property-field";
import { FilePropertyField, RelationPropertyField, RichTextPropertyField } from "./property-value-extra";

type Props = {
  property: TWorkItemProperty;
  projectId: string;
  value: string[];
  /** Text-like fields call this on blur in "inline" mode and on every keystroke in "form" mode. */
  onChange: (value: string[]) => void;
  mode: "form" | "inline";
  disabled?: boolean;
  hasError?: boolean;
  /** The work item being edited; file and relation properties need it (absent while creating). */
  issueId?: string;
};

/** Edits one custom property; values are always a list of strings (see the API contract). */
export const PropertyValueField = observer(function PropertyValueField(props: Props) {
  const { property, projectId, value, onChange, mode, disabled = false, hasError = false, issueId } = props;
  const { t } = useTranslation();
  const first = value[0] ?? "";
  const [draft, setDraft] = useState(first);

  useEffect(() => setDraft(first), [first]);

  const commitText = (text: string) => {
    const next = text.trim() ? [text.trim()] : [];
    if (next[0] !== value[0] || next.length !== value.length) onChange(next);
  };

  const textProps = {
    disabled,
    hasError,
    placeholder: mode === "inline" ? t("wit.empty_value") : property.display_name,
  };

  switch (property.property_type) {
    case "TEXT":
    case "URL":
    case "EMAIL":
    case "NUMBER":
      return (
        <Input
          {...textProps}
          type={
            ({ NUMBER: "number", URL: "url", EMAIL: "email" } as Record<string, string>)[property.property_type] ??
            "text"
          }
          value={draft}
          mode={mode === "inline" ? "transparent" : "primary"}
          className={cn("w-full", mode === "inline" && "px-2 py-1 text-body-xs-regular hover:bg-layer-1")}
          onChange={(e) => {
            setDraft(e.target.value);
            if (mode === "form") commitText(e.target.value);
          }}
          onBlur={() => mode === "inline" && commitText(draft)}
          onKeyDown={(e) => {
            if (mode === "inline" && e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      );
    case "PARAGRAPH":
      return (
        <TextArea
          {...textProps}
          value={draft}
          mode={mode === "inline" ? "transparent" : "primary"}
          className={cn("min-h-16 w-full", mode === "inline" && "px-2 py-1 text-body-xs-regular hover:bg-layer-1")}
          onChange={(e) => {
            setDraft(e.target.value);
            if (mode === "form") commitText(e.target.value);
          }}
          onBlur={() => mode === "inline" && commitText(draft)}
        />
      );
    case "BOOLEAN":
      return (
        <div className={cn("flex h-7 items-center", mode === "inline" && "px-2")}>
          <ToggleSwitch
            value={first === "true"}
            onChange={(checked) => onChange([checked ? "true" : "false"])}
            disabled={disabled}
            size="sm"
          />
        </div>
      );
    case "DATE":
      return (
        <DateDropdown
          value={first || null}
          onChange={(date) => {
            const formatted = date ? renderFormattedPayloadDate(date) : undefined;
            onChange(formatted ? [formatted] : []);
          }}
          placeholder={t("wit.empty_value")}
          buttonVariant={mode === "inline" ? "transparent-with-text" : "border-with-text"}
          buttonContainerClassName="w-full text-left"
          buttonClassName={cn("text-body-sm-regular", !getDate(first) && "text-placeholder")}
          disabled={disabled}
          hideIcon={false}
        />
      );
    case "MEMBER":
      return property.is_multi ? (
        <MemberDropdown
          projectId={projectId}
          value={value}
          onChange={(ids: string[]) => onChange(ids)}
          multiple
          buttonVariant={mode === "inline" ? "transparent-with-text" : "border-with-text"}
          buttonContainerClassName="w-full text-left"
          placeholder={t("wit.empty_value")}
          disabled={disabled}
          showUserDetails
        />
      ) : (
        <MemberDropdown
          projectId={projectId}
          value={first || null}
          onChange={(id: string | null) => onChange(id ? [id] : [])}
          multiple={false}
          buttonVariant={mode === "inline" ? "transparent-with-text" : "border-with-text"}
          buttonContainerClassName="w-full text-left"
          placeholder={t("wit.empty_value")}
          disabled={disabled}
          showUserDetails
        />
      );
    case "OPTION": {
      const options = property.options
        .filter((o) => o.is_active !== false && o.id)
        .map((o) => ({
          value: o.id as string,
          query: o.name,
          content: (
            <span className="flex items-center gap-2">
              {o.color && <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />}
              {o.name}
            </span>
          ),
        }));
      const names = property.options.filter((o) => o.id && value.includes(o.id)).map((o) => o.name);
      const label = (
        <span
          className={cn(
            "truncate",
            mode === "inline" ? "text-body-xs-regular" : "text-body-sm-regular",
            names.length === 0 && "text-placeholder"
          )}
        >
          {names.length ? names.join(", ") : mode === "inline" ? t("wit.empty_value") : t("wit.select")}
        </span>
      );
      const common = {
        options,
        label,
        disabled,
        className: "w-full",
        buttonClassName: cn(
          "w-full justify-between",
          mode === "inline" ? "border-none px-2 py-1 hover:bg-layer-1" : "border-[0.5px] border-subtle-1",
          hasError && "border-danger-strong"
        ),
        maxHeight: "md" as const,
        input: true,
      };
      return property.is_multi ? (
        <CustomSearchSelect {...common} multiple value={value} onChange={(ids: string[]) => onChange(ids)} />
      ) : (
        <CustomSearchSelect {...common} value={first} onChange={(id: string) => onChange(id ? [id] : [])} />
      );
    }
    case "FORMULA":
      // Computed by the server from the number properties named in the formula.
      return (
        <span
          className={cn("block px-2 py-1 text-body-xs-regular", first ? "text-primary" : "text-placeholder")}
          title={String(property.settings?.formula ?? "")}
        >
          {first || t("wit.empty_value")}
        </span>
      );
    case "CASCADING": {
      const leaves = property.options.filter(
        (o) => o.id && o.is_active !== false && !property.options.some((child) => child.parent_id === o.id)
      );
      const pathOf = (optionId?: string) => {
        const option = property.options.find((o) => o.id === optionId);
        const parent = option?.parent_id ? property.options.find((o) => o.id === option.parent_id) : undefined;
        return option ? (parent ? `${parent.name} › ${option.name}` : option.name) : "";
      };
      return (
        <CustomSearchSelect
          options={leaves.map((o) => ({ value: o.id as string, query: pathOf(o.id), content: pathOf(o.id) }))}
          label={
            <span
              className={cn(
                "truncate",
                mode === "inline" ? "text-body-xs-regular" : "text-body-sm-regular",
                !first && "text-placeholder"
              )}
            >
              {first ? pathOf(first) : mode === "inline" ? t("wit.empty_value") : t("wit.select")}
            </span>
          }
          value={first}
          onChange={(id: string) => onChange(id ? [id] : [])}
          disabled={disabled}
          className="w-full"
          buttonClassName={cn(
            "w-full justify-between",
            mode === "inline" ? "border-none px-2 py-1 hover:bg-layer-1" : "border-[0.5px] border-subtle-1",
            hasError && "border-danger-strong"
          )}
          maxHeight="md"
          input
        />
      );
    }
    case "RICH_TEXT":
      return (
        <RichTextPropertyField
          property={property}
          projectId={projectId}
          value={first}
          onChange={onChange}
          mode={mode}
          disabled={disabled}
          hasError={hasError}
        />
      );
    case "CUSTOMER":
      return (
        <CustomerPropertyField property={property} value={value} onChange={onChange} disabled={disabled} mode={mode} />
      );
    case "RELATION":
      return (
        <RelationPropertyField
          property={property}
          projectId={projectId}
          issueId={issueId}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "FILE":
      return (
        <FilePropertyField
          property={property}
          projectId={projectId}
          issueId={issueId}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
});
