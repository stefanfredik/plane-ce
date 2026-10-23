/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { usePathname } from "next/navigation";

/** "/views" on a published view, "/issues" on a published project, so links stay on the same page. */
export const usePublishedBasePath = () => (usePathname().includes("/views/") ? "/views" : "/issues");
