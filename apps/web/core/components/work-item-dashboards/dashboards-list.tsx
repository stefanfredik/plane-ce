/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bug, LayoutDashboard, Lock, Plus, Users } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, Loader } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import { bugDashboardWidgets } from "./bug-template";
import { errorMessage } from "./constants";
import { DashboardFormModal } from "./dashboard-form-modal";

type Props = { workspaceSlug: string; canCreate: boolean };

export const DashboardsList = observer(function DashboardsList({ workspaceSlug, canCreate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const store = useWorkItemDashboard();
  const typeStore = useWorkItemType();
  const { joinedProjectIds, getProjectById } = useProject();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);

  useEffect(() => {
    void store.fetchDashboards(workspaceSlug);
  }, [store, workspaceSlug]);

  const createFromTemplate = async (projectId: string) => {
    setIsCreatingTemplate(true);
    try {
      const types = (await typeStore.fetchProjectTypes(workspaceSlug, projectId)).types;
      const project = getProjectById(projectId);
      const created = await store.createDashboard(workspaceSlug, {
        name: `Bugs · ${project?.name ?? ""}`.trim(),
        widgets: bugDashboardWidgets(projectId, types, t),
      });
      router.push(`/${workspaceSlug}/dashboards/${created.id}`);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("dash.error"), message: errorMessage(error, t("dash.error")) });
    } finally {
      setIsCreatingTemplate(false);
    }
  };

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h4-medium text-primary">{t("dash.title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("dash.description")}</p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            <CustomSelect
              value={undefined}
              onChange={(projectId: string) => void createFromTemplate(projectId)}
              disabled={isCreatingTemplate}
              customButton={
                <span className="flex h-8 items-center gap-1.5 rounded-md border-[0.5px] border-subtle-1 px-3 text-body-sm-medium text-secondary hover:bg-layer-1">
                  <Bug className="size-3.5" />
                  {isCreatingTemplate ? t("dash.saving") : t("dash.bug_template")}
                </span>
              }
              placement="bottom-end"
            >
              <div className="px-2 py-1 text-caption-sm-medium text-tertiary">{t("dash.bug_template_project")}</div>
              {joinedProjectIds.map((projectId) => (
                <CustomSelect.Option key={projectId} value={projectId}>
                  {getProjectById(projectId)?.name}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
            <Button variant="primary" prependIcon={<Plus />} onClick={() => setIsFormOpen(true)}>
              {t("dash.new")}
            </Button>
          </div>
        )}
      </div>

      {store.dashboards === undefined ? (
        <Loader className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Loader.Item height="96px" />
          <Loader.Item height="96px" />
          <Loader.Item height="96px" />
        </Loader>
      ) : store.dashboards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border-[0.5px] border-dashed border-subtle py-12 text-center">
          <LayoutDashboard className="size-8 text-tertiary" />
          <p className="max-w-sm text-body-sm-regular text-secondary">{t("dash.empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {store.dashboards.map((dashboard) => (
            <Link
              key={dashboard.id}
              href={`/${workspaceSlug}/dashboards/${dashboard.id}`}
              className="flex flex-col gap-2 rounded-lg border-[0.5px] border-subtle bg-surface-1 p-4 hover:border-strong"
            >
              <div className="flex items-center gap-2">
                <LayoutDashboard className="size-4 shrink-0 text-tertiary" />
                <span className="truncate text-body-sm-medium text-primary">{dashboard.name}</span>
              </div>
              {dashboard.description && (
                <p className="line-clamp-2 text-caption-md-regular text-secondary">{dashboard.description}</p>
              )}
              <div className="mt-auto flex items-center gap-3 text-caption-md-regular text-tertiary">
                <span>{t("dash.widgets_count", { count: dashboard.widget_count })}</span>
                <span className="flex items-center gap-1">
                  {dashboard.access === 1 ? <Users className="size-3" /> : <Lock className="size-3" />}
                  {dashboard.access === 1 ? t("dash.shared_badge") : t("dash.private_badge")}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <DashboardFormModal
        isOpen={isFormOpen}
        workspaceSlug={workspaceSlug}
        onClose={(created) => {
          setIsFormOpen(false);
          if (created) router.push(`/${workspaceSlug}/dashboards/${created.id}`);
        }}
      />
    </div>
  );
});
