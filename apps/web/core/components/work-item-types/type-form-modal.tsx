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
import { cn } from "@plane/utils";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemType } from "@/services/work-item-type.service";
import { TYPE_COLORS, errorMessage, typeColor } from "./constants";
import { TYPE_ICONS } from "./type-icon";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  issueType?: TWorkItemType;
};

export const WorkItemTypeFormModal = observer(function WorkItemTypeFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, issueType } = props;
  const { t } = useTranslation();
  const { createType, updateType } = useWorkItemType();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(TYPE_COLORS[0]);
  const [icon, setIcon] = useState("Layers");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(issueType?.name ?? "");
    setDescription(issueType?.description ?? "");
    setColor(issueType ? typeColor(issueType.logo_props) : TYPE_COLORS[4]);
    setIcon(issueType?.logo_props?.icon?.name ?? "Layers");
  }, [isOpen, issueType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    const data = {
      name: name.trim(),
      description,
      logo_props: { in_use: "icon", icon: { name: icon, color } },
    };
    try {
      if (issueType) await updateType(workspaceSlug, projectId, issueType.id, data);
      else await createType(workspaceSlug, projectId, data);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("wit.saved") });
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        <h3 className="text-h4-medium text-primary">
          {issueType ? t("wit.type_edit_title") : t("wit.type_create_title")}
        </h3>
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="wit-type-name">
            {t("wit.name")}
          </label>
          <Input
            id="wit-type-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bug"
            className="w-full"
            maxLength={255}
          />
        </div>
        <div className="space-y-1">
          <label className="text-caption-md-medium text-secondary" htmlFor="wit-type-description">
            {t("wit.description")}
          </label>
          <TextArea
            id="wit-type-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-16 w-full"
          />
        </div>
        <div className="space-y-1">
          <span className="text-caption-md-medium text-secondary">{t("wit.icon")}</span>
          <div className="flex flex-wrap gap-1">
            {Object.entries(TYPE_ICONS).map(([iconName, Icon]) => (
              <button
                key={iconName}
                type="button"
                aria-label={iconName}
                onClick={() => setIcon(iconName)}
                className={cn(
                  "grid size-8 place-items-center rounded-md border-[0.5px]",
                  icon === iconName ? "border-accent-strong bg-accent-subtle" : "border-subtle hover:bg-layer-1"
                )}
              >
                <Icon className="size-4" style={{ color }} />
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-caption-md-medium text-secondary">{t("wit.color")}</span>
          <div className="flex gap-2">
            {TYPE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={cn("size-6 rounded-full border-2", color === c ? "border-primary" : "border-transparent")}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("wit.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? t("wit.saving") : t("wit.save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
