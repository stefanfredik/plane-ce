/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Check, Contact, Plus, X } from "lucide-react";
// plane imports
import { useOutsideClickDetector } from "@plane/hooks";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
import useDebounce from "@/hooks/use-debounce";
// local
import type { TCustomer } from "@/services/customer.service";
import type { TWorkItemProperty } from "@/services/work-item-type.service";

type Props = {
  property: TWorkItemProperty;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  mode: "form" | "inline";
};

/**
 * Picks customers for a "Customer" property. Matches come from the server (first 50), so the
 * picker stays light however many customers the workspace has.
 */
export const CustomerPropertyField = observer(function CustomerPropertyField(props: Props) {
  const { property, value, onChange, disabled = false, mode } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const store = useCustomer();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TCustomer[] | undefined>(undefined);
  const debouncedQuery = useDebounce(query, 250);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useOutsideClickDetector(containerRef, () => setIsOpen(false));

  // names of the chosen customers, loaded in batches with the other fields on screen
  const key = value.join(",");
  useEffect(() => {
    if (workspaceSlug && value.length) store.requestCustomerNames(workspaceSlug.toString(), value);
    // the ids are tracked through their joined key
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [store, workspaceSlug, key]);

  useEffect(() => {
    if (!isOpen || !workspaceSlug) return;
    let active = true;
    store
      .searchCustomers(workspaceSlug.toString(), debouncedQuery.trim())
      .then((found) => active && setResults(found))
      .catch(() => active && setResults([]));
    return () => {
      active = false;
    };
  }, [isOpen, store, workspaceSlug, debouncedQuery]);

  const toggle = (customerId: string) => {
    if (value.includes(customerId)) onChange(value.filter((id) => id !== customerId));
    else onChange(property.is_multi ? [...value, customerId] : [customerId]);
    if (!property.is_multi) setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", mode === "form" && "w-full")}>
      <div
        className={cn(
          "flex min-h-7 flex-wrap items-center gap-1 rounded-md px-1 py-0.5",
          mode === "form" && "border-[0.5px] border-subtle-1"
        )}
      >
        {value.map((id) => (
          <span
            key={id}
            className="flex max-w-full items-center gap-1 rounded-sm border-[0.5px] border-subtle-1 px-1.5 py-0.5 text-caption-md-regular"
          >
            <Contact className="size-3 shrink-0 text-tertiary" />
            <span className="truncate">{store.getCustomerName(id) ?? "…"}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={t("wit.delete")}
                className="text-tertiary hover:text-primary"
                onClick={() => onChange(value.filter((v) => v !== id))}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (property.is_multi || value.length === 0) && (
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption-md-regular text-tertiary hover:bg-layer-1"
            onClick={() => setIsOpen((open) => !open)}
          >
            <Plus className="size-3" />
            {t("wit.add_customer")}
          </button>
        )}
        {disabled && value.length === 0 && (
          <span className="px-1 text-caption-md-regular text-placeholder">{t("wit.empty_value")}</span>
        )}
      </div>
      {isOpen && (
        <div className="absolute top-full left-0 z-20 mt-1 w-64 rounded-md border-[0.5px] border-subtle-1 bg-surface-1 p-1 shadow-raised-200">
          <input
            // a picker opened on purpose should take the typing right away
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("wit.customer_search")}
            className="mb-1 w-full rounded-sm border-[0.5px] border-subtle-1 bg-transparent px-2 py-1 text-body-xs-regular outline-none"
          />
          <div className="max-h-56 overflow-y-auto">
            {results === undefined ? (
              <p className="px-2 py-1.5 text-caption-md-regular text-tertiary">…</p>
            ) : results.length === 0 ? (
              <p className="px-2 py-1.5 text-caption-md-regular text-tertiary">{t("wit.customer_none")}</p>
            ) : (
              results.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => toggle(customer.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-xs-regular hover:bg-layer-1"
                >
                  <span className="min-w-0 flex-1 truncate">{customer.name}</span>
                  {value.includes(customer.id) && <Check className="size-3.5 shrink-0 text-accent-primary" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
});
