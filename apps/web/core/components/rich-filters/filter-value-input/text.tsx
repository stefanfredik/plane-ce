/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { observer } from "mobx-react";
// plane imports
import { cn } from "@plane/utils";
import { COMMON_FILTER_ITEM_BORDER_CLASSNAME, EMPTY_FILTER_PLACEHOLDER_TEXT } from "../shared";

type Props = {
  type: "text" | "number";
  value: string;
  isDisabled?: boolean;
  onChange: (value: string | null) => void;
};

/** Free text or number value; applied on Enter or when the field loses focus. */
export const TextFilterValueInput = observer(function TextFilterValueInput(props: Props) {
  const { type, value, isDisabled, onChange } = props;
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next !== value) onChange(next === "" ? null : next);
  };

  return (
    <input
      type={type}
      value={draft}
      disabled={isDisabled}
      placeholder={EMPTY_FILTER_PLACEHOLDER_TEXT}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={cn(
        "h-full w-32 rounded-none bg-transparent px-2 text-13 outline-none placeholder:text-placeholder",
        !isDisabled && COMMON_FILTER_ITEM_BORDER_CLASSNAME
      )}
    />
  );
});
