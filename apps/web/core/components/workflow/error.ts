/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { TOAST_TYPE, setToast } from "@plane/propel/toast";

/** The server's reason when a state change breaks the project's workflow. */
export const workflowErrorMessage = (error: unknown): string | undefined => {
  const value = (error as { state_id?: string | string[] } | undefined)?.state_id;
  return Array.isArray(value) ? value[0] : value;
};

/** Show the workflow reason as a toast; true when the error was a workflow error. */
export const toastWorkflowError = (error: unknown): boolean => {
  const message = workflowErrorMessage(error);
  if (!message) return false;
  setToast({ type: TOAST_TYPE.WARNING, title: "Workflow", message });
  return true;
};
