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
import { Checkbox, EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemType } from "@/services/work-item-type.service";
import { errorMessage } from "./constants";
import { WorkItemPropertyIcon } from "./property-icon";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  issueType: TWorkItemType;
};

/** "Add existing properties": pick properties of the project pool that this type does not use yet. */
export const LinkPropertiesModal = observer(function LinkPropertiesModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, issueType } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    setQuery("");
    void store.fetchProjectProperties(workspaceSlug, projectId);
  }, [isOpen, store, workspaceSlug, projectId]);

  const used = new Set(issueType.properties.map((p) => p.id));
  const available = (store.projectProperties[projectId] ?? []).filter(
    (p) => !used.has(p.id) && p.display_name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await store.linkProperties(workspaceSlug, projectId, issueType.id, selected);
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="space-y-3 p-5">
        <h3 className="text-h5-medium text-primary">{t("wit.add_existing_properties")}</h3>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("wit.search")}
          className="w-full"
        />
        <div className="max-h-80 space-y-0.5 overflow-y-auto">
          {available.length === 0 ? (
            <p className="py-6 text-center text-body-sm-regular text-tertiary">{t("wit.no_existing_properties")}</p>
          ) : (
            available.map((property) => {
              const checked = selected.includes(property.id);
              return (
                <label
                  key={property.id}
                  htmlFor={`link-${property.id}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-layer-1"
                >
                  <Checkbox
                    id={`link-${property.id}`}
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) =>
                        checked ? prev.filter((id) => id !== property.id) : [...prev, property.id]
                      )
                    }
                  />
                  <WorkItemPropertyIcon property={property} className="text-tertiary" />
                  <span className="flex-1 truncate text-body-sm-regular text-primary">{property.display_name}</span>
                  <span className="text-caption-sm-regular text-tertiary">
                    {t(`wit.type_${property.property_type}`)}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("wit.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSubmit()}
          loading={isSubmitting}
          disabled={selected.length === 0 || isSubmitting}
        >
          {t("wit.add_selected", { count: selected.length })}
        </Button>
      </div>
    </ModalCore>
  );
});
