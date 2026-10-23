/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { CustomSearchSelect, CustomSelect, EModalPosition, EModalWidth, Input, ModalCore } from "@plane/ui";
import { cn } from "@plane/utils";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type {
  TDashboardWidget,
  TDashboardWidgetConfig,
  TDashboardWidgetType,
} from "@/services/work-item-dashboard.service";
import { GROUP_BY_OPTIONS, PRIORITIES, STATE_GROUPS, TABLE_ORDERS, WIDGET_TYPES, errorMessage } from "./constants";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  dashboardId: string;
  widget?: TDashboardWidget;
};

const GROUPABLE = new Set(["OPTION", "CASCADING", "MEMBER", "BOOLEAN"]);

const label = (text: string) => <span className="text-caption-md-medium text-secondary">{text}</span>;

export const DashboardWidgetFormModal = observer(function DashboardWidgetFormModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, dashboardId, widget } = props;
  const { t } = useTranslation();
  const store = useWorkItemDashboard();
  const typeStore = useWorkItemType();
  const { joinedProjectIds, getProjectById } = useProject();

  const [name, setName] = useState("");
  const [widgetType, setWidgetType] = useState<TDashboardWidgetType>("BAR");
  const [width, setWidth] = useState(1);
  const [config, setConfig] = useState<TDashboardWidgetConfig>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(widget?.name ?? "");
    setWidgetType(widget?.widget_type ?? "BAR");
    setWidth(widget?.width ?? 1);
    setConfig(widget?.config ?? { group_by: "state_group", metric: "count" });
  }, [isOpen, widget]);

  const filters = config.filters ?? {};
  const setFilter = (key: keyof NonNullable<TDashboardWidgetConfig["filters"]>, value: unknown) =>
    setConfig((prev) => ({ ...prev, filters: { ...prev.filters, [key]: value } }));

  // Types and properties come from the chosen projects (or every project when none is chosen).
  const scopeProjectIds = config.project_ids?.length ? config.project_ids : joinedProjectIds;
  useEffect(() => {
    if (!isOpen) return;
    for (const projectId of scopeProjectIds) void typeStore.fetchProjectTypes(workspaceSlug, projectId);
  }, [isOpen, typeStore, workspaceSlug, scopeProjectIds]);

  // Read straight from the observable store so the list follows types as they load.
  const types = (() => {
    const byId = new Map<string, ReturnType<typeof typeStore.getProjectTypes>[number]>();
    for (const projectId of scopeProjectIds)
      for (const type of typeStore.getProjectTypes(projectId)) byId.set(type.id, type);
    return [...byId.values()];
  })();
  const properties = types.flatMap((type) =>
    type.properties.filter((p) => p.is_active).map((p) => ({ type, property: p }))
  );
  const optionChoices = properties
    .filter(({ property }) => property.property_type === "OPTION" || property.property_type === "CASCADING")
    .flatMap(({ type, property }) =>
      property.options
        .filter((o) => o.id)
        .map((o) => ({
          value: o.id as string,
          query: `${property.display_name} ${o.name}`,
          content: `${type.name} · ${property.display_name}: ${o.name}`,
        }))
    );
  const groupChoices = [
    ...GROUP_BY_OPTIONS.map((key) => ({ value: key, label: t(`dash.group_${key}`) })),
    ...properties
      .filter(({ property }) => GROUPABLE.has(property.property_type) && !property.is_multi)
      .map(({ type, property }) => ({
        value: `customproperty_${property.id}`,
        label: `${type.name} · ${property.display_name}`,
      })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await store.saveWidget(
        workspaceSlug,
        dashboardId,
        { name: name.trim(), widget_type: widgetType, width, config },
        widget?.id
      );
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("dash.error"), message: errorMessage(error, t("dash.error")) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const multiLabel = (selected: string[] | undefined, nameOf: (value: string) => string, empty: string) => (
    <span className={cn("truncate text-body-sm-regular", !selected?.length && "text-placeholder")}>
      {selected?.length ? selected.map(nameOf).join(", ") : empty}
    </span>
  );
  const selectClass = "w-full justify-between border-[0.5px] border-subtle-1";

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <form onSubmit={handleSubmit} className="max-h-[85vh] space-y-4 overflow-y-auto p-5">
        <h3 className="text-h4-medium text-primary">{widget ? t("dash.edit_widget") : t("dash.add_widget")}</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_12rem_9rem]">
          <div className="space-y-1">
            {label(t("dash.name"))}
            <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" maxLength={255} />
          </div>
          <div className="space-y-1">
            {label(t("dash.widget_type"))}
            <CustomSelect
              value={widgetType}
              onChange={(value: TDashboardWidgetType) => setWidgetType(value)}
              label={<span>{t(`dash.type_${widgetType}`)}</span>}
              buttonClassName="w-full"
              className="w-full"
              input
            >
              {WIDGET_TYPES.map((type) => (
                <CustomSelect.Option key={type} value={type}>
                  {t(`dash.type_${type}`)}
                </CustomSelect.Option>
              ))}
            </CustomSelect>
          </div>
          <div className="space-y-1">
            {label(t("dash.width"))}
            <div className="flex rounded-md border-[0.5px] border-subtle-1 p-0.5">
              {[1, 2, 3].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setWidth(value)}
                  className={cn(
                    "flex-1 rounded-sm py-1 text-caption-md-medium",
                    width === value ? "bg-accent-primary text-on-color" : "text-secondary hover:bg-layer-1"
                  )}
                >
                  {t(`dash.width_${value}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          {label(t("dash.projects"))}
          <CustomSearchSelect
            multiple
            value={config.project_ids ?? []}
            onChange={(ids: string[]) => setConfig((prev) => ({ ...prev, project_ids: ids }))}
            options={joinedProjectIds.map((id) => ({
              value: id,
              query: getProjectById(id)?.name ?? id,
              content: getProjectById(id)?.name ?? id,
            }))}
            label={multiLabel(config.project_ids, (id) => getProjectById(id)?.name ?? id, t("dash.all_projects"))}
            buttonClassName={selectClass}
            className="w-full"
            input
          />
        </div>

        <fieldset className="space-y-3 rounded-md border-[0.5px] border-subtle p-3">
          <legend className="px-1 text-caption-md-medium text-secondary">{t("dash.filters")}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              {label(t("dash.work_item_types"))}
              <CustomSearchSelect
                multiple
                value={filters.type_ids ?? []}
                onChange={(ids: string[]) => setFilter("type_ids", ids)}
                options={types.map((type) => ({ value: type.id, query: type.name, content: type.name }))}
                label={multiLabel(filters.type_ids, (id) => types.find((ty) => ty.id === id)?.name ?? "…", "—")}
                buttonClassName={selectClass}
                className="w-full"
                input
              />
            </div>
            <div className="space-y-1">
              {label(t("dash.state_groups"))}
              <CustomSearchSelect
                multiple
                value={filters.state_groups ?? []}
                onChange={(values: string[]) => setFilter("state_groups", values)}
                options={STATE_GROUPS.map((g) => ({
                  value: g,
                  query: g,
                  content: <span className="capitalize">{g}</span>,
                }))}
                label={multiLabel(filters.state_groups, (g) => g, "—")}
                buttonClassName={selectClass}
                className="w-full"
                input
              />
            </div>
            <div className="space-y-1">
              {label(t("dash.priorities"))}
              <CustomSearchSelect
                multiple
                value={filters.priorities ?? []}
                onChange={(values: string[]) => setFilter("priorities", values)}
                options={PRIORITIES.map((p) => ({
                  value: p,
                  query: p,
                  content: <span className="capitalize">{p}</span>,
                }))}
                label={multiLabel(filters.priorities, (p) => p, "—")}
                buttonClassName={selectClass}
                className="w-full"
                input
              />
            </div>
            <div className="space-y-1">
              {label(t("dash.created_within"))}
              <Input
                type="number"
                min={1}
                value={filters.created_within_days ?? ""}
                onChange={(e) => setFilter("created_within_days", e.target.value ? Number(e.target.value) : null)}
                className="w-full"
              />
            </div>
            {optionChoices.length > 0 && (
              <div className="space-y-1 sm:col-span-2">
                {label(t("dash.property_options"))}
                <CustomSearchSelect
                  multiple
                  value={filters.property_option_ids ?? []}
                  onChange={(ids: string[]) => setFilter("property_option_ids", ids)}
                  options={optionChoices}
                  label={multiLabel(
                    filters.property_option_ids,
                    (id) => String(optionChoices.find((o) => o.value === id)?.content ?? "…"),
                    "—"
                  )}
                  buttonClassName={selectClass}
                  className="w-full"
                  input
                />
              </div>
            )}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(widgetType === "BAR" || widgetType === "PIE") && (
            <div className="space-y-1">
              {label(t("dash.group_by"))}
              <CustomSelect
                value={config.group_by ?? "state_group"}
                onChange={(value: string) => setConfig((prev) => ({ ...prev, group_by: value }))}
                label={
                  <span>{groupChoices.find((g) => g.value === (config.group_by ?? "state_group"))?.label ?? "…"}</span>
                }
                buttonClassName="w-full"
                className="w-full"
                maxHeight="lg"
                input
              >
                {groupChoices.map((choice) => (
                  <CustomSelect.Option key={choice.value} value={choice.value}>
                    {choice.label}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
          )}
          {(widgetType === "NUMBER" || widgetType === "BAR" || widgetType === "PIE") && (
            <div className="space-y-1">
              {label(t("dash.metric"))}
              <CustomSelect
                value={config.metric ?? "count"}
                onChange={(value: "count" | "avg_resolution_days") => setConfig((prev) => ({ ...prev, metric: value }))}
                label={<span>{t(`dash.metric_${config.metric ?? "count"}`)}</span>}
                buttonClassName="w-full"
                className="w-full"
                input
              >
                {["count", "avg_resolution_days"].map((metric) => (
                  <CustomSelect.Option key={metric} value={metric}>
                    {t(`dash.metric_${metric}`)}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
          )}
          {widgetType === "LINE" && (
            <>
              <div className="space-y-1">
                {label(t("dash.period"))}
                <CustomSelect
                  value={config.period ?? "week"}
                  onChange={(value: "week" | "month") => setConfig((prev) => ({ ...prev, period: value }))}
                  label={<span>{t(`dash.period_${config.period ?? "week"}`)}</span>}
                  buttonClassName="w-full"
                  className="w-full"
                  input
                >
                  {["week", "month"].map((period) => (
                    <CustomSelect.Option key={period} value={period}>
                      {t(`dash.period_${period}`)}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </div>
              <div className="space-y-1">
                {label(t("dash.periods"))}
                <Input
                  type="number"
                  min={2}
                  max={24}
                  value={config.periods ?? 12}
                  onChange={(e) => setConfig((prev) => ({ ...prev, periods: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>
            </>
          )}
          {widgetType === "TABLE" && (
            <>
              <div className="space-y-1">
                {label(t("dash.order_by"))}
                <CustomSelect
                  value={config.order_by ?? "-created_at"}
                  onChange={(value: string) => setConfig((prev) => ({ ...prev, order_by: value }))}
                  label={<span>{t(`dash.order_${config.order_by ?? "-created_at"}`)}</span>}
                  buttonClassName="w-full"
                  className="w-full"
                  input
                >
                  {TABLE_ORDERS.map((order) => (
                    <CustomSelect.Option key={order} value={order}>
                      {t(`dash.order_${order}`)}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </div>
              <div className="space-y-1">
                {label(t("dash.limit"))}
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={config.limit ?? 10}
                  onChange={(e) => setConfig((prev) => ({ ...prev, limit: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle pt-4">
          <Button variant="secondary" type="button" onClick={onClose}>
            {t("dash.cancel")}
          </Button>
          <Button variant="primary" type="submit" loading={isSubmitting} disabled={!name.trim() || isSubmitting}>
            {isSubmitting ? t("dash.saving") : t("dash.save")}
          </Button>
        </div>
      </form>
    </ModalCore>
  );
});
