"""
Clean up load test data.

Run from the backend directory:
    cd backend
    uv run python manage.py shell < ../loadtest/cleanup.py

Removes all threads/posts with "Loadtest:" prefix, messages from loadtest
users, conversations created during testing, and optionally the test users.
"""

from apps.users.models import User

LOADTEST_EMAILS = [f"loadtest{i}@test.com" for i in range(1, 6)]
test_users = User.objects.filter(email__in=LOADTEST_EMAILS)
test_user_ids = list(test_users.values_list("id", flat=True))

if not test_user_ids:
    print("No loadtest users found — nothing to clean up.")
else:
    # Clean up forum threads created by loadtest (prefixed with "Loadtest:")
    from apps.forum.models import Thread

    threads = Thread.objects.filter(title__startswith="Loadtest:")
    t_count = threads.count()
    threads.delete()
    print(f"  Deleted {t_count} loadtest threads (and their posts)")

    # Clean up posts by loadtest users (replies to existing threads)
    from apps.forum.models import Post

    posts = Post.objects.filter(author_id__in=test_user_ids)
    p_count = posts.count()
    posts.delete()
    print(f"  Deleted {p_count} posts by loadtest users")

    # Clean up conversations involving loadtest users
    from apps.messaging.models import Conversation

    convos = Conversation.objects.filter(participants__id__in=test_user_ids).distinct()
    c_count = convos.count()
    convos.delete()
    print(f"  Deleted {c_count} conversations involving loadtest users")

    # Clean up notifications for/from loadtest users
    from apps.notifications.models import Notification

    notifs = Notification.objects.filter(user_id__in=test_user_ids)
    n_count = notifs.count()
    notifs.delete()
    print(f"  Deleted {n_count} notifications for loadtest users")

    # Clean up reactions by loadtest users
    from apps.forum.models import Reaction

    reactions = Reaction.objects.filter(user_id__in=test_user_ids)
    r_count = reactions.count()
    reactions.delete()
    print(f"  Deleted {r_count} reactions by loadtest users")

    # Delete the test users themselves
    u_count = test_users.count()
    test_users.delete()
    print(f"  Deleted {u_count} loadtest users")

    print("\nCleanup complete.")
