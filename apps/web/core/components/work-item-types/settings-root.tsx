/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { GitFork, Layers, Link2, ListTree, Rows3 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemType } from "@/services/work-item-type.service";
import { BUG_TEMPLATE, errorMessage } from "./constants";
import { ImportWorkItemTypesModal } from "./import-types-modal";
import { WorkItemHierarchyTab } from "./hierarchy-tab";
import { WorkItemPropertiesTab } from "./properties-tab";
import { WorkItemTypeFormModal } from "./type-form-modal";
import { WorkItemTypesTab } from "./types-tab";

type Props = { workspaceSlug: string; projectId: string; isAdmin: boolean };

type TTab = "types" | "properties" | "hierarchy";

export const WorkItemTypesSettingsRoot = observer(function WorkItemTypesSettingsRoot(props: Props) {
  const { workspaceSlug, projectId, isAdmin } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const data = store.projectTypes[projectId];

  const [isEnabling, setIsEnabling] = useState(false);
  const [isAddingTemplate, setIsAddingTemplate] = useState(false);
  const [typeModal, setTypeModal] = useState<{ open: boolean; type?: TWorkItemType }>({ open: false });
  const [tab, setTab] = useState<TTab>("types");
  const [pendingDelete, setPendingDelete] = useState<TWorkItemType | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);

  useEffect(() => {
    void store.fetchProjectTypes(workspaceSlug, projectId, true);
  }, [store, workspaceSlug, projectId]);

  const fail = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      await store.enable(workspaceSlug, projectId);
    } catch (error) {
      fail(error);
    } finally {
      setIsEnabling(false);
    }
  };

  const handleAddBugTemplate = async () => {
    setIsAddingTemplate(true);
    try {
      const created = await store.createType(workspaceSlug, projectId, {
        name: BUG_TEMPLATE.name,
        description: BUG_TEMPLATE.description,
        logo_props: { in_use: "icon", icon: { name: "Bug", color: BUG_TEMPLATE.color } },
      });
      // One at a time so the properties keep the template's order.
      for (const property of BUG_TEMPLATE.properties) {
        // oxlint-disable-next-line no-await-in-loop
        await store.createProperty(workspaceSlug, projectId, created.id, property);
      }
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("wit.saved"), message: t("wit.bug_template_added") });
    } catch (error) {
      fail(error);
    } finally {
      setIsAddingTemplate(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await store.deleteType(workspaceSlug, projectId, pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      fail(error);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!data)
    return (
      <Loader className="space-y-3">
        <Loader.Item height="64px" />
        <Loader.Item height="160px" />
      </Loader>
    );

  if (!data.is_enabled)
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border-[0.5px] border-subtle bg-layer-1 p-6">
        <Layers className="size-6 text-tertiary" />
        <h3 className="text-h5-medium text-primary">{t("wit.enable_title")}</h3>
        <p className="max-w-xl text-body-sm-regular text-secondary">{t("wit.enable_description")}</p>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={handleEnable} loading={isEnabling} disabled={isEnabling}>
              {t("wit.enable_button")}
            </Button>
            <Button variant="secondary" prependIcon={<Link2 />} onClick={() => setIsImportOpen(true)}>
              {t("wit.import_types")}
            </Button>
          </div>
        )}
        <ImportWorkItemTypesModal
          isOpen={isImportOpen}
          onClose={() => setIsImportOpen(false)}
          workspaceSlug={workspaceSlug}
          projectId={projectId}
        />
      </div>
    );

  const hasBugType = data.types.some((type) => type.name.toLowerCase() === "bug");
  const tabs: { key: TTab; label: string; icon: typeof Rows3 }[] = [
    { key: "types", label: t("work_item_types.label"), icon: Rows3 },
    { key: "properties", label: t("wit.properties_heading"), icon: ListTree },
    { key: "hierarchy", label: t("wit.hierarchy"), icon: GitFork },
  ];

  return (
    <div className="space-y-5">
      <div className="flex gap-1 border-b-[0.5px] border-subtle" role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-2 pb-2 text-body-sm-medium",
              tab === key
                ? "border-accent-strong text-primary"
                : "border-transparent text-tertiary hover:text-secondary"
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "types" && (
        <WorkItemTypesTab
          workspaceSlug={workspaceSlug}
          projectId={projectId}
          types={data.types}
          isAdmin={isAdmin}
          isAddingTemplate={isAddingTemplate}
          onAdd={() => setTypeModal({ open: true })}
          onAddBugTemplate={hasBugType ? undefined : () => void handleAddBugTemplate()}
          onImport={() => setIsImportOpen(true)}
          onEdit={(type) => setTypeModal({ open: true, type })}
          onDelete={(type) => setPendingDelete(type)}
        />
      )}
      {tab === "properties" && (
        <WorkItemPropertiesTab workspaceSlug={workspaceSlug} projectId={projectId} isAdmin={isAdmin} />
      )}
      {tab === "hierarchy" && <WorkItemHierarchyTab types={data.types} />}

      <WorkItemTypeFormModal
        isOpen={typeModal.open}
        onClose={() => setTypeModal({ open: false })}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueType={typeModal.type}
      />
      <ImportWorkItemTypesModal
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
      />
      <AlertModalCore
        isOpen={!!pendingDelete}
        handleClose={() => setPendingDelete(null)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        title={t("wit.delete_type_title", { name: pendingDelete?.name ?? "" })}
        content={
          (pendingDelete?.project_ids?.length ?? 0) > 1
            ? t("wit.remove_shared_type_content")
            : t("wit.delete_type_content")
        }
        primaryButtonText={{ loading: t("wit.deleting"), default: t("wit.delete") }}
        secondaryButtonText={t("wit.cancel")}
      />
    </div>
  );
});
