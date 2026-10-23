/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Info, ListPlus, Pencil, Plus, Trash2, Unlink } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { Tooltip } from "@plane/propel/tooltip";
import { AlertModalCore, CustomMenu, Loader, ToggleSwitch } from "@plane/ui";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TWorkItemProperty } from "@/services/work-item-type.service";
import { errorMessage } from "./constants";
import { LinkPropertiesModal } from "./link-properties-modal";
import { WorkItemPropertyIcon } from "./property-icon";
import { WorkItemPropertyFormModal } from "./property-form-modal";
import { WorkItemTypeBadge } from "./status-badge";
import { WorkItemTypeFormModal } from "./type-form-modal";
import { WorkItemTypeIconTile } from "./type-icon";

type Props = { workspaceSlug: string; projectId: string; typeId: string; isAdmin: boolean };

type TPending = { kind: "type" } | { kind: "unlink"; property: TWorkItemProperty } | null;

export const WorkItemTypeDetail = observer(function WorkItemTypeDetail(props: Props) {
  const { workspaceSlug, projectId, typeId, isAdmin } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const store = useWorkItemType();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [propertyForm, setPropertyForm] = useState<{ open: boolean; property?: TWorkItemProperty }>({ open: false });
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const [pending, setPending] = useState<TPending>(null);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    void store.fetchProjectTypes(workspaceSlug, projectId, true);
  }, [store, workspaceSlug, projectId]);

  const data = store.projectTypes[projectId];
  const type = store.getTypeById(projectId, typeId);
  const listUrl = `/${workspaceSlug}/settings/projects/${projectId}/work-item-types`;

  const fail = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });

  if (!data)
    return (
      <Loader className="space-y-3">
        <Loader.Item height="48px" />
        <Loader.Item height="160px" />
      </Loader>
    );
  if (!type) return <p className="text-body-sm-regular text-tertiary">{t("wit.type_not_found")}</p>;

  const toggleActive = async (value: boolean) => {
    try {
      await store.updateType(workspaceSlug, projectId, type.id, { is_active: value });
    } catch (error) {
      fail(error);
    }
  };

  /** Swap with the neighbour; positions are per type and rewritten evenly spaced. */
  const move = async (index: number, direction: -1 | 1) => {
    const order = [...type.properties];
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setIsBusy(true);
    try {
      for (const [position, property] of order.entries())
        // oxlint-disable-next-line no-await-in-loop -- few properties, and the order must land in sequence
        await store.updateProperty(workspaceSlug, projectId, type.id, property.id, {
          sort_order: (position + 1) * 10000,
        });
    } catch (error) {
      fail(error);
    } finally {
      setIsBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setIsBusy(true);
    try {
      if (pending.kind === "type") {
        await store.deleteType(workspaceSlug, projectId, type.id);
        router.push(listUrl);
      } else await store.deleteProperty(workspaceSlug, projectId, type.id, pending.property.id);
      setPending(null);
    } catch (error) {
      fail(error);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <WorkItemTypeIconTile logoProps={type.logo_props} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-h4-medium text-primary">{type.name}</h2>
          {type.description && <p className="text-caption-md-regular text-tertiary">{type.description}</p>}
        </div>
        {isAdmin && (
          <>
            <Tooltip tooltipContent={type.is_default ? t("wit.default_cannot_disable") : t("wit.active")}>
              <span>
                <ToggleSwitch
                  value={type.is_active}
                  onChange={(value) => void toggleActive(value)}
                  disabled={type.is_default}
                />
              </span>
            </Tooltip>
            <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
              <CustomMenu.MenuItem onClick={() => setIsEditOpen(true)}>
                <span className="flex items-center gap-2">
                  <Pencil className="size-3.5" />
                  {t("wit.edit")}
                </span>
              </CustomMenu.MenuItem>
              {!type.is_default && (
                <CustomMenu.MenuItem onClick={() => setPending({ kind: "type" })}>
                  <span className="flex items-center gap-2 text-danger-primary">
                    <Trash2 className="size-3.5" />
                    {t("wit.delete")}
                  </span>
                </CustomMenu.MenuItem>
              )}
            </CustomMenu>
          </>
        )}
      </div>

      <div className="border-b-[0.5px] border-subtle">
        <span className="-mb-px inline-block border-b-2 border-accent-strong px-2 pb-2 text-body-sm-medium text-primary">
          {t("wit.properties_heading")}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-body-sm-medium text-secondary">{t("wit.custom_properties")}</h3>
          <span className="rounded-sm bg-accent-subtle px-1.5 text-caption-sm-medium text-accent-primary">
            {type.properties.length}
          </span>
        </div>
        {type.properties.length === 0 && (
          <p className="rounded-lg border-[0.5px] border-dashed border-subtle p-6 text-center text-body-sm-regular text-tertiary">
            {t("wit.no_properties")}
          </p>
        )}
        {type.properties.map((property, index) => (
          <div
            key={property.id}
            className="flex items-center gap-3 rounded-lg border-[0.5px] border-subtle px-4 py-3 hover:bg-layer-1"
          >
            <WorkItemPropertyIcon property={property} className="text-secondary" />
            <span className="min-w-0 flex-1 truncate text-body-sm-medium text-primary">{property.display_name}</span>
            {property.description && (
              <Tooltip tooltipContent={property.description}>
                <Info className="size-3.5 text-tertiary" />
              </Tooltip>
            )}
            {property.is_required && <WorkItemTypeBadge label={t("wit.mandatory_badge")} tone="accent" />}
            <WorkItemTypeBadge
              label={property.is_active ? t("wit.active") : t("wit.inactive")}
              tone={property.is_active ? "success" : "neutral"}
            />
            {isAdmin && (
              <CustomMenu ellipsis placement="bottom-end" closeOnSelect disabled={isBusy}>
                <CustomMenu.MenuItem onClick={() => setPropertyForm({ open: true, property })}>
                  <span className="flex items-center gap-2">
                    <Pencil className="size-3.5" />
                    {t("wit.edit")}
                  </span>
                </CustomMenu.MenuItem>
                {index > 0 && (
                  <CustomMenu.MenuItem onClick={() => void move(index, -1)}>
                    <span className="flex items-center gap-2">
                      <ArrowUp className="size-3.5" />
                      {t("wit.move_up")}
                    </span>
                  </CustomMenu.MenuItem>
                )}
                {index < type.properties.length - 1 && (
                  <CustomMenu.MenuItem onClick={() => void move(index, 1)}>
                    <span className="flex items-center gap-2">
                      <ArrowDown className="size-3.5" />
                      {t("wit.move_down")}
                    </span>
                  </CustomMenu.MenuItem>
                )}
                <CustomMenu.MenuItem onClick={() => setPending({ kind: "unlink", property })}>
                  <span className="flex items-center gap-2 text-danger-primary">
                    <Unlink className="size-3.5" />
                    {t("wit.remove_from_type")}
                  </span>
                </CustomMenu.MenuItem>
              </CustomMenu>
            )}
          </div>
        ))}
        {isAdmin && (
          <CustomMenu
            placement="bottom-start"
            closeOnSelect
            customButton={
              <span className="flex items-center gap-1 rounded-md px-2 py-1 text-body-xs-medium whitespace-nowrap text-secondary hover:bg-layer-1">
                <Plus className="size-3.5" />
                {t("wit.add_properties")}
              </span>
            }
          >
            <CustomMenu.MenuItem onClick={() => setPropertyForm({ open: true })}>
              <span className="flex items-center gap-2">
                <Plus className="size-3.5" />
                {t("wit.create_new_property")}
              </span>
            </CustomMenu.MenuItem>
            <CustomMenu.MenuItem onClick={() => setIsLinkOpen(true)}>
              <span className="flex items-center gap-2">
                <ListPlus className="size-3.5" />
                {t("wit.add_existing_properties")}
              </span>
            </CustomMenu.MenuItem>
          </CustomMenu>
        )}
      </div>

      <WorkItemTypeFormModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueType={type}
      />
      <WorkItemPropertyFormModal
        isOpen={propertyForm.open}
        onClose={() => setPropertyForm({ open: false })}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        typeId={type.id}
        property={propertyForm.property}
      />
      <LinkPropertiesModal
        isOpen={isLinkOpen}
        onClose={() => setIsLinkOpen(false)}
        workspaceSlug={workspaceSlug}
        projectId={projectId}
        issueType={type}
      />
      <AlertModalCore
        isOpen={!!pending}
        handleClose={() => setPending(null)}
        handleSubmit={confirm}
        isSubmitting={isBusy}
        title={
          pending?.kind === "unlink"
            ? t("wit.remove_property_title", { name: pending.property.display_name, type: type.name })
            : t("wit.delete_type_title", { name: type.name })
        }
        content={
          pending?.kind === "unlink"
            ? t("wit.remove_property_content")
            : (type.project_ids?.length ?? 0) > 1
              ? t("wit.remove_shared_type_content")
              : t("wit.delete_type_content")
        }
        primaryButtonText={{
          loading: t("wit.deleting"),
          default: pending?.kind === "unlink" ? t("wit.remove") : t("wit.delete"),
        }}
        secondaryButtonText={t("wit.cancel")}
      />
    </div>
  );
});
