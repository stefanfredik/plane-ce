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
import { CheckIcon, GlobeIcon, NewTabIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IProjectView, TProjectPublishLayouts, TProjectPublishViewProps } from "@plane/types";
import { CustomSelect, EModalWidth, Loader, ModalCore, ToggleSwitch } from "@plane/ui";
import { copyTextToClipboard, getPublishViewLink } from "@plane/utils";
// hooks
import { useProjectView } from "@/hooks/store/use-project-view";
// services
import type { TViewPublishPayload, TViewPublishSettings } from "@/services/view-publish.service";
import { ViewPublishService } from "@/services/view-publish.service";

const viewPublishService = new ViewPublishService();

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceSlug: string;
  projectId: string;
  view: IProjectView;
};

const LAYOUTS: { key: TProjectPublishLayouts; label: string }[] = [
  { key: "list", label: "List" },
  { key: "kanban", label: "Kanban" },
];

const DEFAULTS: Required<Omit<TViewPublishPayload, "view_props">> & { view_props: TProjectPublishViewProps } = {
  is_comments_enabled: false,
  is_reactions_enabled: false,
  is_votes_enabled: false,
  view_props: { list: true, kanban: true },
};

const apiError = (error: unknown, fallback: string) => (error as { error?: string } | undefined)?.error ?? fallback;

/** Publish a project view to the public Space app, mirroring the project publish modal. */
export const PublishViewModal = observer(function PublishViewModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId, view } = props;
  const { t } = useTranslation();
  const { fetchViewDetails } = useProjectView();
  const [settings, setSettings] = useState<TViewPublishSettings | null>(null);
  const [form, setForm] = useState(DEFAULTS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    viewPublishService
      .retrieve(workspaceSlug, projectId, view.id)
      .then((current) => {
        setSettings(current);
        setForm(
          current
            ? {
                is_comments_enabled: current.is_comments_enabled,
                is_reactions_enabled: current.is_reactions_enabled,
                is_votes_enabled: current.is_votes_enabled,
                view_props: current.view_props,
              }
            : DEFAULTS
        );
        return current;
      })
      .catch(() => setSettings(null))
      .finally(() => setIsLoading(false));
  }, [isOpen, workspaceSlug, projectId, view.id]);

  const isPublished = !!settings?.anchor;
  const publishLink = getPublishViewLink(settings?.anchor);
  const selectedLayouts = LAYOUTS.filter((layout) => form.view_props?.[layout.key]).map((layout) => layout.key);
  const isDirty =
    !!settings &&
    (settings.is_comments_enabled !== form.is_comments_enabled ||
      settings.is_reactions_enabled !== form.is_reactions_enabled ||
      settings.is_votes_enabled !== form.is_votes_enabled ||
      LAYOUTS.some((layout) => !!settings.view_props?.[layout.key] !== !!form.view_props?.[layout.key]));

  const refreshView = () => fetchViewDetails(workspaceSlug, projectId, view.id).catch(() => undefined);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedLayouts.length === 0) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("view_publish.error"), message: t("view_publish.layout_required") });
      return;
    }
    setIsSubmitting(true);
    try {
      if (isPublished) {
        setSettings(await viewPublishService.update(workspaceSlug, projectId, view.id, form));
        setToast({ type: TOAST_TYPE.SUCCESS, title: t("view_publish.updated") });
        onClose();
      } else {
        setSettings(await viewPublishService.publish(workspaceSlug, projectId, view.id, form));
        void refreshView();
      }
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("view_publish.error"),
        message: apiError(error, t("view_publish.error")),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUnpublish = async () => {
    setIsUnpublishing(true);
    try {
      await viewPublishService.unpublish(workspaceSlug, projectId, view.id);
      setSettings(null);
      setForm(DEFAULTS);
      void refreshView();
    } catch (error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: t("view_publish.error"),
        message: apiError(error, t("view_publish.error")),
      });
    } finally {
      setIsUnpublishing(false);
    }
  };

  const toggle = (label: string, key: "is_comments_enabled" | "is_reactions_enabled" | "is_votes_enabled") => (
    <div className="relative flex items-center justify-between gap-2">
      <div className="text-13">{label}</div>
      <ToggleSwitch value={form[key]} onChange={(value) => setForm((prev) => ({ ...prev, [key]: value }))} size="sm" />
    </div>
  );

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} width={EModalWidth.XXL}>
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-2 p-5">
          <h5 className="truncate text-18 font-medium text-secondary">
            {t("view_publish.title", { name: view.name })}
          </h5>
          {isPublished && (
            <Button
              variant="error-fill"
              size="lg"
              type="button"
              onClick={() => void handleUnpublish()}
              loading={isUnpublishing}
            >
              {isUnpublishing ? t("view_publish.unpublishing") : t("view_publish.unpublish")}
            </Button>
          )}
        </div>
        {isLoading ? (
          <Loader className="space-y-4 px-5">
            <Loader.Item height="30px" />
            <Loader.Item height="30px" />
            <Loader.Item height="30px" />
          </Loader>
        ) : (
          <div className="space-y-4 px-5">
            {isPublished && publishLink && (
              <>
                <div className="flex items-center justify-between gap-2 rounded-md border border-strong py-1.5 pr-1 pl-4">
                  <a
                    href={publishLink}
                    className="truncate text-13 text-secondary"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {publishLink}
                  </a>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <a
                      href={publishLink}
                      aria-label={t("view_publish.open")}
                      className="grid size-8 place-items-center rounded-sm bg-layer-3 hover:bg-layer-3-hover"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <NewTabIcon className="size-4" />
                    </a>
                    <button
                      type="button"
                      className="h-8 rounded-sm bg-layer-3 px-3 py-2 text-11 font-medium hover:bg-layer-3-hover"
                      onClick={() =>
                        void copyTextToClipboard(publishLink).then(() =>
                          setToast({ type: TOAST_TYPE.SUCCESS, title: t("view_publish.copied") })
                        )
                      }
                    >
                      {t("view_publish.copy_link")}
                    </button>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1 text-13 font-medium text-accent-primary">
                  <span className="relative grid size-2.5 place-items-center">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-primary opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-accent-primary" />
                  </span>
                  {t("view_publish.live")}
                </p>
              </>
            )}
            <p className="text-caption-md-regular text-tertiary">{t("view_publish.scope_hint")}</p>
            <div className="space-y-4">
              <div className="relative flex items-center justify-between gap-2">
                <div className="text-13">{t("view_publish.layouts")}</div>
                <CustomSelect
                  value={form.view_props}
                  label={LAYOUTS.filter((layout) => selectedLayouts.includes(layout.key))
                    .map((layout) => layout.label)
                    .join(", ")}
                  onChange={(key: TProjectPublishLayouts) => {
                    if (selectedLayouts.length === 1 && selectedLayouts[0] === key) return;
                    setForm((prev) => ({
                      ...prev,
                      view_props: { ...prev.view_props, [key]: !prev.view_props?.[key] },
                    }));
                  }}
                  buttonClassName="border-none"
                  placement="bottom-end"
                >
                  {LAYOUTS.map((layout) => (
                    <CustomSelect.Option
                      key={layout.key}
                      value={layout.key}
                      className="flex items-center justify-between gap-2"
                    >
                      {layout.label}
                      {selectedLayouts.includes(layout.key) && <CheckIcon className="size-3.5 flex-shrink-0" />}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </div>
              {toggle(t("view_publish.comments"), "is_comments_enabled")}
              {toggle(t("view_publish.reactions"), "is_reactions_enabled")}
              {toggle(t("view_publish.votes"), "is_votes_enabled")}
            </div>
          </div>
        )}
        <div className="relative mt-4 flex items-center justify-between border-t border-subtle px-5 py-4">
          <div className="flex items-center gap-1 text-13 text-placeholder">
            <GlobeIcon className="size-3.5" />
            <div className="text-13">{t("view_publish.anyone")}</div>
          </div>
          {!isLoading && (
            <div className="relative flex items-center gap-2">
              <Button variant="secondary" size="lg" type="button" onClick={onClose}>
                {t("view_publish.cancel")}
              </Button>
              {isPublished ? (
                isDirty && (
                  <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
                    {isSubmitting ? t("view_publish.updating") : t("view_publish.update")}
                  </Button>
                )
              ) : (
                <Button variant="primary" size="lg" type="submit" loading={isSubmitting}>
                  {isSubmitting ? t("view_publish.publishing") : t("view_publish.publish")}
                </Button>
              )}
            </div>
          )}
        </div>
      </form>
    </ModalCore>
  );
});
