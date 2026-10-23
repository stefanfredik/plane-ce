/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { useTranslation } from "@plane/i18n";
import { PriorityIcon, StateGroupIcon } from "@plane/propel/icons";
import type { TIssuePriorities } from "@plane/types";
// hooks
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local imports
import type { TChoice } from "./select";

export const PRIORITIES: TIssuePriorities[] = ["urgent", "high", "medium", "low", "none"];
export const STATE_GROUPS = ["backlog", "unstarted", "started", "completed", "cancelled"] as const;
export const SLA_STATUSES = ["on_track", "at_risk", "breached", "met", "missed"] as const;
/** Property kinds a condition or the "Set a property" action can work with. */
export const CONDITION_PROPERTY_TYPES = new Set(["OPTION", "MEMBER", "BOOLEAN"]);

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Everything the automation editor picks from, as choices. Call inside an observer. */
export function useAutomationChoices(workspaceSlug: string, projectId: string) {
  const { t } = useTranslation();
  const { fetchProjectStates, getProjectStates } = useProjectState();
  const { fetchProjectLabels, getProjectLabels } = useLabel();
  const {
    getUserDetails,
    project: { fetchProjectMembers, getProjectMemberIds },
  } = useMember();
  const typeStore = useWorkItemType();

  useEffect(() => {
    void fetchProjectStates(workspaceSlug, projectId);
    void fetchProjectLabels(workspaceSlug, projectId);
    void fetchProjectMembers(workspaceSlug, projectId);
    void typeStore.fetchProjectTypes(workspaceSlug, projectId).catch(() => undefined);
    void typeStore.fetchProjectProperties(workspaceSlug, projectId).catch(() => undefined);
  }, [fetchProjectStates, fetchProjectLabels, fetchProjectMembers, typeStore, workspaceSlug, projectId]);

  const states: TChoice[] = (getProjectStates(projectId) ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    icon: <StateGroupIcon stateGroup={s.group} color={s.color} className="size-3.5 flex-shrink-0" />,
  }));
  const stateGroups: TChoice[] = STATE_GROUPS.map((g) => ({
    value: g,
    label: capitalize(g),
    icon: <StateGroupIcon stateGroup={g} className="size-3.5 flex-shrink-0" />,
  }));
  const priorities: TChoice[] = PRIORITIES.map((p) => ({
    value: p,
    label: capitalize(p),
    icon: <PriorityIcon priority={p} size={12} />,
  }));
  const labels: TChoice[] = (getProjectLabels(projectId) ?? []).map((l) => ({
    value: l.id,
    label: l.name,
    icon: <span className="size-2 flex-shrink-0 rounded-full" style={{ backgroundColor: l.color }} />,
  }));
  const members: TChoice[] = (getProjectMemberIds(projectId, false) ?? []).map((id) => ({
    value: id,
    label: getUserDetails(id)?.display_name ?? id,
  }));
  const types: TChoice[] = typeStore
    .getProjectTypes(projectId)
    .filter((type) => type.is_active)
    .map((type) => ({ value: type.id, label: type.name }));
  const slaStatuses: TChoice[] = SLA_STATUSES.map((s) => ({ value: s, label: t(`automations.custom.sla.${s}`) }));
  const properties = (typeStore.projectProperties[projectId] ?? []).filter((p) => p.is_active);

  /** The values a property can take, for conditions and the "Set a property" action. */
  const propertyValues = (propertyId: string): TChoice[] => {
    const prop = properties.find((p) => p.id === propertyId);
    if (!prop) return [];
    if (prop.property_type === "MEMBER") return members;
    if (prop.property_type === "BOOLEAN")
      return [
        { value: "true", label: t("common.yes") },
        { value: "false", label: t("common.no") },
      ];
    return prop.options
      .filter((o) => o.id && o.is_active !== false)
      .map((o) => ({
        value: o.id as string,
        label: o.name,
        icon: o.color ? <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} /> : undefined,
      }));
  };

  return {
    states,
    stateGroups,
    priorities,
    labels,
    members,
    types,
    slaStatuses,
    properties: properties.filter((p) => CONDITION_PROPERTY_TYPES.has(p.property_type)),
    allProperties: properties,
    propertyValues,
  };
}

export type TAutomationChoices = ReturnType<typeof useAutomationChoices>;
