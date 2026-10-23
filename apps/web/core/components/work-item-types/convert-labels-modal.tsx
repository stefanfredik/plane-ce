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
import { Checkbox, CustomSelect, EModalPosition, EModalWidth, Input, Loader, ModalCore } from "@plane/ui";
// hooks
import { useWorkItemType } from "@/hooks/store/use-work-item-type";
// local
import type { TLabelConversionResult, TLabelGroup } from "@/services/work-item-type.service";
import { WorkItemTypeService } from "@/services/work-item-type.service";
import { errorMessage } from "./constants";

const service = new WorkItemTypeService();
const NEW = "__new__";

type Props = { isOpen: boolean; onClose: () => void; workspaceSlug: string; projectId: string };

/** Turn a label group ("Reporter" over "Reporter: Triska", …) into a dropdown property, with a preview first. */
export const ConvertLabelsModal = observer(function ConvertLabelsModal(props: Props) {
  const { isOpen, onClose, workspaceSlug, projectId } = props;
  const { t } = useTranslation();
  const store = useWorkItemType();
  const [groups, setGroups] = useState<TLabelGroup[] | undefined>(undefined);
  const [labelId, setLabelId] = useState("");
  const [target, setTarget] = useState(NEW);
  const [name, setName] = useState("");
  const [removeLabels, setRemoveLabels] = useState(false);
  const [preview, setPreview] = useState<TLabelConversionResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const dropdowns = (store.projectProperties[projectId] ?? []).filter((p) => p.property_type === "OPTION");

  useEffect(() => {
    if (!isOpen) return;
    setGroups(undefined);
    setLabelId("");
    setTarget(NEW);
    setName("");
    setRemoveLabels(false);
    setPreview(null);
    service
      .listLabelGroups(workspaceSlug, projectId)
      .then(setGroups)
      .catch(() => setGroups([]));
    void store.fetchProjectProperties(workspaceSlug, projectId);
  }, [isOpen, store, workspaceSlug, projectId]);

  const request = () => ({
    label_id: labelId,
    ...(target === NEW ? { name: name.trim() || undefined } : { property_id: target }),
    remove_labels: removeLabels,
  });

  // preview again whenever the choice changes
  useEffect(() => {
    if (!isOpen || !labelId) return;
    let active = true;
    service
      .convertLabels(workspaceSlug, projectId, { ...request(), dry_run: true })
      .then((result) => active && setPreview(result))
      .catch(() => active && setPreview(null));
    return () => {
      active = false;
    };
    // request() only reads the fields listed here
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, workspaceSlug, projectId, labelId, target, name]);

  const handleConvert = async () => {
    setIsRunning(true);
    try {
      const result = await store.convertLabels(workspaceSlug, projectId, { ...request(), dry_run: false });
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: t("wit.convert_labels_done", { count: result.work_items - result.already_set }),
      });
      onClose();
    } catch (error) {
      setToast({ type: TOAST_TYPE.ERROR, title: t("wit.error"), message: errorMessage(error, t("wit.error")) });
    } finally {
      setIsRunning(false);
    }
  };

  const group = groups?.find((g) => g.id === labelId);

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XL}>
      <div className="space-y-4 p-5">
        <div>
          <h3 className="text-h5-medium text-primary">{t("wit.convert_labels")}</h3>
          <p className="text-caption-md-regular text-tertiary">{t("wit.convert_labels_hint")}</p>
        </div>
        {groups === undefined ? (
          <Loader>
            <Loader.Item height="36px" />
          </Loader>
        ) : groups.length === 0 ? (
          <p className="rounded-md bg-layer-1 p-3 text-body-sm-regular text-tertiary">{t("wit.convert_labels_none")}</p>
        ) : (
          <>
            <div className="space-y-1">
              <span className="text-caption-md-medium text-primary">{t("wit.convert_labels_group")}</span>
              <CustomSelect
                value={labelId}
                onChange={(value: string) => {
                  setLabelId(value);
                  const picked = groups.find((g) => g.id === value);
                  if (picked && !name) setName(picked.name);
                }}
                label={<span className={group ? "" : "text-placeholder"}>{group ? group.name : t("wit.select")}</span>}
                buttonClassName="w-full justify-between"
                className="w-full"
                input
              >
                {groups.map((g) => (
                  <CustomSelect.Option key={g.id} value={g.id}>
                    {t("wit.convert_labels_group_option", { name: g.name, labels: g.labels, uses: g.uses })}
                  </CustomSelect.Option>
                ))}
              </CustomSelect>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-caption-md-medium text-primary">{t("wit.convert_labels_target")}</span>
                <CustomSelect
                  value={target}
                  onChange={setTarget}
                  label={
                    <span>
                      {target === NEW
                        ? t("wit.convert_labels_new")
                        : dropdowns.find((p) => p.id === target)?.display_name}
                    </span>
                  }
                  buttonClassName="w-full justify-between"
                  className="w-full"
                  input
                >
                  <CustomSelect.Option value={NEW}>{t("wit.convert_labels_new")}</CustomSelect.Option>
                  {dropdowns.map((p) => (
                    <CustomSelect.Option key={p.id} value={p.id}>
                      {p.display_name}
                    </CustomSelect.Option>
                  ))}
                </CustomSelect>
              </div>
              {target === NEW && (
                <div className="space-y-1">
                  <label className="text-caption-md-medium text-primary" htmlFor="convert-labels-name">
                    {t("wit.name")}
                  </label>
                  <Input
                    id="convert-labels-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full"
                    maxLength={255}
                  />
                </div>
              )}
            </div>
            <label
              htmlFor="convert-labels-remove"
              className="flex cursor-pointer items-start gap-2 text-body-sm-regular text-secondary"
            >
              <Checkbox
                id="convert-labels-remove"
                checked={removeLabels}
                onChange={(e) => setRemoveLabels(e.target.checked)}
              />
              <span>
                {t("wit.convert_labels_remove")}
                <span className="block text-caption-sm-regular text-tertiary">
                  {t("wit.convert_labels_remove_hint")}
                </span>
              </span>
            </label>
            {preview && (
              <div className="space-y-1 rounded-md border-[0.5px] border-subtle bg-layer-1 p-3 text-body-sm-regular text-secondary">
                <p className="font-medium text-primary">{t("wit.convert_labels_preview")}</p>
                <p>{t("wit.convert_labels_options", { count: preview.options.length })}</p>
                <p className="line-clamp-2 text-caption-md-regular text-tertiary">{preview.options.join(", ")}</p>
                <p>{t("wit.convert_labels_items", { count: preview.work_items - preview.already_set })}</p>
                {preview.is_multi && target === NEW && <p>{t("wit.convert_labels_multi")}</p>}
                {preview.conflicts > 0 && <p>{t("wit.convert_labels_conflicts", { count: preview.conflicts })}</p>}
                {preview.already_set > 0 && <p>{t("wit.convert_labels_already", { count: preview.already_set })}</p>}
                {preview.other_types > 0 && (
                  <p>{t("wit.convert_labels_other_types", { count: preview.other_types })}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t-[0.5px] border-subtle px-5 py-3">
        <Button variant="secondary" onClick={onClose}>
          {t("wit.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleConvert()}
          loading={isRunning}
          disabled={!labelId || !preview || isRunning}
        >
          {t("wit.convert_labels_run")}
        </Button>
      </div>
    </ModalCore>
  );
});
