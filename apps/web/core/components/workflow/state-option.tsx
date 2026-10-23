/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import { Lock } from "lucide-react";
import { Combobox } from "@headlessui/react";
import { useTranslation } from "@plane/i18n";
import { CheckIcon } from "@plane/propel/icons";
import { Tooltip } from "@plane/propel/tooltip";
import { cn } from "@plane/utils";
// hooks
import { useWorkflow } from "@/hooks/store/use-workflow";

export type TStateOptionProps = {
  projectId: string | null | undefined;
  option: {
    value: string | undefined;
    query: string;
    content: React.ReactNode;
  };
  selectedValue: string | null | undefined;
  className?: string;
  filterAvailableStateIds?: boolean;
  isForWorkItemCreation?: boolean;
  alwaysAllowStateChange?: boolean;
};

export const StateOption = observer(function StateOption(props: TStateOptionProps) {
  const { option, className = "", projectId, selectedValue, isForWorkItemCreation, alwaysAllowStateChange } = props;
  const { t } = useTranslation();
  const { workspaceSlug } = useParams();
  const { ensureWorkflow, isCreationBlocked, isMoveAllowed } = useWorkflow();

  useEffect(() => {
    if (workspaceSlug && projectId) void ensureWorkflow(workspaceSlug.toString(), projectId);
  }, [ensureWorkflow, workspaceSlug, projectId]);

  const blockedReason = alwaysAllowStateChange
    ? undefined
    : isForWorkItemCreation
      ? isCreationBlocked(projectId, option.value)
        ? t("workflows.workflow_states.work_item_creation_disable_tooltip")
        : undefined
      : !isMoveAllowed(projectId, selectedValue, option.value)
        ? t("workflows.workflow_disabled.title")
        : undefined;

  if (blockedReason)
    return (
      <Tooltip tooltipContent={blockedReason} position="right">
        <div className={cn(className, "cursor-not-allowed text-placeholder")}>
          <span className="flex-grow truncate opacity-60">{option.content}</span>
          <Lock className="h-3 w-3 flex-shrink-0" />
        </div>
      </Tooltip>
    );

  return (
    <Combobox.Option
      key={option.value}
      value={option.value}
      className={({ active, selected }) =>
        cn(`${className} ${active ? "bg-layer-transparent-hover" : ""} ${selected ? "text-primary" : "text-secondary"}`)
      }
    >
      {({ selected }) => (
        <>
          <span className="flex-grow truncate">{option.content}</span>
          {selected && <CheckIcon className="h-3.5 w-3.5 flex-shrink-0" />}
        </>
      )}
    </Combobox.Option>
  );
});
