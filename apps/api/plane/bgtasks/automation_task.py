# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Third party imports
from celery import shared_task

# Module imports
from plane.utils import automations
from plane.utils.exception_logger import log_exception


@shared_task
def dispatch_automations(issue_id, events, actor_id=None, property_ids=None):
    try:
        automations.dispatch(issue_id, events, actor_id, property_ids)
    except Exception as e:
        log_exception(e)


@shared_task
def run_scheduled_automations():
    try:
        automations.run_due_schedules()
    except Exception as e:
        log_exception(e)
