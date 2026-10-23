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
import { AutomationEditor } from "@/components/automation/custom/automation-editor";
import { PageHead } from "@/components/core/page-title";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { AutomationsProjectSettingsHeader } from "../header";

function AutomationDetailPage({ params }: Route.ComponentProps) {
  const { workspaceSlug, projectId, automationId } = params;
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const isAdmin = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);

  if (workspaceUserInfo && !isAdmin) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<AutomationsProjectSettingsHeader />}>
      <PageHead
        title={
          currentProjectDetails?.name ? `${currentProjectDetails.name} - ${t("automations.settings.title")}` : undefined
        }
      />
      <div className="w-full py-4">
        <AutomationEditor workspaceSlug={workspaceSlug} projectId={projectId} automationId={automationId} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(AutomationDetailPage);
