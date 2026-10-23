/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
import { Pencil, RefreshCw, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { BarChart } from "@plane/propel/charts/bar-chart";
import { LineChart } from "@plane/propel/charts/line-chart";
import { PieChart } from "@plane/propel/charts/pie-chart";
import { Loader } from "@plane/ui";
import { cn, renderFormattedDate } from "@plane/utils";
// hooks
import { useWorkItemDashboard } from "@/hooks/store/use-work-item-dashboard";
// local
import type { TDashboardWidget, TWidgetData, TWidgetGroupItem } from "@/services/work-item-dashboard.service";
import { PALETTE } from "./constants";

type Props = {
  workspaceSlug: string;
  dashboardId: string;
  widget: TDashboardWidget;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

const colorOf = (item: TWidgetGroupItem, index: number) => item.color || PALETTE[index % PALETTE.length];

export const DashboardWidgetCard = observer(function DashboardWidgetCard(props: Props) {
  const { workspaceSlug, dashboardId, widget, canEdit, onEdit, onDelete } = props;
  const { t } = useTranslation();
  const store = useWorkItemDashboard();
  const data = store.widgetData[widget.id];

  useEffect(() => {
    void store.fetchWidgetData(workspaceSlug, dashboardId, widget.id);
  }, [store, workspaceSlug, dashboardId, widget.id, widget.config, widget.widget_type]);

  const span = { 1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3" }[widget.width] ?? "md:col-span-1";

  return (
    <section className={cn("flex min-h-56 flex-col rounded-lg border-[0.5px] border-subtle bg-surface-1", span)}>
      <header className="group flex items-center justify-between gap-2 border-b-[0.5px] border-subtle px-4 py-2.5">
        <h3 className="truncate text-body-sm-medium text-primary">{widget.name}</h3>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label={t("dash.refresh")}
            className="grid size-6 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
            onClick={() => void store.fetchWidgetData(workspaceSlug, dashboardId, widget.id)}
          >
            <RefreshCw className="size-3.5" />
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                aria-label={t("dash.edit_short")}
                className="grid size-6 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
                onClick={onEdit}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t("dash.delete")}
                className="grid size-6 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-danger-primary"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <WidgetBody widget={widget} data={data} workspaceSlug={workspaceSlug} />
      </div>
    </section>
  );
});

type TBodyProps = {
  widget: TDashboardWidget;
  data: TWidgetData | { error: string } | undefined;
  workspaceSlug: string;
};

const WidgetBody = observer(function WidgetBody({ widget, data, workspaceSlug }: TBodyProps) {
  const { t } = useTranslation();

  if (!data)
    return (
      <Loader className="flex flex-1 flex-col gap-2">
        <Loader.Item height="24px" width="40%" />
        <Loader.Item height="120px" />
      </Loader>
    );
  if ("error" in data) return <p className="text-body-sm-regular text-danger-primary">{data.error}</p>;

  if ("value" in data) {
    const isDays = data.metric === "avg_resolution_days";
    return (
      <div className="flex flex-1 flex-col justify-center">
        <span className="text-[2.5rem] leading-none font-semibold text-primary">{data.value ?? "—"}</span>
        <span className="mt-2 text-caption-md-regular text-tertiary">
          {isDays ? t("dash.metric_avg_resolution_days") : t("dash.metric_count")}
        </span>
      </div>
    );
  }

  if ("items" in data) {
    if (data.items.length === 0) return <Empty />;
    const rows = data.items.map((item, index) => ({
      key: item.key,
      name: item.label,
      count: item.value ?? 0,
      color: colorOf(item, index),
    }));
    if (widget.widget_type === "PIE")
      return (
        <div className="flex flex-1 items-center gap-4">
          <PieChart
            className="h-52 w-1/2 min-w-40"
            data={rows}
            dataKey="count"
            cells={rows.map((row) => ({ key: row.key, fill: row.color }))}
            innerRadius="55%"
            showLabel={false}
            showTooltip
            tooltipLabel={(payload: { name?: string }) => payload?.name ?? ""}
          />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2 text-caption-md-regular">
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="truncate text-secondary">{row.name}</span>
                <span className="ml-auto text-primary">{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    return (
      <BarChart
        className="h-56 w-full"
        margin={{ top: 10, right: 10, bottom: 5, left: 0 }}
        data={rows}
        bars={[
          {
            key: "count",
            label: data.metric === "avg_resolution_days" ? t("dash.days") : t("dash.metric_count"),
            stackId: "bar-one",
            fill: (payload: { color?: string }) => payload?.color ?? PALETTE[0],
            textClassName: "",
            showPercentage: false,
            showTopBorderRadius: () => true,
            showBottomBorderRadius: () => true,
          },
        ]}
        xAxis={{ key: "name", label: "" }}
        yAxis={{ key: "count", label: "" }}
        barSize={24}
      />
    );
  }

  if ("points" in data) {
    if (data.points.length === 0) return <Empty />;
    const rows = data.points.map((p) => ({ ...p, label: renderFormattedDate(p.period) ?? p.period }));
    return (
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex justify-end gap-4 text-caption-md-regular text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#3f76ff]" />
            {t("dash.created")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-[#16a34a]" />
            {t("dash.completed")}
          </span>
        </div>
        <LineChart
          className="h-52 w-full"
          margin={{ top: 10, right: 10, bottom: 5, left: 0 }}
          data={rows}
          lines={[
            {
              key: "created",
              label: t("dash.created"),
              dashedLine: false,
              fill: "#3f76ff",
              stroke: "#3f76ff",
              showDot: true,
              smoothCurves: true,
            },
            {
              key: "completed",
              label: t("dash.completed"),
              dashedLine: false,
              fill: "#16a34a",
              stroke: "#16a34a",
              showDot: true,
              smoothCurves: true,
            },
          ]}
          xAxis={{ key: "label", label: "" }}
          yAxis={{ key: "created", label: "", allowDecimals: false }}
          showTooltip
        />
      </div>
    );
  }

  if (data.rows.length === 0) return <Empty />;
  return (
    <ul className="-mx-2 divide-y-[0.5px] divide-subtle">
      {data.rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/${workspaceSlug}/browse/${row.identifier}/`}
            className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-layer-1"
          >
            <span className="w-24 shrink-0 text-caption-md-regular text-tertiary">{row.identifier}</span>
            <span className="min-w-0 flex-1 truncate text-body-sm-regular text-primary">{row.name}</span>
            {row.state_name && (
              <span className="flex shrink-0 items-center gap-1 text-caption-md-regular text-secondary">
                <span className="size-2 rounded-full" style={{ backgroundColor: row.state_color ?? "#a3a3a3" }} />
                {row.state_name}
              </span>
            )}
            <span className="w-16 shrink-0 text-right text-caption-md-regular text-tertiary capitalize">
              {row.priority}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
});

function Empty() {
  const { t } = useTranslation();
  return <p className="m-auto text-body-sm-regular text-tertiary">{t("dash.no_data")}</p>;
}
