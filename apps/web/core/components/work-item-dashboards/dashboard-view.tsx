/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, Trash2, Users } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { AlertModalCore, Loader } from "@plane/ui";
// hooks
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
// local
import type { TDashboardWidget } from "@/services/work-item-dashboard.service";
import { errorMessage } from "./constants";
import { DashboardFormModal } from "./dashboard-form-modal";
import { DashboardWidgetCard } from "./widget-card";
import { DashboardWidgetFormModal } from "./widget-form-modal";

type Props = { workspaceSlug: string; dashboardId: string };

export const DashboardView = observer(function DashboardView({ workspaceSlug, dashboardId }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const store = useWorkItemDashboard();
  const dashboard = store.details[dashboardId];
  const [widgetModal, setWidgetModal] = useState<{ open: boolean; widget?: TDashboardWidget }>({ open: false });
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "dashboard" } | { kind: "widget"; widget: TDashboardWidget } | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    store.fetchDashboard(workspaceSlug, dashboardId).catch(() => setNotFound(true));
  }, [store, workspaceSlug, dashboardId]);

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      if (pendingDelete.kind === "dashboard") {
        await store.deleteDashboard(workspaceSlug, dashboardId);
        router.push(`/${workspaceSlug}/dashboards`);
      } else await store.deleteWidget(workspaceSlug, dashboardId, pendingDelete.widget.id);
      setPendingDelete(null);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("dash.error"), message: errorMessage(error, t("dash.error")) });
    } finally {
      setIsDeleting(false);
    }
  };

  if (notFound) return <p className="p-6 text-body-sm-regular text-tertiary">404</p>;
  if (!dashboard)
    return (
      <Loader className="grid grid-cols-1 gap-3 p-6 md:grid-cols-3">
        <Loader.Item height="220px" />
        <Loader.Item height="220px" />
        <Loader.Item height="220px" />
      </Loader>
    );

  const widgets = dashboard.widgets ?? [];

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-h4-medium text-primary">{dashboard.name}</h2>
            <span className="flex items-center gap-1 rounded-sm bg-layer-2 px-1.5 py-0.5 text-caption-sm-medium text-secondary">
              {dashboard.access === 1 ? <Users className="size-3" /> : <Lock className="size-3" />}
              {dashboard.access === 1 ? t("dash.shared_badge") : t("dash.private_badge")}
            </span>
          </div>
          {dashboard.description && <p className="text-body-sm-regular text-secondary">{dashboard.description}</p>}
        </div>
        {dashboard.can_edit && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" prependIcon={<Pencil />} onClick={() => setIsEditOpen(true)}>
              {t("dash.edit_short")}
            </Button>
            <Button
              variant="secondary"
              prependIcon={<Trash2 />}
              onClick={() => setPendingDelete({ kind: "dashboard" })}
            >
              {t("dash.delete")}
            </Button>
            <Button variant="primary" prependIcon={<Plus />} onClick={() => setWidgetModal({ open: true })}>
              {t("dash.add_widget")}
            </Button>
          </div>
        )}
      </div>

      {widgets.length === 0 ? (
        <p className="rounded-lg border-[0.5px] border-dashed border-subtle py-12 text-center text-body-sm-regular text-tertiary">
          {t("dash.no_widgets")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {widgets.map((widget) => (
            <DashboardWidgetCard
              key={widget.id}
              workspaceSlug={workspaceSlug}
              dashboardId={dashboardId}
              widget={widget}
              canEdit={dashboard.can_edit}
              onEdit={() => setWidgetModal({ open: true, widget })}
              onDelete={() => setPendingDelete({ kind: "widget", widget })}
            />
          ))}
        </div>
      )}

      <DashboardWidgetFormModal
        isOpen={widgetModal.open}
        onClose={() => setWidgetModal({ open: false })}
        workspaceSlug={workspaceSlug}
        dashboardId={dashboardId}
        widget={widgetModal.widget}
      />
      <DashboardFormModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        workspaceSlug={workspaceSlug}
        dashboard={dashboard}
      />
      <AlertModalCore
        isOpen={!!pendingDelete}
        handleClose={() => setPendingDelete(null)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        title={
          pendingDelete?.kind === "widget"
            ? t("dash.delete_widget_title", { name: pendingDelete.widget.name })
            : t("dash.delete_title", { name: dashboard.name })
        }
        content={t("dash.delete_content")}
        primaryButtonText={{ loading: t("dash.deleting"), default: t("dash.delete") }}
        secondaryButtonText={t("dash.cancel")}
      />
    </div>
  );
});
