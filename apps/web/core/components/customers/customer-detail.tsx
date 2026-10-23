/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, ExternalLink, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { AlertModalCore, Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { PropertyValueField } from "@/components/work-item-types/property-value-field";
import { WorkItemPropertyIcon } from "@/components/work-item-types/property-icon";
// hooks
import { useCustomer } from "@/hooks/store/use-customer";
import { useProject } from "@/hooks/store/use-project";
// local
import type { TCustomerRequest, TCustomerWorkItem } from "@/services/customer.service";
import { asFieldProperty, errorMessage } from "./constants";
import { CustomerFormModal } from "./customer-form-modal";
import { CustomerLogo } from "./customer-logo";
import { CustomerRequestFormModal } from "./request-form-modal";
import { workspaceWorkItemSearch } from "./work-item-search";

type Props = { workspaceSlug: string; customerId: string; canEdit: boolean; canDelete: boolean };

type TTab = "requests" | "work_items";

/** Where linking work items is going: the customer itself, or one of its requests. */
type TLinkTarget = { kind: "customer" } | { kind: "request"; request: TCustomerRequest };

const WorkItemRow = ({
  workspaceSlug,
  item,
  onRemove,
  removeLabel,
}: {
  workspaceSlug: string;
  item: TCustomerWorkItem;
  onRemove?: () => void;
  removeLabel: string;
}) => (
  <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-layer-1">
    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.state_color ?? "#999" }} />
    <span className="shrink-0 text-caption-md-medium text-tertiary">
      {item.project__identifier}-{item.sequence_id}
    </span>
    <Link
      href={`/${workspaceSlug}/browse/${item.project__identifier}-${item.sequence_id}/`}
      className="truncate text-body-sm-regular text-primary hover:underline"
    >
      {item.name}
    </Link>
    <span className="ml-auto shrink-0 text-caption-sm-regular text-tertiary">{item.state_name}</span>
    {onRemove && (
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
        className="grid size-6 shrink-0 place-items-center rounded-sm text-tertiary opacity-0 group-hover:opacity-100 hover:bg-layer-2 hover:text-primary focus:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

const attribute = (label: string, value: React.ReactNode) => (
  <div className="grid grid-cols-[8rem_1fr] items-center gap-2">
    <span className="text-caption-md-regular text-tertiary">{label}</span>
    <span className="truncate text-body-sm-regular text-primary">{value || "—"}</span>
  </div>
);

export const CustomerDetail = observer(function CustomerDetail(props: Props) {
  const { workspaceSlug, customerId, canEdit, canDelete } = props;
  const { t } = useTranslation();
  const router = useRouter();
  const store = useCustomer();
  const { joinedProjectIds } = useProject();
  const [tab, setTab] = useState<TTab>("requests");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [requestForm, setRequestForm] = useState<{ open: boolean; request?: TCustomerRequest }>({ open: false });
  const [linkTarget, setLinkTarget] = useState<TLinkTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "customer" } | { kind: "request"; request: TCustomerRequest } | null
  >(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setNotFound(false);
    store.fetchCustomer(workspaceSlug, customerId).catch(() => setNotFound(true));
    void store.fetchProperties(workspaceSlug);
    void store.fetchRequests(workspaceSlug, customerId);
    void store.fetchWorkItems(workspaceSlug, customerId);
  }, [store, workspaceSlug, customerId]);

  const customer = store.details[customerId];
  const requests = store.requests[customerId];
  const workItems = store.workItems[customerId];
  const properties = (store.properties ?? []).filter((p) => p.is_active);
  const itemById = new Map((workItems ?? []).map((item) => [item.id, item]));

  const fail = (error: unknown) =>
    setToast({ type: TOAST_TYPE.ERROR, title: t("cust.error"), message: errorMessage(error, t("cust.error")) });

  if (notFound) return <div className="p-6 text-body-sm-regular text-secondary">{t("cust.not_found")}</div>;
  if (!customer)
    return (
      <Loader className="space-y-3 p-6">
        <Loader.Item height="48px" />
        <Loader.Item height="200px" />
      </Loader>
    );

  const saveValue = async (propertyId: string, value: string[]) => {
    try {
      await store.saveValues(workspaceSlug, customerId, { [propertyId]: value });
    } catch (error) {
      fail(error);
    }
  };

  const handleLink = async (selected: ISearchIssueResponse[]) => {
    const ids = selected.map((issue) => issue.id);
    try {
      if (linkTarget?.kind === "request") {
        const merged = Array.from(new Set([...linkTarget.request.work_item_ids, ...ids]));
        await store.saveRequest(workspaceSlug, customerId, { work_item_ids: merged }, linkTarget.request.id);
      } else await store.linkWorkItems(workspaceSlug, customerId, ids);
    } catch (error) {
      fail(error);
    }
  };

  const unlinkFromRequest = async (request: TCustomerRequest, issueId: string) => {
    try {
      await store.saveRequest(
        workspaceSlug,
        customerId,
        { work_item_ids: request.work_item_ids.filter((id) => id !== issueId) },
        request.id
      );
    } catch (error) {
      fail(error);
    }
  };

  const toggleArchive = async () => {
    try {
      await store.updateCustomer(workspaceSlug, customerId, { archived: !customer.archived_at });
    } catch (error) {
      fail(error);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      if (pendingDelete.kind === "customer") {
        await store.deleteCustomer(workspaceSlug, customerId);
        router.push(`/${workspaceSlug}/customers`);
      } else await store.deleteRequest(workspaceSlug, customerId, pendingDelete.request.id);
      setPendingDelete(null);
    } catch (error) {
      fail(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const linkedIds =
    linkTarget?.kind === "request" ? linkTarget.request.work_item_ids : (workItems ?? []).map((item) => item.id);

  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-start gap-4">
          <CustomerLogo name={customer.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-h4-medium text-primary">{customer.name}</h2>
              {customer.archived_at && (
                <span className="rounded-sm bg-layer-2 px-1.5 py-0.5 text-caption-sm-medium text-secondary">
                  {t("cust.archived")}
                </span>
              )}
            </div>
            {customer.website_url && (
              <a
                href={customer.website_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-body-sm-regular text-accent-primary hover:underline"
              >
                {customer.website_url}
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" prependIcon={<Pencil />} onClick={() => setIsEditOpen(true)}>
                {t("cust.edit")}
              </Button>
              <Button
                variant="secondary"
                prependIcon={customer.archived_at ? <ArchiveRestore /> : <Archive />}
                onClick={() => void toggleArchive()}
              >
                {customer.archived_at ? t("cust.restore") : t("cust.archive")}
              </Button>
              {canDelete && (
                <Button
                  variant="error-outline"
                  prependIcon={<Trash2 />}
                  onClick={() => setPendingDelete({ kind: "customer" })}
                >
                  {t("cust.delete")}
                </Button>
              )}
            </div>
          )}
        </div>

        {customer.description_html && customer.description_html !== "<p></p>" && (
          <div
            className="prose-sm max-w-none text-body-sm-regular text-secondary"
            // Sanitised on the server (validate_html_content) before it is stored.
            dangerouslySetInnerHTML={{ __html: customer.description_html }}
          />
        )}

        <div className="border-b-[0.5px] border-subtle">
          <div className="flex gap-4" role="tablist">
            {(["requests", "work_items"] as TTab[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-1 pb-2 text-body-sm-medium",
                  tab === key
                    ? "border-accent-strong text-primary"
                    : "border-transparent text-tertiary hover:text-secondary"
                )}
              >
                {key === "requests"
                  ? `${t("cust.requests")} · ${customer.customer_request_count}`
                  : `${t("cust.work_items")} · ${customer.work_item_count}`}
              </button>
            ))}
          </div>
        </div>

        {tab === "requests" ? (
          <div className="space-y-3">
            {canEdit && (
              <Button variant="secondary" prependIcon={<Plus />} onClick={() => setRequestForm({ open: true })}>
                {t("cust.request_new")}
              </Button>
            )}
            {requests === undefined ? (
              <Loader>
                <Loader.Item height="80px" />
              </Loader>
            ) : requests.length === 0 ? (
              <p className="text-body-sm-regular text-tertiary">{t("cust.requests_empty")}</p>
            ) : (
              requests.map((request) => (
                <div key={request.id} className="space-y-2 rounded-lg border-[0.5px] border-subtle p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-body-sm-medium text-primary">{request.name}</div>
                      {request.description_html && request.description_html !== "<p></p>" && (
                        <div
                          className="text-body-xs-regular text-secondary"
                          dangerouslySetInnerHTML={{ __html: request.description_html }}
                        />
                      )}
                      {request.link && (
                        <a
                          href={request.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-caption-md-regular text-accent-primary hover:underline"
                        >
                          <Link2 className="size-3" />
                          {request.link}
                        </a>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label={t("cust.edit")}
                          onClick={() => setRequestForm({ open: true, request })}
                          className="grid size-7 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("cust.delete")}
                          onClick={() => setPendingDelete({ kind: "request", request })}
                          className="grid size-7 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-danger-primary"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-0.5 border-t-[0.5px] border-subtle pt-2">
                    {request.work_item_ids.map((id) => {
                      const item = itemById.get(id);
                      return item ? (
                        <WorkItemRow
                          key={id}
                          workspaceSlug={workspaceSlug}
                          item={item}
                          removeLabel={t("cust.unlink")}
                          onRemove={canEdit ? () => void unlinkFromRequest(request, id) : undefined}
                        />
                      ) : null;
                    })}
                    {canEdit && (
                      <Button
                        variant="link"
                        size="sm"
                        prependIcon={<Plus className="size-3.5" />}
                        onClick={() => setLinkTarget({ kind: "request", request })}
                      >
                        {t("cust.link_work_items")}
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {canEdit && (
              <Button variant="secondary" prependIcon={<Plus />} onClick={() => setLinkTarget({ kind: "customer" })}>
                {t("cust.link_work_items")}
              </Button>
            )}
            {workItems === undefined ? (
              <Loader>
                <Loader.Item height="120px" />
              </Loader>
            ) : workItems.length === 0 ? (
              <p className="text-body-sm-regular text-tertiary">{t("cust.work_items_empty")}</p>
            ) : (
              <div className="rounded-lg border-[0.5px] border-subtle p-1">
                {workItems.map((item) => (
                  <WorkItemRow
                    key={item.id}
                    workspaceSlug={workspaceSlug}
                    item={item}
                    removeLabel={t("cust.unlink")}
                    onRemove={
                      canEdit
                        ? () => void store.unlinkWorkItem(workspaceSlug, customerId, item.id).catch(fail)
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 space-y-4 lg:w-80">
        <div className="space-y-2 rounded-lg border-[0.5px] border-subtle p-4">
          <h3 className="text-body-sm-medium text-primary">{t("cust.attributes")}</h3>
          {attribute(t("cust.email"), customer.email)}
          {attribute(t("cust.domain"), customer.domain)}
          {attribute(t("cust.employees"), customer.employees?.toLocaleString())}
          {attribute(t("cust.stage"), customer.stage)}
          {attribute(t("cust.contract_status"), customer.contract_status)}
          {attribute(t("cust.revenue"), customer.revenue)}
        </div>
        {properties.length > 0 && (
          <div className="space-y-2 rounded-lg border-[0.5px] border-subtle p-4">
            <h3 className="text-body-sm-medium text-primary">{t("cust.properties")}</h3>
            {properties.map((property) => (
              <div key={property.id} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-caption-md-regular text-tertiary">
                  <WorkItemPropertyIcon property={asFieldProperty(property)} className="size-3.5 shrink-0" />
                  <span className="truncate">{property.display_name}</span>
                </span>
                <PropertyValueField
                  property={asFieldProperty(property)}
                  projectId=""
                  value={customer.property_values?.[property.id] ?? []}
                  onChange={(value) => void saveValue(property.id, value)}
                  mode="inline"
                  disabled={!canEdit}
                />
              </div>
            ))}
          </div>
        )}
      </aside>

      <CustomerFormModal
        isOpen={isEditOpen}
        workspaceSlug={workspaceSlug}
        customer={customer}
        onClose={() => setIsEditOpen(false)}
      />
      <CustomerRequestFormModal
        isOpen={requestForm.open}
        workspaceSlug={workspaceSlug}
        customerId={customerId}
        request={requestForm.request}
        onClose={() => setRequestForm({ open: false })}
      />
      <ExistingIssuesListModal
        workspaceSlug={workspaceSlug}
        isOpen={!!linkTarget}
        handleClose={() => setLinkTarget(null)}
        searchParams={{}}
        handleOnSubmit={handleLink}
        shouldHideIssue={(issue) => linkedIds.includes(issue.id)}
        workItemSearchServiceCallback={workspaceWorkItemSearch(workspaceSlug, joinedProjectIds[0])}
      />
      <AlertModalCore
        isOpen={!!pendingDelete}
        handleClose={() => setPendingDelete(null)}
        handleSubmit={handleDelete}
        isSubmitting={isDeleting}
        title={
          pendingDelete?.kind === "request"
            ? t("cust.delete_request_title", { name: pendingDelete.request.name })
            : t("cust.delete_title", { name: customer.name })
        }
        content={pendingDelete?.kind === "request" ? t("cust.delete_request_content") : t("cust.delete_content")}
        primaryButtonText={{ loading: t("cust.deleting"), default: t("cust.delete") }}
        secondaryButtonText={t("cust.cancel")}
      />
    </div>
  );
});
