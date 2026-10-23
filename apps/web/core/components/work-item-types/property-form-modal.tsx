/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { CornerDownRight, Plus, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Checkbox, CustomSelect, EModalPosition, EModalWidth, Input, ModalCore, TextArea } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type {
  TWorkItemProperty,
  TWorkItemPropertyOption,
  TWorkItemPropertyType,
} from "@/services/work-item-type.service";
import { DEFAULTABLE_TYPES, MULTI_VALUE_TYPES, OPTION_TYPES, PROPERTY_TYPES, errorMessage } from "./constants";
import { DEFAULT_PROPERTY_ICON, PROPERTY_ICONS, propertyIconName } from "./property-icon";
import { PropertyValueField } from "./property-value-field";

/** Options being edited; new ones get a client key until the server gives them an id. */
type TDraftOption = TWorkItemPropertyOption & { key: string; children: TDraftOption[] };

const newKey = () => Math.random().toString(36).slice(2);
const blankOption = (): TDraftOption => ({ name: "", key: newKey(), children: [] });

/** One saved option as an editable row. */
const toDraft = (option: TWorkItemPropertyOption, children: TDraftOption[]): TDraftOption => ({
  id: option.id,
  name: option.name,
  description: option.description,
  color: option.color,
  sort_order: option.sort_order,
  is_default: option.is_default,
  is_active: option.is_active,
  parent_id: option.parent_id,
  key: option.id ?? newKey(),
  children,
});

/** Saved options (flat, with parent ids) as an editable tree. */
const toDraftOptions = (options: TWorkItemPropertyOption[]): TDraftOption[] =>
  options
    .filter((o) => !o.parent_id)
    .map((o) =>
      toDraft(
        o,
        options.filter((c) => c.parent_id && c.parent_id === o.id).map((c) => toDraft(c, []))
      )
    );

/** The tree back to the API shape: names trimmed, empty rows dropped, children nested. */
const toPayloadOptions = (options: TDraftOption[], nested: boolean): TWorkItemPropertyOption[] =>
  options
    .filter((o) => o.name.trim())
    .map((o) => {
      const option: TWorkItemPropertyOption = {
        id: o.id,
        name: o.name.trim(),
        description: o.description,
        color: o.color,
        sort_order: o.sort_order,
        is_default: o.is_default,
        is_active: o.is_active,
      };
      if (nested) option.children = toPayloadOptions(o.children, false);
      return option;
    });

const checkboxField = (id: string, label: string, value: boolean, onChange: (v: boolean) => void, disabled = false) => (
  <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-body-sm-regular text-secondary">
    <Checkbox id={id} checked={value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
    {label}
  </label>
);

type TOptionRowsProps = {
  options: TDraftOption[];
  onChange: (next: TDraftOption[]) => void;
  placeholder: string;
  removeLabel: string;
  renderBelow?: (option: TDraftOption, index: number) => React.ReactNode;
};

const OptionRows = ({ options, onChange, placeholder, removeLabel, renderBelow }: TOptionRowsProps) => (
  <>
    {options.map((option, index) => (
      <div key={option.key} className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={option.name}
            onChange={(e) => onChange(options.map((o, i) => (i === index ? { ...o, name: e.target.value } : o)))}
            placeholder={placeholder}
            className="w-full"
            maxLength={255}
          />
          <button
            type="button"
            aria-label={removeLabel}
            onClick={() => onChange(options.filter((_, i) => i !== index))}
            className="grid size-7 shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
          >
            <X className="size-3.5" />
          </button>
        </div>
        {renderBelow?.(option, index)}
      </div>
    ))}
  </>
);

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  /** Create the property on this type (it still lands in the project's pool); without it, in the pool only. */
  typeId?: string;
  property?: TWorkItemProperty;
};

export const WorkItemPropertyFormModal = observer(function WorkItemPropertyFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, typeId, property } = props;
  const { t } = useTranslation();
  const { createProperty, createPoolProperty, updatePoolProperty } = useWorkItemType();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // empty until picked, like the "Select type" prompt
  const [propertyType, setPropertyType] = useState<TWorkItemPropertyType | "">("");
  const [isRequired, setIsRequired] = useState(false);
  const [isMulti, setIsMulti] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [options, setOptions] = useState<TDraftOption[]>([]);
  const [formula, setFormula] = useState("");
  const [defaultValue, setDefaultValue] = useState<string[]>([]);
  // null = follow the property type's default icon
  const [icon, setIcon] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(property?.display_name ?? "");
    setDescription(property?.description ?? "");
    setPropertyType(property?.property_type ?? "");
    setIsRequired(property?.is_required ?? false);
    setIsMulti(property?.is_multi ?? false);
    setIsActive(property?.is_active ?? true);
    setOptions(property?.options?.length ? toDraftOptions(property.options) : [blankOption()]);
    setFormula(String(property?.settings?.formula ?? ""));
    setDefaultValue(property?.default_value ?? []);
    setIcon(property ? propertyIconName(property) : null);
  }, [isOpen, property]);

  const iconName = icon ?? (propertyType ? DEFAULT_PROPERTY_ICON[propertyType] : "");

  const canBeMulti = !!propertyType && MULTI_VALUE_TYPES.includes(propertyType);
  const hasOptions = !!propertyType && OPTION_TYPES.includes(propertyType);
  const isCascading = propertyType === "CASCADING";
  const isFormula = propertyType === "FORMULA";
  const payloadOptions = toPayloadOptions(options, isCascading);
  // Defaults need saved options (ids), so option kinds get one once the property exists.
  const canSetDefault = !!propertyType && DEFAULTABLE_TYPES.includes(propertyType) && (!hasOptions || !!property);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !propertyType) return;
    setIsSubmitting(true);
    const data = {
      display_name: name.trim(),
      description,
      is_required: !isFormula && isRequired,
      is_multi: canBeMulti && isMulti,
      is_active: isActive,
      ...(property ? {} : { property_type: propertyType as TWorkItemPropertyType }),
      ...(hasOptions ? { options: payloadOptions } : {}),
      ...(isFormula ? { settings: { ...property?.settings, formula: formula.trim() } } : {}),
      ...(canSetDefault ? { default_value: defaultValue } : {}),
      logo_props: { ...property?.logo_props, in_use: "icon", icon: { name: iconName } },
    };
    try {
      // a property may be shared by several types, so edits always go to the pool
      if (property) await updatePoolProperty(workspaceSlug, projectId, property.id, data);
      else if (typeId) await createProperty(workspaceSlug, projectId, typeId, data);
      else await createPoolProperty(workspaceSlug, projectId, data);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("wit.saved") });
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
        <div className="space-y-4 overflow-y-auto p-5">
          <h3 className="text-h5-medium text-primary">
            {property ? t("wit.property_edit_title") : t("wit.property_create_title")}
          </h3>
          <div className="space-y-1">
            <label className="text-caption-md-medium text-primary" htmlFor="wit-prop-name">
              {t("wit.title")}
              <span className="text-danger-primary">*</span>
            </label>
            <Input
              id="wit-prop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("wit.title")}
              className="w-full"
              maxLength={255}
            />
          </div>
          <div className="space-y-1">
            <label className="text-caption-md-medium text-primary" htmlFor="wit-prop-description">
              {t("wit.description")}
            </label>
            <TextArea
              id="wit-prop-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("wit.description")}
              className="min-h-20 w-full"
            />
          </div>
          <div className="space-y-1">
            <span className="text-caption-md-medium text-primary">
              {t("wit.property_type_label")}
              <span className="text-danger-primary">*</span>
            </span>
            <CustomSelect
              value={propertyType}
              onChange={(value: TWorkItemPropertyType) => {
                setPropertyType(value);
                setDefaultValue([]);
                if (!MULTI_VALUE_TYPES.includes(value)) setIsMulti(false);
              }}
              label={
                <span className={propertyType ? "" : "text-placeholder"}>
                  {propertyType ? t(`wit.type_${propertyType}`) : t("wit.select_type")}
                </span>
              }
              disabled={!!property}
              buttonClassName="w-full justify-between"
              className="w-full"
              maxHeight="lg"
              input
            >
              {PROPERTY_TYPES.map((type) => (
                <CustomSelect.Option key={type} value={type}>
                  {t(`wit.type_${type}`)}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
            {property && <p className="text-caption-sm-regular text-tertiary">{t("wit.type_locked")}</p>}
          </div>
          {propertyType && (
            <div className="space-y-1">
              <span className="text-caption-md-medium text-primary">{t("wit.icon")}</span>
              <div className="flex flex-wrap gap-1">
                {Object.entries(PROPERTY_ICONS).map(([iconKey, Icon]) => (
                  <button
                    key={iconKey}
                    type="button"
                    aria-label={iconKey}
                    title={iconKey}
                    onClick={() => setIcon(iconKey)}
                    className={cn(
                      "grid size-7 place-items-center rounded-md border-[0.5px] text-secondary",
                      iconName === iconKey
                        ? "border-accent-strong bg-accent-subtle text-accent-primary"
                        : "border-subtle hover:bg-layer-1"
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {isFormula && (
            <div className="space-y-1">
              <label className="text-caption-md-medium text-secondary" htmlFor="wit-prop-formula">
                {t("wit.formula")}
              </label>
              <Input
                id="wit-prop-formula"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="{Impact} * {Likelihood}"
                className="font-mono w-full"
                maxLength={500}
              />
              <p className="text-caption-sm-regular text-tertiary">{t("wit.formula_hint")}</p>
            </div>
          )}
          {hasOptions && (
            <div className="space-y-2">
              <span className="text-caption-md-medium text-secondary">{t("wit.options")}</span>
              <OptionRows
                options={options}
                onChange={setOptions}
                placeholder={t("wit.option_placeholder")}
                removeLabel={t("wit.delete")}
                renderBelow={
                  isCascading
                    ? (option, index) => (
                        <div className="ml-6 space-y-2 border-l-[0.5px] border-subtle pl-3">
                          <OptionRows
                            options={option.children}
                            onChange={(children) =>
                              setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, children } : o)))
                            }
                            placeholder={t("wit.option_placeholder")}
                            removeLabel={t("wit.delete")}
                          />
                          <Button
                            variant="link"
                            type="button"
                            size="sm"
                            prependIcon={<CornerDownRight className="size-3.5" />}
                            onClick={() =>
                              setOptions((prev) =>
                                prev.map((o, i) =>
                                  i === index ? { ...o, children: [...o.children, blankOption()] } : o
                                )
                              )
                            }
                          >
                            {t("wit.add_sub_option")}
                          </Button>
                        </div>
                      )
                    : undefined
                }
              />
              <Button
                variant="link"
                type="button"
                size="sm"
                prependIcon={<Plus className="size-3.5" />}
                onClick={() => setOptions((prev) => [...prev, blankOption()])}
              >
                {t("wit.add_option")}
              </Button>
            </div>
          )}
          {canSetDefault && (
            <div className="space-y-1">
              <span className="text-caption-md-medium text-secondary">{t("wit.default_value")}</span>
              <PropertyValueField
                property={{
                  id: property?.id ?? "draft",
                  issue_type_id: typeId ?? null,
                  display_name: name || t("wit.default_value"),
                  description,
                  property_type: propertyType as TWorkItemPropertyType,
                  is_multi: canBeMulti && isMulti,
                  is_required: false,
                  is_active: true,
                  sort_order: 0,
                  default_value: [],
                  settings: {},
                  logo_props: {},
                  options: property?.options ?? [],
                }}
                projectId={projectId}
                value={defaultValue}
                onChange={setDefaultValue}
                mode="form"
              />
              <p className="text-caption-sm-regular text-tertiary">{t("wit.default_value_hint")}</p>
            </div>
          )}
          {canBeMulti && checkboxField("wit-prop-multi", t("wit.multiple"), isMulti, setIsMulti)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-[0.5px] border-subtle px-5 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {checkboxField("wit-prop-active", t("wit.active"), isActive, setIsActive)}
            {checkboxField("wit-prop-required", t("wit.mandatory"), !isFormula && isRequired, setIsRequired, isFormula)}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={onClose}>
              {t("wit.cancel")}
            </Button>
            <Button
              variant="primary"
              type="submit"
              loading={isSubmitting}
              disabled={
                !name.trim() ||
                !propertyType ||
                isSubmitting ||
                (hasOptions && payloadOptions.length === 0) ||
                (isFormula && !formula.trim())
              }
            >
              {isSubmitting ? t("wit.saving") : property ? t("wit.update") : t("wit.create")}
            </Button>
          </div>
        </div>
      </form>
    </ModalCore>
  );
});
