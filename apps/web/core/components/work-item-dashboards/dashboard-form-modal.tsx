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
import { EModalPosition, EModalWidth, Input, ModalCore, TextArea, ToggleSwitch } from "@plane/ui";
// hooks
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
// local
import type { TWorkItemDashboard } from "@/services/work-item-dashboard.service";
import { errorMessage } from "./constants";

type Props = {
  isOpen: boolean;
  onClose: (created?: TWorkItemDashboard) => void;
  workspaceSlug: string;
  dashboard?: TWorkItemDashboard;
};

export const DashboardFormModal = observer(function DashboardFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, dashboard } = props;
  const { t } = useTranslation();
  const store = useWorkItemDashboard();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [shared, setShared] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(dashboard?.name ?? "");
    setDescription(dashboard?.description ?? "");
    setShared(dashboard?.access === 1);
  }, [isOpen, dashboard]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    const data = { name: name.trim(), description, access: (shared ? 1 : 0) as 0 | 1 };
    try {
      if (dashboard) {
        await store.updateDashboard(workspaceSlug, dashboard.id, data);
        onClose();
      } else onClose(await store.createDashboard(workspaceSlug, data));
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("dash.error"), message: errorMessage(error, t("dash.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={() => onClose()} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <h3 className="text-h4-medium text-primary">{dashboard ? t("dash.edit") : t("dash.new")}</h3>
        <div className="space-y-1">
          <span className="text-caption-md-medium text-secondary">{t("dash.name")}</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" maxLength={255} />
        </div>
        <div className="space-y-1">
          <span className="text-caption-md-medium text-secondary">{t("dash.description_label")}</span>
          <TextArea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-14 w-full" />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border-[0.5px] border-subtle p-3">
          <div>
            <div className="text-body-sm-medium text-primary">{t("dash.shared")}</div>
            <div className="text-caption-md-regular text-tertiary">{t("dash.shared_hint")}</div>
          </div>
          <ToggleSwitch value={shared} onChange={setShared} size="sm" />
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={() => onClose()}>
            {t("dash.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? t("dash.saving") : dashboard ? t("dash.save") : t("dash.create")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
