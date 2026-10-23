/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// components
import { PageHead } from "@/components/core/page-title";
import { DashboardView } from "@/components/work-item-dashboards/dashboard-view";
// hooks
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
import type { Route } from "./+types/page";

function WorkspaceDashboardPage({ params }: Route.ComponentProps) {
  const { details } = useWorkItemDashboard();
  return (
    <>
      <PageHead title={details[params.dashboardId]?.name} />
      <DashboardView workspaceSlug={params.workspaceSlug} dashboardId={params.dashboardId} />
    </>
  );
}

export default observer(WorkspaceDashboardPage);
