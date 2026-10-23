/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, EModalPosition, EModalWidth, Input, ModalCore, TextArea } from "@plane/ui";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
// local
import type { TCustomer } from "@/services/customer.service";
import { CUSTOMER_CONTRACT_STATUSES, errorMessage } from "./constants";

type Props = {
  isOpen: boolean;
  onClose: (created?: TCustomer) => void;
  workspaceSlug: string;
  customer?: TCustomer;
};

type TDraft = {
  name: string;
  email: string;
  contract_status: string;
  description: string;
};

const EMPTY: TDraft = {
  name: "",
  email: "",
  contract_status: "",
  description: "",
};

/** The description is stored as HTML; this modal edits it as plain paragraphs. */
const htmlToText = (html: string) =>
  html
    .replace(/<\/p>\s*<p>/g, "\n")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const textToHtml = (text: string) => {
  const lines = text.split("\n").filter((line) => line.trim());
  return lines.length ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("") : "<p></p>";
};

export const CustomerFormModal = observer(function CustomerFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, customer } = props;
  const { t } = useTranslation();
  const store = useCustomer();
  const [draft, setDraft] = useState<TDraft>(EMPTY);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(
      customer
        ? {
            name: customer.name,
            email: customer.email ?? "",
            contract_status: customer.contract_status ?? "",
            description: htmlToText(customer.description_html ?? ""),
          }
        : EMPTY
    );
  }, [isOpen, customer]);

  const set = (key: keyof TDraft) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setIsSubmitting(true);
    const data = {
      name: draft.name.trim(),
      email: draft.email.trim() || null,
      contract_status: draft.contract_status || null,
      description_html: textToHtml(draft.description),
    };
    try {
      if (customer) {
        await store.updateCustomer(workspaceSlug, customer.id, data);
        onClose();
      } else onClose(await store.createCustomer(workspaceSlug, data));
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = (key: keyof TDraft, label: string, placeholder?: string, type = "text") => (
    <div className="space-y-1">
      <label className="text-caption-md-medium text-secondary" htmlFor={`customer-${key}`}>
        {label}
      </label>
      <Input
        id={`customer-${key}`}
        type={type}
        value={draft[key]}
        onChange={(e) => set(key)(e.target.value)}
        placeholder={placeholder}
        className="w-full"
        maxLength={255}
      />
    </div>
  );

  const select = (key: "contract_status", label: string, choices: string[]) => (
    <div className="space-y-1">
      <span className="text-caption-md-medium text-secondary">{label}</span>
      <CustomSelect
        value={draft[key]}
        onChange={set(key)}
        label={<span className={draft[key] ? "" : "text-placeholder"}>{draft[key] || t("cust.select")}</span>}
        buttonClassName="w-full"
        className="w-full"
        input
      >
        <CustomSelect.Option value="">{t("cust.none")}</CustomSelect.Option>
        {choices.map((choice) => (
          <CustomSelect.Option key={choice} value={choice}>
            {choice}
          </CustomSelect.Option>
        ))}
      </CustomSelect>
    </div>
  );

  return (
    <ModalCore isOpen={isOpen} handleClose={() => onClose()} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto p-5">
        <h3 className="text-h4-medium text-primary">{customer ? t("cust.edit") : t("cust.new")}</h3>
        {field("name", t("cust.name"), "PT Akses Nusantara")}
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="customer-description">
            {t("cust.description")}
          </label>
          <TextArea
            id="customer-description"
            value={draft.description}
            onChange={(e) => set("description")(e.target.value)}
            className="min-h-16 w-full"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("email", t("cust.email"), "noc@example.com", "email")}
          {select("contract_status", t("cust.contract_status"), CUSTOMER_CONTRACT_STATUSES)}
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={() => onClose()}>
            {t("cust.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting} disabled={!draft.name.trim() || isSubmitting}>
            {isSubmitting ? t("cust.saving") : customer ? t("cust.save") : t("cust.create")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
