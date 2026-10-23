/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { CustomSearchSelect } from "@plane/ui";
import { cn } from "@plane/utils";

export type TChoice = { value: string; label: string; icon?: ReactNode };

const BUTTON = "border-[0.5px] border-subtle-1 px-2 py-1 text-body-xs-regular min-w-32 max-w-72";

function ChoiceLabel({ choices, placeholder }: { choices: TChoice[]; placeholder: string }) {
  if (choices.length === 0) return <span className="truncate text-placeholder">{placeholder}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 truncate">
      {choices.length === 1 && choices[0].icon}
      <span className="truncate">{choices.map((c) => c.label).join(", ")}</span>
    </span>
  );
}

const asOptions = (choices: TChoice[]) =>
  choices.map((c) => ({
    value: c.value,
    query: c.label,
    content: (
      <span className="flex items-center gap-1.5">
        {c.icon}
        <span className="truncate">{c.label}</span>
      </span>
    ),
  }));

type TSingleProps = {
  value: string | undefined;
  choices: TChoice[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  className?: string;
};

/** One value from a searchable list. */
export function ChoiceSelect({ value, choices, onChange, placeholder, disabled, className }: TSingleProps) {
  return (
    <CustomSearchSelect
      value={value}
      options={asOptions(choices)}
      onChange={(next: string) => next && onChange(next)}
      label={<ChoiceLabel choices={choices.filter((c) => c.value === value)} placeholder={placeholder} />}
      buttonClassName={cn(BUTTON, className)}
      disabled={disabled}
      input
    />
  );
}

type TMultiProps = Omit<TSingleProps, "value" | "onChange"> & {
  value: string[];
  onChange: (value: string[]) => void;
};

/** Several values from a searchable list. */
export function ChoiceMultiSelect({ value, choices, onChange, placeholder, disabled, className }: TMultiProps) {
  return (
    <CustomSearchSelect
      multiple
      value={value}
      options={asOptions(choices)}
      onChange={(next: string[]) => onChange(next)}
      label={<ChoiceLabel choices={choices.filter((c) => value.includes(c.value))} placeholder={placeholder} />}
      buttonClassName={cn(BUTTON, className)}
      disabled={disabled}
      input
    />
  );
}
