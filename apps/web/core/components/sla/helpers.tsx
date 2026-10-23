/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
// services
import type { TSlaStatus } from "@/services/sla.service";

const STATUS_CLASSES: Record<TSlaStatus, string> = {
  on_track: "bg-success-subtle text-success-primary",
  at_risk: "bg-warning-subtle text-warning-primary",
  breached: "bg-danger-subtle text-danger-primary",
  met: "bg-layer-2 text-secondary",
  missed: "bg-danger-subtle text-danger-secondary",
};

export function SlaStatusBadge({ status, className }: { status: TSlaStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-caption-sm-medium whitespace-nowrap",
        STATUS_CLASSES[status],
        className
      )}
    >
      {t(`sla.status.${status}`)}
    </span>
  );
}

/** "2d 4h", "3h 20m" or "12m" for a number of minutes. */
export const formatMinutes = (total: number) => {
  const minutes = Math.max(0, Math.round(total));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
};

export const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60000;
