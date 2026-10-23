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
import { EModalPosition, EModalWidth, Input, ModalCore, TextArea } from "@plane/ui";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
// local
import type { TCustomerRequest } from "@/services/customer.service";
import { errorMessage } from "./constants";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  customerId: string;
  request?: TCustomerRequest;
};

const htmlToText = (html: string) =>
  html
    .replace(/<\/p>\s*<p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
const textToHtml = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("") || "<p></p>";

export const CustomerRequestFormModal = observer(function CustomerRequestFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, customerId, request } = props;
  const { t } = useTranslation();
  const store = useCustomer();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(request?.name ?? "");
    setDescription(htmlToText(request?.description_html ?? ""));
    setLink(request?.link ?? "");
  }, [isOpen, request]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await store.saveRequest(
        workspaceSlug,
        customerId,
        { name: name.trim(), description_html: textToHtml(description), link: link.trim() || null },
        request?.id
      );
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <h3 className="text-h4-medium text-primary">{request ? t("cust.request_edit") : t("cust.request_new")}</h3>
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="request-name">
            {t("cust.request_title")}
          </label>
          <Input
            id="request-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
            maxLength={255}
          />
        </div>
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="request-description">
            {t("cust.description")}
          </label>
          <TextArea
            id="request-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-20 w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="request-link">
            {t("cust.request_link")}
          </label>
          <Input
            id="request-link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            className="w-full"
          />
          <p className="text-caption-sm-regular text-tertiary">{t("cust.request_link_hint")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("cust.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? t("cust.saving") : t("cust.save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
