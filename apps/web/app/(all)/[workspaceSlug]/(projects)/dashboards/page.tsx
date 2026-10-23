/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { PageHead } from "@/components/core/page-title";
import { DashboardsList } from "@/components/work-item-dashboards/dashboards-list";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function WorkspaceDashboardsPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { allowPermissions } = useUserPermissions();
  const canCreate = allowPermissions(
    [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
    EUserPermissionsLevel.WORKSPACE
  );
  return (
    <>
      <PageHead title={t("dash.title")} />
      <DashboardsList workspaceSlug={params.workspaceSlug} canCreate={canCreate} />
    </>
  );
}

export default observer(WorkspaceDashboardsPage);
