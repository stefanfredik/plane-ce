/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Globe } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { IProjectView } from "@plane/types";
import { EViewAccess } from "@plane/types";
import type { TContextMenuItem } from "@plane/ui";
// local
import { PublishViewModal } from "./modal";

type TViewTarget = { workspaceSlug: string; projectId: string; view: IProjectView };

/**
 * The "Publish" menu entry for a project view plus its modal. Only the view's owner or a
 * project admin sees it, and private views must be made public first (the server enforces both).
 */
export const useViewPublish = (isPublished: boolean, isAuthorized: boolean, target?: TViewTarget) => {
  const { t } = useTranslation();
  const [isPublishModalOpen, setPublishModalOpen] = useState(false);

  const isPublic = target?.view.access === EViewAccess.PUBLIC;
  const publishContextMenu: TContextMenuItem | undefined =
    isAuthorized && target
      ? {
          key: "publish",
          title: isPublished ? t("view_publish.menu_published") : t("view_publish.menu"),
          description: isPublic ? undefined : t("view_publish.private_hint"),
          icon: Globe,
          action: () => setPublishModalOpen(true),
          disabled: !isPublic && !isPublished,
          shouldRender: true,
        }
      : undefined;

  const publishModal = target ? (
    <PublishViewModal
      isOpen={isPublishModalOpen}
      onClose={() => setPublishModalOpen(false)}
      workspaceSlug={target.workspaceSlug}
      projectId={target.projectId}
      view={target.view}
    />
  ) : null;

  return { isPublishModalOpen, setPublishModalOpen, publishContextMenu, publishModal };
};
