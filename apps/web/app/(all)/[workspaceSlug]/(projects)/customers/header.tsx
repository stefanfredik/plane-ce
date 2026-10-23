/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Contact } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs, Header } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";

export const WorkspaceCustomersHeader = observer(function WorkspaceCustomersHeader() {
  const { t } = useTranslation();
  const { workspaceSlug, customerId } = useParams();
  const { details } = useCustomer();
  const customer = customerId ? details[customerId.toString()] : undefined;
  return (
    <Header>
      <Header.LeftItem>
        <Breadcrumbs>
          <Breadcrumbs.Item
            component={
              <BreadcrumbLink
                label={t("cust.title")}
                href={customerId ? `/${workspaceSlug}/customers` : undefined}
                icon={<Contact className="h-4 w-4 text-tertiary" />}
              />
            }
          />
          {customer && <Breadcrumbs.Item component={<BreadcrumbLink label={customer.name} />} />}
        </Breadcrumbs>
      </Header.LeftItem>
    </Header>
  );
});
