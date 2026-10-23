/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { WorkItemTypeDetail } from "@/components/work-item-types/type-detail";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { WorkItemTypesProjectSettingsHeader } from "../header";

function WorkItemTypeSettingsPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId, typeId } = params;
  const { t } = useTranslation();
  const { getTypeById } = useWorkItemType();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();

  const canView = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const typeName = getTypeById(projectId, typeId)?.name;

  if (workspaceUserInfo && !canView) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<WorkItemTypesProjectSettingsHeader />}>
      <PageHead title={typeName ? `${typeName} - ${t("work_item_types.label")}` : undefined} />
      <div className="w-full py-4">
        <WorkItemTypeDetail workspaceSlug={workspaceSlug} projectId={projectId} typeId={typeId} isAdmin={isAdmin} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(WorkItemTypeSettingsPage);
