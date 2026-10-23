/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Paperclip, Plus, X } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { ISearchIssueResponse } from "@plane/types";
import { cn, getFileURL } from "@plane/utils";
// components
import { ExistingIssuesListModal } from "@/components/core/modals/existing-issues-list-modal";
import { LiteTextEditor } from "@/components/editor/lite-text/editor";
// hooks
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useWorkspace } from "@/hooks/store/use-workspace";
// services
import type { TRelatedWorkItem, TWorkItemProperty } from "@/services/work-item-type.service";
import { WorkItemTypeService } from "@/services/work-item-type.service";

const service = new WorkItemTypeService();

// ------------------------------------------------------------------ rich text

type TRichTextProps = {
  property: TWorkItemProperty;
  projectId: string;
  value: string;
  onChange: (value: string[]) => void;
  mode: "form" | "inline";
  disabled: boolean;
  hasError: boolean;
};

const isEmptyHtml = (html: string) => !html || html.replace(/<[^>]+>/g, "").trim() === "";

/** Formatted text (no images); inline it saves when the editor loses focus. */
export const RichTextPropertyField = observer(function RichTextPropertyField(props: TRichTextProps) {
  const { property, projectId, value, onChange, mode, disabled, hasError } = props;
  const { workspaceSlug } = useParams();
  const { getWorkspaceBySlug } = useWorkspace();
  const { t } = useTranslation();
  const draft = useRef(value);
  const workspace = workspaceSlug ? getWorkspaceBySlug(workspaceSlug.toString()) : null;

  useEffect(() => {
    draft.current = value;
  }, [value]);

  const commit = (html: string) => {
    const next = isEmptyHtml(html) ? [] : [html];
    if ((next[0] ?? "") !== (value || "")) onChange(next);
  };

  if (!workspace || !workspaceSlug) return null;
  const noImages = () => Promise.reject(new Error(t("wit.rich_text_no_images")));

  if (disabled)
    return (
      <LiteTextEditor
        editable={false}
        id={`property-${property.id}-readonly`}
        initialValue={value || "<p></p>"}
        workspaceSlug={workspaceSlug.toString()}
        workspaceId={workspace.id}
        projectId={projectId}
        showSubmitButton={false}
        variant="none"
        parentClassName="border-none"
      />
    );

  return (
    <div
      onBlur={(e) => {
        if (mode === "inline" && !e.currentTarget.contains(e.relatedTarget as Node)) commit(draft.current);
      }}
    >
      <LiteTextEditor
        editable
        id={`property-${property.id}`}
        initialValue={value || "<p></p>"}
        onChange={(_json, html) => {
          draft.current = html;
          if (mode === "form") commit(html);
        }}
        workspaceSlug={workspaceSlug.toString()}
        workspaceId={workspace.id}
        projectId={projectId}
        uploadFile={noImages}
        duplicateFile={noImages}
        showSubmitButton={false}
        showToolbarInitially={false}
        placeholder={property.display_name}
        parentClassName={cn(
          mode === "inline" && "border-none p-1 hover:bg-layer-1",
          hasError && "border-danger-strong"
        )}
      />
    </div>
  );
});

// ------------------------------------------------------------------ relations

type TRelationProps = {
  property: TWorkItemProperty;
  projectId: string;
  issueId?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
};

const relatedCache: Record<string, TRelatedWorkItem> = {};

/** Links to other work items of the workspace, picked with the usual work item search. */
export const RelationPropertyField = observer(function RelationPropertyField(props: TRelationProps) {
  const { property, projectId, issueId, value, onChange, disabled } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [, setVersion] = useState(0);

  const missing = value.filter((id) => !relatedCache[id]);
  useEffect(() => {
    if (!workspaceSlug || missing.length === 0) return;
    void service.getRelationDetails(workspaceSlug.toString(), projectId, missing).then((items) => {
      for (const item of items) relatedCache[item.id] = item;
      setVersion((v) => v + 1);
      return undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, projectId, missing.join(",")]);

  const remember = (issues: ISearchIssueResponse[]) => {
    for (const issue of issues)
      relatedCache[issue.id] = {
        id: issue.id,
        name: issue.name,
        sequence_id: issue.sequence_id,
        project_id: issue.project_id,
        project_identifier: issue.project__identifier,
      };
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
      {value.map((id) => {
        const item = relatedCache[id];
        return (
          <span
            key={id}
            className="flex max-w-full items-center gap-1 rounded-sm border-[0.5px] border-subtle-1 px-1.5 py-0.5 text-caption-md-regular"
            title={item?.name}
          >
            <span className="shrink-0 text-tertiary">
              {item ? `${item.project_identifier}-${item.sequence_id}` : "…"}
            </span>
            <span className="truncate">{item?.name}</span>
            {!disabled && (
              <button
                type="button"
                aria-label={t("wit.delete")}
                className="text-tertiary hover:text-primary"
                onClick={() => onChange(value.filter((v) => v !== id))}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (property.is_multi || value.length === 0) && (
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption-md-regular text-tertiary hover:bg-layer-1"
          onClick={() => setIsOpen(true)}
        >
          <Plus className="size-3" />
          {t("wit.add_work_item")}
        </button>
      )}
      {workspaceSlug && (
        <ExistingIssuesListModal
          workspaceSlug={workspaceSlug.toString()}
          projectId={projectId}
          isOpen={isOpen}
          handleClose={() => setIsOpen(false)}
          searchParams={{ issue_id: issueId }}
          workspaceLevelToggle
          shouldHideIssue={(issue) => issue.id === issueId || value.includes(issue.id)}
          handleOnSubmit={async (issues) => {
            remember(issues);
            const picked = issues.map((i) => i.id);
            onChange(
              property.is_multi ? [...value, ...picked.filter((id) => !value.includes(id))] : picked.slice(0, 1)
            );
          }}
        />
      )}
    </div>
  );
});

// ------------------------------------------------------------------ files

type TFileProps = {
  property: TWorkItemProperty;
  projectId: string;
  issueId?: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled: boolean;
};

/** Files kept as attachments of the work item; the property points at them. */
export const FilePropertyField = observer(function FilePropertyField(props: TFileProps) {
  const { property, projectId, issueId, value, onChange, disabled } = props;
  const { workspaceSlug } = useParams();
  const { t } = useTranslation();
  const {
    attachment: { fetchAttachments, getAttachmentById, createAttachment },
  } = useIssueDetail();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    if (workspaceSlug && issueId) void fetchAttachments(workspaceSlug.toString(), projectId, issueId);
  }, [fetchAttachments, workspaceSlug, projectId, issueId]);

  if (!issueId)
    return <span className="block px-2 py-1 text-caption-md-regular text-tertiary">{t("wit.file_after_create")}</span>;

  const handleUpload = async (file: File) => {
    if (!workspaceSlug) return;
    setIsUploading(true);
    try {
      const attachment = await createAttachment(workspaceSlug.toString(), projectId, issueId, file);
      if (attachment?.id) onChange(property.is_multi ? [...value, attachment.id] : [attachment.id]);
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error") });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 px-1 py-0.5">
      {value.map((id) => {
        const attachment = getAttachmentById(id);
        const name = attachment?.attributes?.name ?? "…";
        return (
          <span
            key={id}
            className="flex max-w-full items-center gap-1 rounded-sm border-[0.5px] border-subtle-1 px-1.5 py-0.5 text-caption-md-regular"
          >
            <Paperclip className="size-3 shrink-0 text-tertiary" />
            {attachment?.asset_url ? (
              <a
                href={getFileURL(attachment.asset_url)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:underline"
              >
                {name}
              </a>
            ) : (
              <span className="truncate">{name}</span>
            )}
            {!disabled && (
              <button
                type="button"
                aria-label={t("wit.delete")}
                className="text-tertiary hover:text-primary"
                onClick={() => onChange(value.filter((v) => v !== id))}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (property.is_multi || value.length === 0) && (
        <>
          <button
            type="button"
            disabled={isUploading}
            className={cn(
              "flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption-md-regular text-tertiary hover:bg-layer-1",
              isUploading && "opacity-60"
            )}
            onClick={() => inputRef.current?.click()}
          >
            <Plus className="size-3" />
            {isUploading ? t("wit.saving") : t("wit.add_file")}
          </button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleUpload(file);
            }}
          />
        </>
      )}
    </div>
  );
});
