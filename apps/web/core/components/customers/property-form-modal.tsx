/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Plus, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, EModalPosition, EModalWidth, Input, ModalCore, TextArea, ToggleSwitch } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { DEFAULT_PROPERTY_ICON, PROPERTY_ICONS, propertyIconName } from "@/components/work-item-types/property-icon";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
// local
import type { TCustomerProperty, TCustomerPropertyType } from "@/services/customer.service";
import { CUSTOMER_MULTI_TYPES, CUSTOMER_PROPERTY_TYPES, errorMessage } from "./constants";

type TDraftOption = { id?: string; name: string; key: string };
const newKey = () => Math.random().toString(36).slice(2);

type Props = { isOpen: boolean; onClose: () => void; workspaceSlug: string; property?: TCustomerProperty };

const toggleRow = (label: string, value: boolean, onChange: (v: boolean) => void) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-body-sm-medium text-primary">{label}</span>
    <ToggleSwitch value={value} onChange={onChange} size="sm" />
  </div>
);

export const CustomerPropertyFormModal = observer(function CustomerPropertyFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, property } = props;
  const { t } = useTranslation();
  const store = useCustomer();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [propertyType, setPropertyType] = useState<TCustomerPropertyType>("TEXT");
  const [isRequired, setIsRequired] = useState(false);
  const [isMulti, setIsMulti] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [options, setOptions] = useState<TDraftOption[]>([]);
  const [icon, setIcon] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(property?.display_name ?? "");
    setDescription(property?.description ?? "");
    setPropertyType(property?.property_type ?? "TEXT");
    setIsRequired(property?.is_required ?? false);
    setIsMulti(property?.is_multi ?? false);
    setIsActive(property?.is_active ?? true);
    setOptions(
      property?.options?.length
        ? property.options.map((o) => ({ id: o.id, name: o.name, key: o.id ?? newKey() }))
        : [{ name: "", key: newKey() }]
    );
    setIcon(property ? propertyIconName(property) : null);
  }, [isOpen, property]);

  const iconName = icon ?? DEFAULT_PROPERTY_ICON[propertyType];
  const canBeMulti = CUSTOMER_MULTI_TYPES.includes(propertyType);
  const hasOptions = propertyType === "OPTION";
  const payloadOptions = options.filter((o) => o.name.trim()).map((o) => ({ id: o.id, name: o.name.trim() }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await store.saveProperty(
        workspaceSlug,
        {
          display_name: name.trim(),
          description,
          is_required: isRequired,
          is_multi: canBeMulti && isMulti,
          is_active: isActive,
          ...(property ? {} : { property_type: propertyType }),
          ...(hasOptions ? { options: payloadOptions } : {}),
          logo_props: { ...property?.logo_props, in_use: "icon", icon: { name: iconName } },
        },
        property?.id
      );
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto p-5">
        <h3 className="text-h4-medium text-primary">{property ? t("cust.property_edit") : t("cust.property_new")}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_13rem]">
          <div className="space-y-1">
            <label className="text-caption-md-medium text-secondary" htmlFor="customer-prop-name">
              {t("cust.name")}
            </label>
            <Input
              id="customer-prop-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Region"
              className="w-full"
              maxLength={255}
            />
          </div>
          <div className="space-y-1">
            <span className="text-caption-md-medium text-secondary">{t("wit.property_type")}</span>
            <CustomSelect
              value={propertyType}
              onChange={(value: TCustomerPropertyType) => {
                setPropertyType(value);
                if (!CUSTOMER_MULTI_TYPES.includes(value)) setIsMulti(false);
              }}
              label={<span>{t(`wit.type_${propertyType}`)}</span>}
              disabled={!!property}
              buttonClassName="w-full"
              className="w-full"
              maxHeight="lg"
              input
            >
              {CUSTOMER_PROPERTY_TYPES.map((type) => (
                <CustomSelect.Option key={type} value={type}>
                  {t(`wit.type_${type}`)}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-caption-md-medium text-secondary">{t("wit.icon")}</span>
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
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="customer-prop-description">
            {t("cust.description")}
          </label>
          <TextArea
            id="customer-prop-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-14 w-full"
          />
        </div>
        {hasOptions && (
          <div className="space-y-2">
            <span className="text-caption-md-medium text-secondary">{t("wit.options")}</span>
            {options.map((option, index) => (
              <div key={option.key} className="flex items-center gap-2">
                <Input
                  value={option.name}
                  onChange={(e) =>
                    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, name: e.target.value } : o)))
                  }
                  placeholder={t("wit.option_placeholder")}
                  className="w-full"
                  maxLength={255}
                />
                <button
                  type="button"
                  aria-label={t("cust.delete")}
                  onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  className="grid size-7 shrink-0 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <Button
              variant="link"
              type="button"
              size="sm"
              prependIcon={<Plus className="size-3.5" />}
              onClick={() => setOptions((prev) => [...prev, { name: "", key: newKey() }])}
            >
              {t("wit.add_option")}
            </Button>
          </div>
        )}
        <div className="space-y-3 rounded-md border-[0.5px] border-subtle p-3">
          {toggleRow(t("wit.required"), isRequired, setIsRequired)}
          {canBeMulti && toggleRow(t("wit.multiple"), isMulti, setIsMulti)}
          {property && toggleRow(t("wit.active"), isActive, setIsActive)}
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("cust.cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            loading={isSubmitting}
            disabled={!name.trim() || isSubmitting || (hasOptions && payloadOptions.length === 0)}
          >
            {isSubmitting ? t("cust.saving") : t("cust.save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
