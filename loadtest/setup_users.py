"""
Create test users for load testing.

Run from the backend directory:
    cd backend
    uv run python manage.py shell < ../loadtest/setup_users.py

Creates 5 test users (loadtest1-5@test.com / loadtest123) and subscribes
them to all forum subgroups so they generate notifications for each other.
"""

from apps.users.models import User

PASSWORD = "loadtest123"
USERS = [
    ("loadtest1@test.com", "Load", "Tester1"),
    ("loadtest2@test.com", "Load", "Tester2"),
    ("loadtest3@test.com", "Load", "Tester3"),
    ("loadtest4@test.com", "Load", "Tester4"),
    ("loadtest5@test.com", "Load", "Tester5"),
]

created_users = []
for email, first, last in USERS:
    user, created = User.objects.get_or_create(
        email=email,
        defaults={"first_name": first, "last_name": last},
    )
    if created:
        user.set_password(PASSWORD)
        user.save()
        print(f"  Created {email}")
    else:
        print(f"  Already exists: {email}")
    created_users.append(user)

# Subscribe all test users to all forum subgroups
try:
    from apps.forum.models import Subgroup, SubgroupSubscription

    subgroups = Subgroup.objects.all()
    count = 0
    for user in created_users:
        for sg in subgroups:
            _, was_created = SubgroupSubscription.objects.get_or_create(
                user=user, subgroup=sg
            )
            if was_created:
                count += 1
    print(
        f"  Subscribed to {count} new subgroups ({len(created_users)} users x {subgroups.count()} subgroups)"
    )
except Exception as e:
    print(f"  Could not subscribe to subgroups: {e}")

# Create a conversation between first two users so messaging works immediately
try:
    from apps.messaging.models import Conversation

    if len(created_users) >= 2:
        # Check if they already share a conversation
        existing = (
            Conversation.objects.filter(participants=created_users[0])
            .filter(participants=created_users[1])
            .first()
        )
        if existing:
            print(
                f"  Conversation already exists between {created_users[0].email} and {created_users[1].email}"
            )
        else:
            conv = Conversation.objects.create()
            conv.participants.add(created_users[0], created_users[1])
            print(
                f"  Created conversation between {created_users[0].email} and {created_users[1].email}"
            )
except Exception as e:
    print(f"  Could not create conversation: {e}")

print()
print("Done! Set this env var to use all 5 users:")
print()
print(
    '  export LOAD_TEST_USERS="loadtest1@test.com:loadtest123,loadtest2@test.com:loadtest123,loadtest3@test.com:loadtest123,loadtest4@test.com:loadtest123,loadtest5@test.com:loadtest123"'
)
