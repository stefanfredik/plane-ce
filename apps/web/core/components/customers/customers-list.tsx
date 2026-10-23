/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Contact, Plus, Search } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { Input, Loader, ToggleSwitch } from "@plane/ui";
// hooks
import useDebounce from "@/hooks/use-debounce";
import { useCustomer } from "@/hooks/store/use-customer";
// local
import { CustomerFormModal } from "./customer-form-modal";
import { CustomerLogo } from "./customer-logo";

type Props = { workspaceSlug: string; canCreate: boolean };

export const CustomersList = observer(function CustomersList({ workspaceSlug, canCreate }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const store = useCustomer();
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    void store.fetchCustomers(workspaceSlug, {
      ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
      ...(showArchived ? { archived: true } : {}),
    });
  }, [store, workspaceSlug, debouncedSearch, showArchived]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h4-medium text-primary">{t("cust.title")}</h2>
          <p className="text-body-sm-regular text-secondary">{t("cust.subtitle")}</p>
        </div>
        {canCreate && (
          <Button variant="primary" prependIcon={<Plus />} onClick={() => setIsFormOpen(true)}>
            {t("cust.new")}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-tertiary" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("cust.search")}
            className="w-full pl-8"
          />
        </div>
        <label className="flex items-center gap-2 text-body-sm-regular text-secondary">
          <ToggleSwitch value={showArchived} onChange={setShowArchived} size="sm" />
          {t("cust.show_archived")}
        </label>
      </div>

      {store.customers === undefined ? (
        <Loader className="space-y-2">
          <Loader.Item height="44px" />
          <Loader.Item height="44px" />
          <Loader.Item height="44px" />
        </Loader>
      ) : store.customers.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border-[0.5px] border-dashed border-subtle py-12 text-center">
          <Contact className="size-8 text-tertiary" />
          <p className="max-w-sm text-body-sm-regular text-secondary">
            {search ? t("cust.no_match") : t("cust.empty")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-layer-1 text-caption-md-medium text-tertiary">
              <tr>
                <th className="px-4 py-2 font-medium">{t("cust.name")}</th>
                <th className="px-4 py-2 font-medium">{t("cust.contract_status")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("cust.requests")}</th>
                <th className="px-4 py-2 text-right font-medium">{t("cust.work_items")}</th>
              </tr>
            </thead>
            <tbody>
              {store.customers.map((customer) => (
                <tr key={customer.id} className="border-t-[0.5px] border-subtle hover:bg-layer-1">
                  <td className="px-4 py-2">
                    <Link
                      href={`/${workspaceSlug}/customers/${customer.id}`}
                      className="flex items-center gap-2 text-body-sm-medium text-primary"
                    >
                      <CustomerLogo name={customer.name} size="sm" />
                      <span className="truncate">{customer.name}</span>
                      {customer.archived_at && <Archive className="size-3 text-tertiary" />}
                    </Link>
                    {(customer.domain || customer.email) && (
                      <div className="pl-7 text-caption-sm-regular text-tertiary">
                        {customer.domain || customer.email}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-body-sm-regular text-secondary">{customer.contract_status ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-body-sm-regular text-secondary">
                    {customer.customer_request_count}
                  </td>
                  <td className="px-4 py-2 text-right text-body-sm-regular text-secondary">
                    {customer.work_item_count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CustomerFormModal
        isOpen={isFormOpen}
        workspaceSlug={workspaceSlug}
        onClose={(created) => {
          setIsFormOpen(false);
          if (created) router.push(`/${workspaceSlug}/customers/${created.id}`);
        }}
      />
    </div>
  );
});
