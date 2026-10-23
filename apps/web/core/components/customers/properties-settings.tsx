/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { Pencil, Plus, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore, Loader } from "@plane/ui";
// components
import { WorkItemPropertyIcon } from "@/components/work-item-types/property-icon";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
// local
import type { TCustomerProperty } from "@/services/customer.service";
import { asFieldProperty, errorMessage } from "./constants";
import { CustomerPropertyFormModal } from "./property-form-modal";

type Props = { workspaceSlug: string };

export const CustomerPropertiesSettings = observer(function CustomerPropertiesSettings({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const store = useCustomer();
  const [form, setForm] = useState<{ open: boolean; property?: TCustomerProperty }>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<TCustomerProperty | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void store.fetchProperties(workspaceSlug);
  }, [store, workspaceSlug]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      await store.deleteProperty(workspaceSlug, pendingDelete.id);
      setPendingDelete(null);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-body-md-medium text-primary">{t("cust.properties")}</h4>
        <Button variant="secondary" prependIcon={<Plus />} onClick={() => setForm({ open: true })}>
          {t("cust.property_new")}
        </Button>
      </div>
      {store.properties === undefined ? (
        <Loader className="space-y-2">
          <Loader.Item height="40px" />
          <Loader.Item height="40px" />
        </Loader>
      ) : store.properties.length === 0 ? (
        <p className="rounded-lg border-[0.5px] border-dashed border-subtle p-6 text-center text-body-sm-regular text-tertiary">
          {t("cust.properties_empty")}
        </p>
      ) : (
        <div className="divide-y-[0.5px] divide-subtle rounded-lg border-[0.5px] border-subtle">
          {store.properties.map((property) => (
            <div key={property.id} className="flex items-center gap-3 px-4 py-2.5">
              <WorkItemPropertyIcon property={asFieldProperty(property)} className="size-4 shrink-0 text-tertiary" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-body-sm-medium text-primary">
                  <span className="truncate">{property.display_name}</span>
                  {property.is_required && <span className="text-danger-primary">*</span>}
                  {!property.is_active && (
                    <span className="rounded-sm bg-layer-2 px-1.5 text-caption-sm-medium text-tertiary">
                      {t("cust.inactive")}
                    </span>
                  )}
                </div>
                <div className="text-caption-sm-regular text-tertiary">
                  {t(`wit.type_${property.property_type}`)}
                  {property.is_multi ? ` · ${t("wit.multiple")}` : ""}
                </div>
              </div>
              <button
                type="button"
                aria-label={t("cust.edit")}
                onClick={() => setForm({ open: true, property })}
                className="grid size-7 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("cust.delete")}
                onClick={() => setPendingDelete(property)}
                className="grid size-7 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-danger-primary"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <CustomerPropertyFormModal
        isOpen={form.open}
        property={form.property}
        workspaceSlug={workspaceSlug}
        onClose={() => setForm({ open: false })}
      />
      <AlertModalCore
        isOpen={!!pendingDelete}
        handleClose={() => setPendingDelete(null)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        title={t("cust.delete_property_title", { name: pendingDelete?.display_name ?? "" })}
        content={t("cust.delete_property_content")}
        primaryButtonText={{ loading: t("cust.deleting"), default: t("cust.delete") }}
        secondaryButtonText={t("cust.cancel")}
      />
    </div>
  );
});
