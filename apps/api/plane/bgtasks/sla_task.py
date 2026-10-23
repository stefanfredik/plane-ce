# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from celery import shared_task

# Module imports
from plane.utils import sla
from plane.utils.exception_logger import log_exception


@shared_task
def refresh_issue_sla(issue_id):
    try:
        sla.refresh_by_id(issue_id)
    except Exception as e:
        log_exception(e)


@shared_task
def refresh_project_slas(project_id):
    try:
        sla.refresh_project(project_id)
    except Exception as e:
        log_exception(e)


@shared_task
def check_sla_breaches():
    try:
        sla.check_breaches()
    except Exception as e:
        log_exception(e)
