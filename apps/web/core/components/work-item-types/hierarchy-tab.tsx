/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { ArrowDown } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
// local
import type { TWorkItemType } from "@/services/work-item-type.service";
import { WorkItemTypeIconTile } from "./type-icon";

type Props = { types: TWorkItemType[] };

/**
 * How work items nest. Every type here sits on level 0 (work items nest as sub-work items of
 * any type); epics, which would sit above them, are not available yet.
 */
export const WorkItemHierarchyTab = observer(function WorkItemHierarchyTab({ types }: Props) {
  const { t } = useTranslation();
  const levels: { level: number; types: TWorkItemType[] }[] = [{ level: 0, types }];
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-body-md-medium text-primary">{t("wit.hierarchy")}</h3>
        <p className="text-caption-md-regular text-tertiary">{t("wit.hierarchy_hint")}</p>
      </div>
      <div className="space-y-2 rounded-lg bg-layer-1 p-3">
        {levels.map((row, index) => (
          <div key={row.level}>
            {index > 0 && <ArrowDown className="my-2 ml-4 size-4 text-tertiary" />}
            <div className="flex items-center gap-3 rounded-lg border-[0.5px] border-subtle bg-surface-1 p-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-layer-2 text-body-xs-medium text-secondary">
                {row.level}
              </span>
              <div className="flex flex-wrap gap-2">
                {row.types.map((type) => (
                  <span
                    key={type.id}
                    className="flex items-center gap-1.5 rounded-md bg-layer-2 px-2 py-1 text-body-xs-medium text-primary"
                  >
                    <WorkItemTypeIconTile logoProps={type.logo_props} />
                    {type.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-caption-sm-regular text-tertiary">{t("wit.hierarchy_epics_note")}</p>
    </div>
  );
});
