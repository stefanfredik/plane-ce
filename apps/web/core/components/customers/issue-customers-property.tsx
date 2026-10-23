/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { Contact } from "lucide-react";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSearchSelect } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { SidebarPropertyListItem } from "@/components/common/layout/sidebar/property-list-item";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
import { useUserPermissions } from "@/hooks/store/user";
// local
import { errorMessage } from "./constants";
import { CustomerLogo } from "./customer-logo";

type Props = { workspaceSlug: string; projectId: string; issueId: string; disabled: boolean };

/** The "Customers" row of a work item's properties; hidden from guests, who cannot see customers. */
export const IssueCustomersProperty = observer(function IssueCustomersProperty(props: Props) {
  const { workspaceSlug, projectId, issueId, disabled } = props;
  const { t } = useTranslation();
  const store = useCustomer();
  const { allowPermissions } = useUserPermissions();
  const canSee = allowPermissions([EUserPermissions.ADMIN, EUserPermissions.MEMBER], EUserPermissionsLevel.WORKSPACE);

  useEffect(() => {
    if (!canSee) return;
    void store.fetchIssueCustomers(workspaceSlug, projectId, issueId).catch(() => undefined);
  }, [store, canSee, workspaceSlug, projectId, issueId]);

  if (!canSee) return null;

  const linked = store.issueCustomers[issueId] ?? [];
  const value = linked.map((c) => c.id);
  // Show linked customers even before the full list is loaded.
  const choices = new Map(linked.map((c) => [c.id, c.name]));
  (store.customers ?? []).forEach((c) => choices.set(c.id, c.name));

  const handleChange = async (ids: string[]) => {
    try {
      await store.setIssueCustomers(workspaceSlug, projectId, issueId, ids);
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });
    }
  };

  return (
    <SidebarPropertyListItem icon={Contact} label={t("cust.title")}>
      <CustomSearchSelect
        multiple
        value={value}
        onChange={(ids: string[]) => void handleChange(ids)}
        onOpen={() => {
          if (store.customers === undefined) void store.fetchCustomers(workspaceSlug);
        }}
        options={Array.from(choices.entries()).map(([id, name]) => ({
          value: id,
          query: name,
          content: (
            <span className="flex items-center gap-2">
              <CustomerLogo name={name} size="sm" />
              {name}
            </span>
          ),
        }))}
        label={
          <span className={cn("flex flex-wrap gap-1 text-body-xs-regular", linked.length === 0 && "text-placeholder")}>
            {linked.length === 0
              ? t("cust.add_customer")
              : linked.map((c) => (
                  <span key={c.id} className="flex items-center gap-1 rounded-sm bg-layer-2 px-1.5 py-0.5 text-primary">
                    <CustomerLogo name={c.name} size="sm" className="size-3.5 text-[9px]" />
                    {c.name}
                    {c.request_count > 0 && <span className="text-tertiary">· {c.request_count}</span>}
                  </span>
                ))}
          </span>
        }
        disabled={disabled}
        className="w-full grow"
        buttonClassName="w-full justify-start border-none px-2 py-1 hover:bg-layer-1"
        maxHeight="md"
        noChevron
        input
      />
    </SidebarPropertyListItem>
  );
});
