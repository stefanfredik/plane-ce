# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""Bot users that act for automations and integrations, so their changes carry a clear name."""

from plane.db.models import User


def get_bot(bot_type, name):
    user = User.objects.filter(is_bot=True, bot_type=bot_type).first()
    if user:
        return user
    slug = bot_type.lower()
    user = User.objects.create(
        email=f"{slug}@bots.plane.local",
        username=f"plane_{slug}_bot",
        first_name=name,
        display_name=name,
        is_bot=True,
        bot_type=bot_type,
        is_active=True,
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return user
