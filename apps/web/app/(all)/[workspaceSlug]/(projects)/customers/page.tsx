/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { CustomersList } from "@/components/customers/customers-list";
// hooks
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function WorkspaceCustomersPage({ params }: Route.ComponentProps) {
  const { t } = useTranslation();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canUse = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
  if (workspaceUserInfo && !canUse) return <NotAuthorizedView className="h-auto" />;
  return (
    <>
      <PageHead title={t("cust.title")} />
      <CustomersList workspaceSlug={params.workspaceSlug} canCreate={canUse} />
    </>
  );
}

export default observer(WorkspaceCustomersPage);
