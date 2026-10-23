/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
// plane imports
import { PROJECT_SETTINGS } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { Breadcrumbs } from "@plane/ui";
// components
import { BreadcrumbLink } from "@/components/common/breadcrumb-link";
import { SettingsPageHeader } from "@/components/settings/page-header";
import { PROJECT_SETTINGS_ICONS } from "@/components/settings/project/sidebar/item-icon";
import { useWorkItemType } from "@/hooks/store/use-work-item-type";

export const WorkItemTypesProjectSettingsHeader = observer(function WorkItemTypesProjectSettingsHeader() {
  // translation
  const { t } = useTranslation();
  // derived values
  const settingsDetails = PROJECT_SETTINGS.work_item_types;
  const Icon = PROJECT_SETTINGS_ICONS.work_item_types;
  // on a type's own page the breadcrumb goes back to the list
  const { workspaceSlug, projectId, typeId } = useParams();
  const { getTypeById } = useWorkItemType();
  const type = typeId ? getTypeById(projectId?.toString(), typeId.toString()) : undefined;

  return (
    <SettingsPageHeader
      leftItem={
        <div className="flex items-center gap-2">
          <Breadcrumbs>
            <Breadcrumbs.Item
              component={
                <BreadcrumbLink
                  label={t(settingsDetails.i18n_label)}
                  href={typeId ? `/${workspaceSlug}/settings/projects/${projectId}/work-item-types` : undefined}
                  icon={<Icon className="size-4 text-tertiary" />}
                />
              }
            />
            {type && <Breadcrumbs.Item component={<BreadcrumbLink label={type.name} isLast />} />}
          </Breadcrumbs>
        </div>
      }
    />
  );
});
