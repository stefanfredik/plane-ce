/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { AlertModalCore, CustomMenu, Input, Loader } from "@plane/ui";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemProperty } from "@/services/work-item-type.service";
import { errorMessage } from "./constants";
import { WorkItemPropertyIcon } from "./property-icon";
import { WorkItemPropertyFormModal } from "./property-form-modal";
import { WorkItemTypeBadge } from "./status-badge";

type Props = { workspaceSlug: string; projectId: string; isAdmin: boolean };

/** The project's property pool: every property, and which types use it. */
export const WorkItemPropertiesTab = observer(function WorkItemPropertiesTab(props: Props) {
  const { workspaceSlug, projectId, isAdmin } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const [form, setForm] = useState<{ open: boolean; property?: TWorkItemProperty }>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<TWorkItemProperty | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void store.fetchProjectProperties(workspaceSlug, projectId);
  }, [store, workspaceSlug, projectId]);

  const properties = store.projectProperties[projectId];
  const typeNames = new Map(store.getProjectTypes(projectId).map((type) => [type.id, type.name]));
  const shown = useMemo(
    () => (properties ?? []).filter((p) => p.display_name.toLowerCase().includes(query.trim().toLowerCase())),
    [properties, query]
  );

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await store.deletePoolProperty(workspaceSlug, projectId, pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-body-md-medium text-primary">{t("wit.properties_heading")}</h3>
            <span className="rounded-sm bg-accent-subtle px-1.5 text-caption-sm-medium text-accent-primary">
              {properties?.length ?? 0}
            </span>
          </div>
          <p className="text-caption-md-regular text-tertiary">{t("wit.properties_pool_hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("wit.search")}
              className="h-7 w-40 pl-7"
            />
          </div>
          {isAdmin && (
            <Button variant="primary" prependIcon={<Plus />} onClick={() => setForm({ open: true })}>
              {t("wit.add_new_property")}
            </Button>
          )}
        </div>
      </div>
      {properties === undefined ? (
        <Loader className="space-y-2">
          <Loader.Item height="40px" />
          <Loader.Item height="40px" />
        </Loader>
      ) : (
        <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
          <table className="w-full min-w-[640px] text-left">
            <thead className="text-caption-md-medium text-secondary">
              <tr className="border-b-[0.5px] border-subtle">
                <th className="px-3 py-2.5 font-medium">{t("wit.name")}</th>
                <th className="px-3 py-2.5 font-medium">{t("wit.status")}</th>
                <th className="px-3 py-2.5 font-medium">{t("wit.property_type")}</th>
                <th className="px-3 py-2.5 font-medium">
                  <span className="flex items-center gap-1">
                    {t("wit.types_using")}
                    <Tooltip tooltipContent={t("wit.types_using_hint")}>
                      <Info className="size-3 text-tertiary" />
                    </Tooltip>
                  </span>
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-body-sm-regular text-tertiary">
                    {t("wit.properties_pool_empty")}
                  </td>
                </tr>
              )}
              {shown.map((property) => {
                const usedBy = (property.issue_type_ids ?? []).map((id) => typeNames.get(id)).filter(Boolean);
                return (
                  <tr key={property.id} className="border-b-[0.5px] border-subtle last:border-b-0 hover:bg-layer-1">
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 text-body-sm-medium text-primary">
                        <WorkItemPropertyIcon property={property} className="text-tertiary" />
                        <span className="truncate">{property.display_name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <WorkItemTypeBadge
                        label={property.is_active ? t("wit.active") : t("wit.inactive")}
                        tone={property.is_active ? "success" : "neutral"}
                      />
                    </td>
                    <td className="px-3 py-2.5 text-body-sm-regular text-secondary">
                      {t(`wit.type_${property.property_type}`)}
                    </td>
                    <td className="px-3 py-2.5 text-body-sm-regular text-secondary">
                      <Tooltip tooltipContent={usedBy.length ? usedBy.join(", ") : t("wit.types_using_none")}>
                        <span>{usedBy.length}</span>
                      </Tooltip>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {isAdmin && (
                        <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
                          <CustomMenu.MenuItem onClick={() => setForm({ open: true, property })}>
                            <span className="flex items-center gap-2">
                              <Pencil className="size-3.5" />
                              {t("wit.edit")}
                            </span>
                          </CustomMenu.MenuItem>
                          <CustomMenu.MenuItem onClick={() => setPendingDelete(property)}>
                            <span className="flex items-center gap-2 text-danger-primary">
                              <Trash2 className="size-3.5" />
                              {t("wit.delete")}
                            </span>
                          </CustomMenu.MenuItem>
                        </CustomMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <WorkItemPropertyFormModal
        isOpen={form.open}
        onClose={() => setForm({ open: false })}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        property={form.property}
      />
      <AlertModalCore
        isOpen={!!pendingDelete}
        handleClose={() => setPendingDelete(null)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        title={t("wit.delete_property_title", { name: pendingDelete?.display_name ?? "" })}
        content={t("wit.delete_pool_property_content", { count: pendingDelete?.issue_type_ids?.length ?? 0 })}
        primaryButtonText={{ loading: t("wit.deleting"), default: t("wit.delete") }}
        secondaryButtonText={t("wit.cancel")}
      />
    </div>
  );
});
