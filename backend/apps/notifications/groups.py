"""
Grouping metadata for notification preferences.

NOTIFICATION_GROUPS is the single source of truth the frontend uses to render the
preference screen without hardcoding labels. Each group lists fields by their *base
key* — the part after the notify_/email_/push_ prefix on NotificationPreference. The
frontend toggles notify_<key>, email_<key> and push_<key> for each base key.
"""

NOTIFICATION_GROUPS: list[dict] = [
    {
        "key": "messages",
        "label": "Beskeder",
        "fields": [
            {
                # In-app uses notify_message_reactions (NEW_MESSAGE never creates
                # an in-app row, so only reactions are toggleable in-app). Email
                # and push share a single umbrella preference (email_messages /
                # push_messages) that covers both NEW_MESSAGE and MESSAGE_REACTION,
                # so override the channel key for those tabs.
                "key": "message_reactions",
                "channel_keys": {"email": "messages", "push": "messages"},
                "label": "Reaktioner på dine beskeder",
                "description": "Få besked når nogen reagerer på en af dine private beskeder",
            },
        ],
    },
    {
        "key": "forum",
        "label": "Forum",
        "fields": [
            {
                "key": "forum_subscriptions",
                "label": "Nye tråde",
                "description": "Få besked om nye tråde i grupper, du følger",
            },
            {
                "key": "thread_replies",
                "label": "Svar i dine tråde",
                "description": "Få besked når nogen svarer i en tråd, du deltager i",
            },
            {
                "key": "subgroup_activity",
                "label": "Aktivitet i grupper",
                "description": "Få besked om al aktivitet i grupper, du følger",
            },
            {
                "key": "post_reactions",
                "label": "Reaktioner på dine indlæg",
                "description": "Få besked når nogen reagerer på et af dine indlæg",
            },
            {
                "key": "mentions",
                "label": "Omtaler",
                "description": "Få besked når nogen nævner dig",
            },
        ],
    },
    {
        "key": "announcements",
        "label": "Vigtige opslag",
        "fields": [
            {
                "key": "announcements",
                "label": "Nye opslag",
                "description": "Få besked om nye vigtige opslag",
            },
            {
                "key": "announcement_updates",
                "label": "Opdaterede opslag",
                "description": "Få besked når et vigtigt opslag bliver redigeret",
            },
        ],
    },
    {
        "key": "events",
        "label": "Begivenheder",
        "fields": [
            {
                "key": "events",
                "label": "Begivenheder",
                "description": "Få besked om nye, ændrede eller aflyste begivenheder",
            },
            {
                "key": "event_reminders",
                "label": "Påmindelser",
                "description": "Få en påmindelse før en begivenhed, du deltager i",
            },
        ],
    },
    {
        "key": "food",
        "label": "Mad",
        "fields": [
            {
                "key": "food_tickets",
                "label": "Madbilletter",
                "description": "Få besked når der er madbilletter til rådighed",
            },
            {
                "key": "food_team_reminder",
                "label": "Påmindelse om madhold",
                "description": "Få besked aftenen før du har madhold",
            },
            {
                "key": "food_takeaway_ready",
                "label": "Takeaway er klar",
                "description": "Få besked når dagens takeaway kan afhentes",
            },
            {
                "key": "food_leftovers_ready",
                "label": "Rester er klar",
                "description": "Få besked når der er rester i fælleshuset",
            },
            {
                "key": "food_swap_request",
                "label": "Bytteanmodninger",
                "description": "Få besked når nogen vil bytte en maddag, du kan tage",
            },
        ],
    },
    {
        "key": "car_sharing",
        "label": "Bildeling",
        "fields": [
            {
                "key": "car_sharing",
                "label": "Bildeling",
                "description": "Få besked når nogen vil låne din bil, eller der er nyt om et lån",
            },
        ],
    },
    {
        "key": "reports",
        "label": "Indrapportering",
        "fields": [
            {
                "key": "reports",
                "label": "Indrapportering",
                "description": (
                    "Få besked om nye sager til dit udvalg, og om opdateringer "
                    "på sager du følger"
                ),
            },
        ],
    },
]
