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
import { EModalPosition, EModalWidth, Loader, ModalCore } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import { errorMessage } from "./constants";
import { WorkItemTypeIcon } from "./type-icon";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
};

/** Reuse a type another project already defined, so both share one set of properties. */
export const ImportWorkItemTypesModal = observer(function ImportWorkItemTypesModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const { getProjectById } = useProject();
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelected([]);
    void store.fetchWorkspaceTypes(workspaceSlug);
  }, [isOpen, store, workspaceSlug]);

  const available = (store.workspaceTypes ?? []).filter((type) => !type.project_ids.includes(projectId));

  const handleImport = async () => {
    setIsSubmitting(true);
    try {
      const { skipped } = await store.importTypes(workspaceSlug, projectId, selected);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("wit.saved"),
        message: skipped.length ? t("wit.skipped_names", { names: skipped.join(", ") }) : undefined,
      });
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.LG}>
      <div className="space-y-4 p-5">
        <div>
          <h3 className="text-h4-medium text-primary">{t("wit.import_types_title")}</h3>
          <p className="text-body-sm-regular text-secondary">{t("wit.import_types_description")}</p>
        </div>
        {store.workspaceTypes === undefined ? (
          <Loader className="space-y-2">
            <Loader.Item height="40px" />
            <Loader.Item height="40px" />
          </Loader>
        ) : available.length === 0 ? (
          <p className="text-body-sm-regular text-tertiary">{t("wit.import_types_empty")}</p>
        ) : (
          <ul className="divide-y-[0.5px] divide-subtle rounded-md border-[0.5px] border-subtle">
            {available.map((type) => {
              const checked = selected.includes(type.id);
              const projects = type.project_ids
                .map((id) => getProjectById(id)?.name)
                .filter(Boolean)
                .join(", ");
              return (
                <li key={type.id}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-layer-1">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() =>
                        setSelected((prev) => (checked ? prev.filter((id) => id !== type.id) : [...prev, type.id]))
                      }
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-body-sm-medium text-primary">
                        <WorkItemTypeIcon logoProps={type.logo_props} />
                        {type.name}
                        <span className="text-caption-md-regular text-tertiary">
                          {t("wit.property_count", { count: type.property_count })}
                        </span>
                      </span>
                      {projects && (
                        <span className="block truncate text-caption-md-regular text-tertiary">
                          {t("wit.projects")}: {projects}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" onClick={onClose}>
            {t("wit.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleImport()}
            loading={isSubmitting}
            disabled={selected.length === 0 || isSubmitting}
          >
            {isSubmitting ? t("wit.importing") : t("wit.import")}
          </Button>
        </div>
      </div>
    </ModalCore>
  );
});
