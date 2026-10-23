/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { CustomerDetail } from "@/components/customers/customer-detail";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
import { useUserPermissions } from "@/hooks/store/user";
import type { Route } from "./+types/page";

function WorkspaceCustomerPage({ params }: Route.ComponentProps) {
  const { details } = useCustomer();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  const canEdit = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);
  const canDelete = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.WORKSPACE);
  if (workspaceUserInfo && !canEdit) return <NotAuthorizedView className="h-auto" />;
  return (
    <>
      <PageHead title={details[params.customerId]?.name} />
      <CustomerDetail
        workspaceSlug={params.workspaceSlug}
        customerId={params.customerId}
        canEdit={canEdit}
        canDelete={canDelete}
      />
    </>
  );
}

export default observer(WorkspaceCustomerPage);
