/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useMemo, useState } from "react";
import { sortBy } from "lodash-es";
import { observer } from "mobx-react";
import Link from "next/link";
import { ArrowDownWideNarrow, Bug, Link2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { CustomMenu, Input } from "@plane/ui";
// local
import type { TWorkItemType } from "@/services/work-item-type.service";
import { WorkItemTypeBadge } from "./status-badge";
import { WorkItemTypeIconTile } from "./type-icon";

type TSort = "created" | "name";

type Props = {
  workspaceSlug: string;
  projectId: string;
  types: TWorkItemType[];
  isAdmin: boolean;
  isAddingTemplate: boolean;
  onAdd: () => void;
  onAddBugTemplate?: () => void;
  onImport: () => void;
  onEdit: (type: TWorkItemType) => void;
  onDelete: (type: TWorkItemType) => void;
};

export const WorkItemTypesTab = observer(function WorkItemTypesTab(props: Props) {
  const { workspaceSlug, projectId, types, isAdmin, isAddingTemplate } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [sort, setSort] = useState<TSort>("created");

  const shown = useMemo(() => {
    const filtered = types.filter((type) => type.name.toLowerCase().includes(query.trim().toLowerCase()));
    return sort === "name" ? sortBy(filtered, (type) => type.name.toLowerCase()) : filtered;
  }, [types, query, sort]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-body-md-medium text-primary">{t("wit.types_heading")}</h3>
          <span className="rounded-sm bg-accent-subtle px-1.5 text-caption-sm-medium text-accent-primary">
            {types.length}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSearching ? (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={() => !query && setIsSearching(false)}
              placeholder={t("wit.search")}
              className="h-7 w-40"
            />
          ) : (
            <button
              type="button"
              aria-label={t("wit.search")}
              onClick={() => setIsSearching(true)}
              className="grid size-7 place-items-center rounded-sm text-tertiary hover:bg-layer-1 hover:text-primary"
            >
              <Search className="size-3.5" />
            </button>
          )}
          <CustomMenu
            placement="bottom-end"
            closeOnSelect
            customButton={
              <span className="flex h-7 items-center gap-1 rounded-md border-[0.5px] border-subtle-1 px-2 text-body-xs-medium text-secondary hover:bg-layer-1">
                <ArrowDownWideNarrow className="size-3.5" />
                {t("wit.sort")}
              </span>
            }
          >
            <CustomMenu.MenuItem onClick={() => setSort("created")}>{t("wit.sort_created")}</CustomMenu.MenuItem>
            <CustomMenu.MenuItem onClick={() => setSort("name")}>{t("wit.sort_name")}</CustomMenu.MenuItem>
          </CustomMenu>
          {isAdmin && (
            <div className="flex">
              <Button variant="primary" className="rounded-r-none" prependIcon={<Plus />} onClick={props.onAdd}>
                {t("wit.add_type")}
              </Button>
              <CustomMenu
                placement="bottom-end"
                closeOnSelect
                customButton={
                  <span className="flex h-6 items-center rounded-r-md border-l-[0.5px] border-white/30 bg-accent-primary px-1 text-on-color hover:bg-accent-primary-hover">
                    <MoreHorizontal className="size-3.5" />
                  </span>
                }
              >
                {props.onAddBugTemplate && (
                  <CustomMenu.MenuItem onClick={props.onAddBugTemplate} disabled={isAddingTemplate}>
                    <span className="flex items-center gap-2">
                      <Bug className="size-3.5" />
                      {t("wit.add_bug_template")}
                    </span>
                  </CustomMenu.MenuItem>
                )}
                <CustomMenu.MenuItem onClick={props.onImport}>
                  <span className="flex items-center gap-2">
                    <Link2 className="size-3.5" />
                    {t("wit.import_types")}
                  </span>
                </CustomMenu.MenuItem>
              </CustomMenu>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border-[0.5px] border-subtle">
        <table className="w-full min-w-[560px] text-left">
          <thead className="text-caption-md-medium text-secondary">
            <tr className="border-b-[0.5px] border-subtle">
              <th className="px-3 py-2.5 font-medium">{t("work_item_types.label_singular")}</th>
              <th className="px-3 py-2.5 font-medium">{t("wit.status")}</th>
              <th className="px-3 py-2.5 font-medium">{t("wit.properties_heading")}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {shown.map((type) => (
              <tr key={type.id} className="border-b-[0.5px] border-subtle last:border-b-0 hover:bg-layer-1">
                <td className="px-3 py-2.5">
                  <Link
                    href={`/${workspaceSlug}/settings/projects/${projectId}/work-item-types/${type.id}`}
                    className="flex items-center gap-2 text-body-sm-medium text-primary"
                  >
                    <WorkItemTypeIconTile logoProps={type.logo_props} />
                    <span className="truncate">{type.name}</span>
                    {type.is_default && <WorkItemTypeBadge label={t("wit.default_badge")} tone="neutral" />}
                    {(type.project_ids?.length ?? 0) > 1 && (
                      <span title={t("wit.shared_in", { count: type.project_ids?.length ?? 0 })}>
                        <Link2 className="size-3 text-accent-primary" />
                      </span>
                    )}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <WorkItemTypeBadge
                    label={type.is_active ? t("wit.active") : t("wit.inactive")}
                    tone={type.is_active ? "success" : "neutral"}
                  />
                </td>
                <td className="px-3 py-2.5 text-body-sm-regular text-secondary">{type.properties.length}</td>
                <td className="px-2 py-2.5 text-right">
                  {isAdmin && (
                    <CustomMenu ellipsis placement="bottom-end" closeOnSelect>
                      <CustomMenu.MenuItem onClick={() => props.onEdit(type)}>
                        <span className="flex items-center gap-2">
                          <Pencil className="size-3.5" />
                          {t("wit.edit")}
                        </span>
                      </CustomMenu.MenuItem>
                      {!type.is_default && (
                        <CustomMenu.MenuItem onClick={() => props.onDelete(type)}>
                          <span className="flex items-center gap-2 text-danger-primary">
                            <Trash2 className="size-3.5" />
                            {t("wit.delete")}
                          </span>
                        </CustomMenu.MenuItem>
                      )}
                    </CustomMenu>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});
