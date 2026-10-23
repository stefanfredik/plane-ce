/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
import Link from "next/link";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { PriorityIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TIssuePriorities } from "@plane/types";
import { Input, Loader, ToggleSwitch } from "@plane/ui";
// components
import { ChoiceSelect } from "@/components/automation/custom/select";
import { PRIORITIES } from "@/components/automation/custom/use-choices";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// services
import type { TSlaPolicy, TSlaSummary, TSlaTarget } from "@/services/sla.service";
import { SlaService } from "@/services/sla.service";
// local imports
import { SlaStatusBadge, formatMinutes, minutesBetween } from "./helpers";

const service = new SlaService();

type Props = { workspaceSlug: string; projectId: string };

const errorText = (error: unknown, fallback: string) => (error as { error?: string } | undefined)?.error ?? fallback;

function DurationInput({ value, onChange }: { value: number | null; onChange: (minutes: number | null) => void }) {
  const { t } = useTranslation();
  const hours = value ? Math.floor(value / 60) : "";
  const minutes = value ? value % 60 : "";
  const set = (h: number, m: number) => onChange(h * 60 + m > 0 ? h * 60 + m : null);
  return (
    <div className="flex items-center gap-1 text-caption-md-regular text-tertiary">
      <Input
        type="number"
        min={0}
        value={String(hours)}
        onChange={(e) => set(Number(e.target.value) || 0, Number(minutes) || 0)}
        className="w-16 px-2 py-1 text-body-xs-regular"
        placeholder="0"
      />
      {t("sla.settings.hours")}
      <Input
        type="number"
        min={0}
        max={59}
        value={String(minutes)}
        onChange={(e) => set(Number(hours) || 0, Math.min(59, Number(e.target.value) || 0))}
        className="w-14 px-2 py-1 text-body-xs-regular"
        placeholder="0"
      />
      {t("sla.settings.minutes")}
    </div>
  );
}

/** Settings > SLA: response and resolution targets, and what is at risk right now. */
export const SlaSettingsRoot = observer(function SlaSettingsRoot({ workspaceSlug, projectId }: Props) {
  const { t } = useTranslation();
  const typeStore = useWorkItemType();
  const [saved, setSaved] = useState<TSlaPolicy | null>(null);
  const [draft, setDraft] = useState<TSlaPolicy | null>(null);
  const [summary, setSummary] = useState<TSlaSummary | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void typeStore.fetchProjectProperties(workspaceSlug, projectId).catch(() => undefined);
    service
      .policy(workspaceSlug, projectId)
      .then((data) => {
        setSaved(data);
        setDraft(data);
        return data;
      })
      .catch(() => undefined);
    service
      .summary(workspaceSlug, projectId)
      .then(setSummary)
      .catch(() => undefined);
  }, [typeStore, workspaceSlug, projectId]);

  if (!draft || !saved)
    return (
      <Loader className="mt-6 space-y-3">
        <Loader.Item height="56px" />
        <Loader.Item height="200px" />
      </Loader>
    );

  const dropdowns = (typeStore.projectProperties[projectId] ?? []).filter(
    (p) => p.is_active && p.property_type === "OPTION"
  );
  const basedOnProperty = dropdowns.find((p) => p.id === draft.based_on);
  const rows: { key: string; label: string; icon?: React.ReactNode }[] =
    draft.based_on === "priority"
      ? PRIORITIES.map((p) => ({
          key: p,
          label: p.charAt(0).toUpperCase() + p.slice(1),
          icon: <PriorityIcon priority={p as TIssuePriorities} size={12} />,
        }))
      : (basedOnProperty?.options ?? [])
          .filter((o) => o.id)
          .map((o) => ({
            key: o.id as string,
            label: o.name,
            icon: o.color ? <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} /> : undefined,
          }));
  const isDirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const save = async (changes: Partial<TSlaPolicy>) => {
    setIsSaving(true);
    try {
      const next = await service.updatePolicy(workspaceSlug, projectId, changes);
      setSaved(next);
      setDraft(next);
      setToast({ type: TOAST_TYPE.SUCCESS, title: t("sla.settings.saved") });
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("sla.settings.error"), message: errorText(error, "") });
    } finally {
      setIsSaving(false);
    }
  };

  const setTarget = (key: string, changes: Partial<TSlaTarget>) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.targets[key] ?? { response: null, resolution: null };
      const target = { ...current, ...changes };
      return { ...prev, targets: { ...prev.targets, [key]: target } };
    });

  const now = new Date();

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-start justify-between gap-4 rounded-lg border-[0.5px] border-subtle p-4">
        <div>
          <h3 className="text-body-md-medium text-primary">{t("sla.settings.enable")}</h3>
          <p className="text-caption-md-regular text-tertiary">{t("sla.settings.enable_description")}</p>
        </div>
        <ToggleSwitch
          value={saved.is_enabled}
          onChange={(value) => void save({ is_enabled: value })}
          disabled={isSaving}
        />
      </div>

      {saved.is_enabled && summary && (
        <div className="rounded-lg border-[0.5px] border-subtle p-4">
          <p className="mb-3 text-caption-md-medium text-tertiary">{t("sla.settings.now")}</p>
          <div className="grid grid-cols-3 gap-3">
            {(["on_track", "at_risk", "breached"] as const).map((status) => (
              <div key={status} className="rounded-md bg-layer-1 px-3 py-2">
                <p className="text-h4-medium text-primary tabular-nums">{summary.counts[status]}</p>
                <SlaStatusBadge status={status} />
              </div>
            ))}
          </div>
          {summary.attention.length > 0 && (
            <div className="mt-4 space-y-1">
              <p className="text-caption-md-medium text-tertiary">{t("sla.settings.attention")}</p>
              {summary.attention.map((item) => {
                const due = item.due_at ? minutesBetween(now, new Date(item.due_at)) : null;
                return (
                  <Link
                    key={item.id}
                    href={`/${workspaceSlug}/browse/${item.project_identifier}-${item.sequence_id}/`}
                    className="flex items-center gap-3 rounded-sm px-2 py-1 text-body-xs-regular hover:bg-layer-1"
                  >
                    <SlaStatusBadge status={item.status} />
                    <span className="flex-shrink-0 text-tertiary">
                      {item.project_identifier}-{item.sequence_id}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-primary">{item.name}</span>
                    {due !== null && (
                      <span className="flex-shrink-0 text-tertiary tabular-nums">
                        {due >= 0
                          ? t("sla.issue.left", { time: formatMinutes(due) })
                          : t("sla.issue.over", { time: formatMinutes(-due) })}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-lg border-[0.5px] border-subtle p-4">
        <div className="flex flex-wrap items-center gap-2 text-caption-md-regular text-secondary">
          {t("sla.settings.based_on")}
          <ChoiceSelect
            value={draft.based_on}
            choices={[
              { value: "priority", label: t("sla.settings.priority") },
              ...dropdowns.map((p) => ({ value: p.id, label: p.display_name })),
            ]}
            onChange={(based_on) => setDraft((prev) => (prev ? { ...prev, based_on, targets: {} } : prev))}
            placeholder=""
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-body-xs-regular">
            <thead className="text-caption-md-medium text-tertiary">
              <tr>
                <th className="py-2 pr-3 font-medium">{t("sla.settings.value")}</th>
                <th className="px-3 py-2 font-medium">{t("sla.settings.response")}</th>
                <th className="px-3 py-2 font-medium">{t("sla.settings.resolution")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t-[0.5px] border-subtle">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 text-primary">
                      {row.icon}
                      {row.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <DurationInput
                      value={draft.targets[row.key]?.response ?? null}
                      onChange={(response) => setTarget(row.key, { response })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <DurationInput
                      value={draft.targets[row.key]?.resolution ?? null}
                      onChange={(resolution) => setTarget(row.key, { resolution })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t-[0.5px] border-subtle pt-3 text-caption-md-regular text-secondary">
          {t("sla.settings.at_risk")}
          <Input
            type="number"
            min={1}
            max={90}
            value={String(draft.at_risk_percent)}
            onChange={(e) =>
              setDraft((prev) =>
                prev ? { ...prev, at_risk_percent: Math.min(90, Math.max(1, Number(e.target.value) || 1)) } : prev
              )
            }
            className="w-16 px-2 py-1 text-body-xs-regular"
          />
          %
        </div>
        {isDirty && (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDraft(saved)} disabled={isSaving}>
              {t("automations.custom.discard")}
            </Button>
            <Button
              variant="primary"
              loading={isSaving}
              onClick={() =>
                void save({ based_on: draft.based_on, targets: draft.targets, at_risk_percent: draft.at_risk_percent })
              }
            >
              {t("automations.custom.save")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
