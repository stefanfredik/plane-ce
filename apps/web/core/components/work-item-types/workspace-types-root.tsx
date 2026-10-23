/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSelect, Loader } from "@plane/ui";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import { errorMessage } from "./constants";
import { WorkItemTypeIcon } from "./type-icon";

type Props = { workspaceSlug: string };

/** Every shared work item type of the workspace, where it is used, and a way to add it to more projects. */
export const WorkspaceWorkItemTypesRoot = observer(function WorkspaceWorkItemTypesRoot({ workspaceSlug }: Props) {
  const { t } = useTranslation();
  const store = useWorkItemType();
  const { joinedProjectIds, getProjectById } = useProject();
  const [busyTypeId, setBusyTypeId] = useState<string | null>(null);

  useEffect(() => {
    void store.fetchWorkspaceTypes(workspaceSlug);
  }, [store, workspaceSlug]);

  const types = store.workspaceTypes;
  if (types === undefined)
    return (
      <Loader className="space-y-2">
        <Loader.Item height="56px" />
        <Loader.Item height="56px" />
      </Loader>
    );
  if (types.length === 0) return <p className="text-body-sm-regular text-tertiary">{t("wit.workspace_types_empty")}</p>;

  const addToProject = async (typeId: string, projectId: string) => {
    setBusyTypeId(typeId);
    try {
      const { skipped } = await store.importTypes(workspaceSlug, projectId, [typeId]);
      setToast({
        type: skipped.length ? TOAST_TYPE.WARNING : TOAST_TYPE.SUCCESS,
        title: skipped.length ? t("wit.skipped_names", { names: skipped.join(", ") }) : t("wit.saved"),
      });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setBusyTypeId(null);
    }
  };

  return (
    <ul className="divide-y-[0.5px] divide-subtle rounded-lg border-[0.5px] border-subtle">
      {types.map((type) => {
        const otherProjects = joinedProjectIds.filter((id) => !type.project_ids.includes(id));
        return (
          <li key={type.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <WorkItemTypeIcon logoProps={type.logo_props} />
                <span className="text-body-sm-medium text-primary">{type.name}</span>
                <span className="text-caption-md-regular text-tertiary">
                  {t("wit.property_count", { count: type.property_count })}
                </span>
              </div>
              {type.description && <p className="text-caption-md-regular text-secondary">{type.description}</p>}
              <div className="flex flex-wrap gap-1">
                {type.project_ids.map((projectId) => {
                  const project = getProjectById(projectId);
                  if (!project) return null;
                  return (
                    <Link
                      key={projectId}
                      href={`/${workspaceSlug}/settings/projects/${projectId}/work-item-types`}
                      className="rounded-sm border-[0.5px] border-subtle-1 px-1.5 py-0.5 text-caption-sm-regular text-secondary hover:bg-layer-1"
                    >
                      {project.name}
                    </Link>
                  );
                })}
              </div>
            </div>
            {otherProjects.length > 0 && (
              <CustomSelect
                value={undefined}
                onChange={(projectId: string) => void addToProject(type.id, projectId)}
                disabled={busyTypeId === type.id}
                label={
                  <span className="text-body-sm-regular">
                    {busyTypeId === type.id ? t("wit.importing") : t("wit.add_to_project")}
                  </span>
                }
                buttonClassName="rounded-md border-[0.5px] border-subtle-1 px-2.5 py-1"
                placement="bottom-end"
              >
                {otherProjects.map((projectId) => (
                  <CustomSelect.Option key={projectId} value={projectId}>
                    {getProjectById(projectId)?.name}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            )}
          </li>
        );
      })}
    </ul>
  );
});
