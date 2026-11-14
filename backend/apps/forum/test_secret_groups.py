"""
Hemmelige grupper: a forum group only its members know exists.

The promise to a band that discusses privately here is that nobody else can
find, read or be told anything about the group — not residents, not staff, not
a member who has left. These tests try every road in.
"""

import re

import pytest
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from rest_framework.test import APIClient

from apps.forum import urls as forum_urls
from apps.forum.models import (
    File,
    Folder,
    Poll,
    PollOption,
    PollVote,
    Post,
    Reaction,
    Subgroup,
    SubgroupMembership,
    SubgroupSubscription,
    Thread,
)
from apps.forum.services import add_member
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User

BAND = "Bandet"


def client_for(user: User) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def mention(user: User) -> str:
    return f'<span data-type="mention" data-id="{user.id}">@{user.first_name}</span>'


@pytest.fixture
def member(db) -> User:
    return User.objects.create_user(
        email="bodil@example.com", password="x", first_name="Bodil", last_name="Bas"
    )


@pytest.fixture
def bandmate(db) -> User:
    return User.objects.create_user(
        email="tromme@example.com", password="x", first_name="Tage", last_name="Tromme"
    )


@pytest.fixture
def outsider(db) -> User:
    return User.objects.create_user(
        email="otto@example.com", password="x", first_name="Otto", last_name="Udenfor"
    )


@pytest.fixture
def staff(db) -> User:
    return User.objects.create_superuser(
        email="drift@example.com", password="x", first_name="Dorte", last_name="Drift"
    )


@pytest.fixture
def band(member, bandmate) -> Subgroup:
    group = Subgroup.objects.create(name=BAND, description="Øvelokale og setlister", is_secret=True)
    add_member(group, member)
    add_member(group, bandmate)
    return group


@pytest.fixture
def public_group(db) -> Subgroup:
    return Subgroup.objects.create(name="Fælles", slug="faelles")


@pytest.fixture
def content(band, member):
    """Something of every kind in the band's group."""
    thread = Thread.objects.create(subgroup=band, title="Turnéplan", author=member)
    post = Post.objects.create(thread=thread, author=member, content="<p>Ny hemmelig sang</p>")
    poll = Poll.objects.create(post=post, question="Hvilken sang først?", created_by=member)
    option = PollOption.objects.create(poll=poll, text="Den nye")
    folder = Folder.objects.create(subgroup=band, name="Demoer")
    file = File.objects.create(
        subgroup=band,
        folder=folder,
        uploaded_by=member,
        name="setliste.pdf",
        file=SimpleUploadedFile("setliste.pdf", b"%PDF"),
    )
    return {
        "thread": thread,
        "post": post,
        "poll": poll,
        "option": option,
        "folder": folder,
        "file": file,
    }


@pytest.fixture
def search_index(db):
    """The FTS5 table the search signals write to (as in apps/search/tests.py)."""
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5("
            "title, body, type UNINDEXED, object_id UNINDEXED, url UNINDEXED, "
            "subtitle UNINDEXED, extra UNINDEXED, created_at UNINDEXED, "
            "title_raw UNINDEXED, body_raw UNINDEXED, "
            "tokenize='unicode61 remove_diacritics 2')"
        )
    yield
    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM search_index")


# =============================================================================
# Creating one
# =============================================================================


class TestCreating:
    def test_creator_becomes_the_first_member(self, member):
        response = client_for(member).post(
            "/api/forum/subgroups/", {"name": BAND, "is_secret": True}, format="json"
        )
        assert response.status_code == 201
        assert response.data["is_secret"] is True
        assert response.data["is_member"] is True
        group = Subgroup.objects.get(id=response.data["id"])
        assert group.allows_members, "a secret group always has members"
        assert SubgroupMembership.objects.filter(subgroup=group, user=member).exists()
        assert SubgroupSubscription.objects.filter(subgroup=group, user=member).exists()

    def test_secret_slug_has_a_random_tail(self, member):
        response = client_for(member).post(
            "/api/forum/subgroups/", {"name": "Bandet Ø", "is_secret": True}, format="json"
        )
        assert re.fullmatch(r"bandet-oe-[0-9a-f]{6}", response.data["slug"])

    def test_same_name_as_a_secret_group_gives_nothing_away(self, band, outsider):
        """Before, a second "Bandet" crashed on the taken slug; with a counter it
        would get "bandet-2". Either tells the outsider a hidden "Bandet" exists."""
        response = client_for(outsider).post("/api/forum/subgroups/", {"name": BAND}, format="json")
        assert response.status_code == 201
        assert response.data["slug"] == "bandet"

    def test_two_public_groups_with_one_name_get_numbered_slugs(self, outsider):
        client = client_for(outsider)
        first = client.post("/api/forum/subgroups/", {"name": "Kor"}, format="json")
        second = client.post("/api/forum/subgroups/", {"name": "Kor"}, format="json")
        assert (first.data["slug"], second.data["slug"]) == ("kor", "kor-2")

    def test_secrecy_cannot_be_changed_afterwards(self, band, member):
        client = client_for(member)
        client.patch(f"/api/forum/subgroups/{band.slug}/update/", {"is_secret": False})
        band.refresh_from_db()
        assert band.is_secret

        public = Subgroup.objects.create(name="Kor", slug="kor")
        client.patch(f"/api/forum/subgroups/{public.slug}/update/", {"is_secret": True})
        public.refresh_from_db()
        assert not public.is_secret

    def test_membership_cannot_be_switched_off(self, band, member):
        """Switching it off deletes every membership — the group would vanish for good."""
        response = client_for(member).patch(
            f"/api/forum/subgroups/{band.slug}/update/", {"allows_members": False}
        )
        assert response.status_code == 400
        assert SubgroupMembership.objects.filter(subgroup=band).count() == 2

    @pytest.mark.parametrize(
        "field, value",
        [("is_default", True), ("reporting", Subgroup.Reporting.OPEN)],
    )
    def test_never_somewhere_everybody_looks(self, band, field, value):
        """Not followed by every new resident, not in the reports' 'Til:' picker."""
        setattr(band, field, value)
        with pytest.raises(ValidationError):
            band.full_clean()


# =============================================================================
# Hidden from everybody else
# =============================================================================


@pytest.fixture(params=["outsider", "staff"])
def stranger(request, outsider, staff) -> User:
    """Someone who isn't a member: a resident, or staff (who get no bypass)."""
    return {"outsider": outsider, "staff": staff}[request.param]


class TestHiddenFromStrangers:
    def test_not_in_the_list_of_groups(self, band, stranger, public_group):
        response = client_for(stranger).get("/api/forum/subgroups/")
        slugs = {g["slug"] for g in response.data}
        assert public_group.slug in slugs
        assert band.slug not in slugs

    def test_members_see_it(self, band, member):
        client = client_for(member)
        assert band.slug in {g["slug"] for g in client.get("/api/forum/subgroups/").data}
        assert client.get(f"/api/forum/subgroups/{band.slug}/").status_code == 200

    def test_not_in_recent_activity_or_unread_count(self, content, stranger, member):
        client = client_for(stranger)
        recent = client.get("/api/forum/recent/?limit=100").data
        assert content["post"].id not in {p["id"] for p in recent}
        # Even subscribed (left over from before), nothing counts as unread.
        SubgroupSubscription.objects.create(user=stranger, subgroup=content["thread"].subgroup)
        assert client.get("/api/forum/unread-count/").data["unread_count"] == 0
        assert BAND not in str(client.get("/api/forum/subscriptions/").data)

        member_recent = client_for(member).get("/api/forum/recent/?limit=100").data
        assert content["post"].id in {p["id"] for p in member_recent}

    def test_cannot_move_a_thread_into_it(self, band, stranger, public_group):
        thread = Thread.objects.create(subgroup=public_group, title="Min tråd", author=stranger)
        response = client_for(stranger).post(
            f"/api/forum/threads/{thread.id}/move/", {"subgroup_slug": band.slug}
        )
        assert response.status_code == 404
        thread.refresh_from_db()
        assert thread.subgroup_id == public_group.id


# Every forum URL that names a group or something in one. The test below
# checks the list against forum/urls.py, so a new endpoint can't be added
# without being tried here.
GUARDED_ENDPOINTS = [
    ("get", "subgroups/<slug:slug>/"),
    ("post", "subgroups/<slug:slug>/subscribe/"),
    ("post", "subgroups/<slug:slug>/unsubscribe/"),
    ("get", "subgroups/<slug:slug>/subscribers/"),
    ("patch", "subgroups/<slug:slug>/update/"),
    ("get", "subgroups/<slug:slug>/members/"),
    ("post", "subgroups/<slug:slug>/members/"),
    ("patch", "subgroups/<slug:slug>/members/<int:user_id>/"),
    ("delete", "subgroups/<slug:slug>/members/<int:user_id>/"),
    ("post", "subgroups/<slug:slug>/leave/"),
    ("post", "subgroups/<slug:slug>/mark-read/"),
    ("get", "subgroups/<slug:slug>/gallery/"),
    ("get", "subgroups/<slug:slug>/threads/"),
    ("post", "subgroups/<slug:slug>/threads/"),
    ("get", "subgroups/<slug:subgroup_slug>/threads/<str:thread_slug>/"),
    ("get", "threads/<int:pk>/"),
    ("post", "threads/<int:pk>/close/"),
    ("post", "threads/<int:pk>/pin/"),
    ("delete", "threads/<int:pk>/delete/"),
    ("post", "threads/<int:pk>/move/"),
    ("patch", "threads/<int:pk>/update/"),
    ("post", "threads/<int:pk>/mute/"),
    ("get", "threads/<int:thread_id>/posts/"),
    ("post", "threads/<int:thread_id>/posts/"),
    ("get", "posts/<int:pk>/"),
    ("patch", "posts/<int:pk>/"),
    ("delete", "posts/<int:pk>/"),
    ("post", "posts/<int:post_id>/react/"),
    ("get", "subgroups/<slug:slug>/folders/"),
    ("post", "subgroups/<slug:slug>/folders/"),
    ("get", "folders/<int:pk>/"),
    ("delete", "folders/<int:pk>/"),
    ("get", "folders/<int:pk>/delete-preview/"),
    ("get", "folders/<int:pk>/download/"),
    ("get", "subgroups/<slug:slug>/folder/<str:folder_slug>/"),
    ("get", "subgroups/<slug:slug>/files/"),
    ("post", "subgroups/<slug:slug>/files/"),
    ("get", "folders/<int:folder_id>/files/"),
    ("post", "folders/<int:folder_id>/files/"),
    ("get", "files/<int:pk>/"),
    ("patch", "files/<int:pk>/"),
    ("delete", "files/<int:pk>/"),
    ("patch", "files/<int:pk>/move/"),
    ("post", "polls/<int:poll_id>/vote/"),
    ("post", "polls/<int:poll_id>/options/"),
    ("patch", "polls/<int:poll_id>/"),
    ("delete", "polls/<int:poll_id>/"),
]


def test_every_forum_url_with_a_parameter_is_tried():
    routes = {str(p.pattern) for p in forum_urls.urlpatterns if "<" in str(p.pattern)}
    assert routes == {route for _, route in GUARDED_ENDPOINTS}


def _what_the_group_holds(band: Subgroup) -> dict:
    return {
        "threads": list(Thread.objects.filter(subgroup=band).values()),
        "posts": list(Post.objects.filter(thread__subgroup=band).values()),
        "memberships": list(SubgroupMembership.objects.filter(subgroup=band).values()),
        "subscriptions": list(SubgroupSubscription.objects.filter(subgroup=band).values()),
        "folders": list(Folder.objects.filter(subgroup=band).values()),
        "files": list(File.objects.filter(subgroup=band).values()),
        "reactions": Reaction.objects.filter(post__thread__subgroup=band).count(),
        "votes": PollVote.objects.filter(option__poll__post__thread__subgroup=band).count(),
        "polls": list(Poll.objects.filter(post__thread__subgroup=band).values()),
        "options": list(PollOption.objects.filter(poll__post__thread__subgroup=band).values()),
    }


@pytest.mark.parametrize("method, route", GUARDED_ENDPOINTS)
def test_strangers_get_404_and_change_nothing(
    method, route, band, content, stranger, member, public_group
):
    values = {
        "slug": band.slug,
        "subgroup_slug": band.slug,
        "thread_slug": content["thread"].slug,
        "folder_slug": content["folder"].slug,
        "user_id": member.id,
        "pk": {
            "threads": content["thread"].id,
            "posts": content["post"].id,
            "folders": content["folder"].id,
            "files": content["file"].id,
        }.get(route.split("/")[0]),
        "thread_id": content["thread"].id,
        "post_id": content["post"].id,
        "poll_id": content["poll"].id,
        "folder_id": content["folder"].id,
    }
    url = "/api/forum/" + re.sub(r"<\w+:(\w+)>", lambda m: str(values[m.group(1)]), route)
    upload = SimpleUploadedFile("spion.txt", b"x")
    body = {
        "user_ids": [stranger.id],
        "role": "Leder",
        "description": "overtaget",
        "title": "Overtaget",
        "content": "<p>Hej</p>",
        "name": "Spion",
        "subgroup_slug": public_group.slug,
        "reaction_type": "👍",
        "option_id": content["option"].id,
        "text": "Spion",
        "question": "Spion?",
        "members_only": False,
        "folder_id": "",
        "file": upload,
    }
    before = _what_the_group_holds(band)

    client = client_for(stranger)
    if method == "get":
        response = client.get(url)
    else:
        response = getattr(client, method)(url, body, format="multipart")

    assert response.status_code == 404, response.content
    assert BAND.encode() not in response.content
    assert _what_the_group_holds(band) == before


# =============================================================================
# Everything inside is for members only
# =============================================================================


class TestContentIsAlwaysPrivate:
    def test_new_thread_is_private_whatever_the_form_says(self, band, member):
        response = client_for(member).post(
            f"/api/forum/subgroups/{band.slug}/threads/",
            {"title": "Øvetider", "content": "<p>Tirsdag</p>", "members_only": False},
            format="json",
        )
        assert response.status_code == 201
        assert Thread.objects.get(id=response.data["id"]).members_only

    def test_new_file_is_private_whatever_the_form_says(self, band, member):
        response = client_for(member).post(
            f"/api/forum/subgroups/{band.slug}/files/",
            {"file": SimpleUploadedFile("noder.pdf", b"%PDF"), "members_only": False},
            format="multipart",
        )
        assert response.status_code == 201
        assert File.objects.get(subgroup=band, name="noder.pdf").members_only

    def test_a_thread_moved_in_becomes_private(self, band, member, public_group):
        thread = Thread.objects.create(subgroup=public_group, title="Koncert?", author=member)
        response = client_for(member).post(
            f"/api/forum/threads/{thread.id}/move/", {"subgroup_slug": band.slug}
        )
        assert response.status_code == 200
        thread.refresh_from_db()
        assert thread.subgroup_id == band.id
        assert thread.members_only

    def test_cannot_be_made_public(self, content, member):
        client = client_for(member)
        thread, file = content["thread"], content["file"]
        response = client.patch(
            f"/api/forum/threads/{thread.id}/update/", {"members_only": False}, format="json"
        )
        assert response.status_code == 400
        response = client.patch(
            f"/api/forum/files/{file.id}/", {"members_only": False}, format="json"
        )
        assert response.status_code == 400
        thread.refresh_from_db()
        file.refresh_from_db()
        assert thread.members_only and file.members_only

    def test_no_privacy_toggle_is_offered(self, content, member):
        client = client_for(member)
        thread = client.get(f"/api/forum/threads/{content['thread'].id}/").data
        file = client.get(f"/api/forum/files/{content['file'].id}/").data
        assert thread["can_toggle_privacy"] is False
        assert file["can_toggle_privacy"] is False

    def test_members_read_and_write_everything(self, band, content, bandmate):
        client = client_for(bandmate)
        assert client.get(f"/api/forum/threads/{content['thread'].id}/").status_code == 200
        response = client.post(
            f"/api/forum/threads/{content['thread'].id}/posts/",
            {"content": "<p>Jeg tager trommerne</p>"},
            format="json",
        )
        assert response.status_code == 201
        assert client.get(f"/api/forum/folders/{content['folder'].id}/").status_code == 200
        files = client.get(f"/api/forum/folders/{content['folder'].id}/files/").data
        assert [f["name"] for f in files] == ["setliste.pdf"]


# =============================================================================
# Leaving
# =============================================================================


class TestLeaving:
    def test_who_leaves_loses_even_their_own_threads_and_files(self, band, content, member):
        client = client_for(member)
        response = client.post(f"/api/forum/subgroups/{band.slug}/leave/")
        assert response.status_code == 200
        assert client.get(f"/api/forum/subgroups/{band.slug}/").status_code == 404
        assert client.get(f"/api/forum/threads/{content['thread'].id}/").status_code == 404
        assert client.get(f"/api/forum/files/{content['file'].id}/").status_code == 404
        assert client.delete(f"/api/forum/files/{content['file'].id}/").status_code == 404

    def test_the_group_leaves_their_list_of_followed_groups(self, band, member):
        client = client_for(member)
        client.post(f"/api/forum/subgroups/{band.slug}/leave/")
        assert not SubgroupSubscription.objects.filter(user=member, subgroup=band).exists()
        assert BAND not in str(client.get("/api/forum/subscriptions/").data)

    def test_removed_by_a_bandmate(self, band, member, bandmate):
        response = client_for(bandmate).delete(
            f"/api/forum/subgroups/{band.slug}/members/{member.id}/"
        )
        assert response.status_code == 200
        assert not SubgroupSubscription.objects.filter(user=member, subgroup=band).exists()
        assert client_for(member).get(f"/api/forum/subgroups/{band.slug}/").status_code == 404

    def test_the_last_member_cannot_leave(self, band, member, bandmate):
        client_for(bandmate).post(f"/api/forum/subgroups/{band.slug}/leave/")
        client = client_for(member)
        response = client.post(f"/api/forum/subgroups/{band.slug}/leave/")
        assert response.status_code == 400
        assert "mindst ét medlem" in response.data["detail"]
        response = client.delete(f"/api/forum/subgroups/{band.slug}/members/{member.id}/")
        assert response.status_code == 400
        assert SubgroupMembership.objects.filter(subgroup=band, user=member).exists()

    def test_the_last_member_of_an_ordinary_group_still_can(self, member):
        group = Subgroup.objects.create(name="Kor", slug="kor", allows_members=True)
        add_member(group, member)
        response = client_for(member).post(f"/api/forum/subgroups/{group.slug}/leave/")
        assert response.status_code == 200


# =============================================================================
# Nobody else is told anything
# =============================================================================


def _told(user: User, text: str) -> bool:
    return Notification.objects.filter(user=user, title__icontains=text).exists() or (
        Notification.objects.filter(user=user, message__icontains=text).exists()
    )


class TestNotifications:
    def test_a_leftover_subscriber_hears_nothing_of_a_new_thread(self, band, member, outsider):
        SubgroupSubscription.objects.create(user=outsider, subgroup=band)
        client_for(member).post(
            f"/api/forum/subgroups/{band.slug}/threads/",
            {"title": "Ny sang", "content": "<p>Omkvæd</p>", "members_only": False},
            format="json",
        )
        assert not Notification.objects.filter(user=outsider).exists()

    def test_mentioning_an_outsider_tells_them_nothing(self, band, content, member, outsider):
        client = client_for(member)
        client.post(
            f"/api/forum/subgroups/{band.slug}/threads/",
            {"title": "Gæstesanger", "content": f"<p>Spørg {mention(outsider)}</p>"},
            format="json",
        )
        client.post(
            f"/api/forum/threads/{content['thread'].id}/posts/",
            {"content": f"<p>Hvad med {mention(outsider)}?</p>"},
            format="json",
        )
        # …nor when a mention is added by editing a post.
        client.patch(
            f"/api/forum/posts/{content['post'].id}/",
            {"content": f"<p>Ny hemmelig sang til {mention(outsider)}</p>"},
            format="json",
        )
        assert not Notification.objects.filter(user=outsider).exists()

    def test_mentioning_a_bandmate_still_works(self, content, member, bandmate):
        client_for(member).patch(
            f"/api/forum/posts/{content['post'].id}/",
            {"content": f"<p>Ny hemmelig sang til {mention(bandmate)}</p>"},
            format="json",
        )
        assert Notification.objects.filter(
            user=bandmate, notification_type=NotificationType.MENTION
        ).exists()

    def test_who_left_hears_no_more_replies_or_reactions(self, band, content, member, bandmate):
        thread, post = content["thread"], content["post"]
        client_for(member).post(f"/api/forum/subgroups/{band.slug}/leave/")
        client = client_for(bandmate)
        client.post(
            f"/api/forum/threads/{thread.id}/posts/", {"content": "<p>Efter</p>"}, format="json"
        )
        client.post(f"/api/forum/posts/{post.id}/react/", {"reaction_type": "🎸"})
        assert not _told(member, thread.title)

    def test_members_hear_replies_and_reactions(self, content, member, bandmate):
        thread, post = content["thread"], content["post"]
        client = client_for(bandmate)
        client.post(
            f"/api/forum/threads/{thread.id}/posts/", {"content": "<p>Svar</p>"}, format="json"
        )
        client.post(f"/api/forum/posts/{post.id}/react/", {"reaction_type": "🎸"})
        types = set(
            Notification.objects.filter(user=member).values_list("notification_type", flat=True)
        )
        assert {NotificationType.THREAD_REPLY, NotificationType.POST_REACTION} <= types


# =============================================================================
# Search
# =============================================================================


SECRETS = ["Bandet", "setlister", "Turnéplan", "hemmelig sang", "setliste", "Demoer"]


class TestSearch:
    @pytest.mark.parametrize("query", SECRETS)
    def test_strangers_find_nothing(self, search_index, content, stranger, query):
        client = client_for(stranger)
        for url in (
            f"/api/search/?q={query}&limit=20",
            f"/api/search/advanced/?q={query}&fuzziness=fuzzy",
        ):
            response = client.get(url)
            assert response.status_code == 200
            found = str(response.data["results"])
            for secret in SECRETS:
                assert secret.lower() not in found.lower(), (url, secret)

    def test_fuzzy_name_match_finds_nothing(self, search_index, content, outsider):
        # One letter off — only the fuzzy name match catches this.
        response = client_for(outsider).get("/api/search/?q=Bandat")
        assert BAND not in str(response.data["results"])

    @pytest.mark.parametrize(
        "query, bucket",
        [
            ("Bandet", "subgroups"),
            ("Turnéplan", "threads"),
            ("hemmelig", "posts"),
            ("setliste", "files"),
            ("Demoer", "folders"),
        ],
    )
    def test_members_find_everything(self, search_index, content, bandmate, query, bucket):
        response = client_for(bandmate).get(f"/api/search/?q={query}&limit=20")
        assert response.data["results"][bucket], (query, response.data["results"])


# =============================================================================
# Elsewhere in the app
# =============================================================================


class TestEvents:
    """The calendar is everybody's: an event there would show the group to all."""

    def _event(self, subgroup_id: int) -> dict:
        return {
            "title": "Koncert",
            "start_datetime": "2030-06-01T19:00:00Z",
            "end_datetime": "2030-06-01T22:00:00Z",
            "subgroup_id": subgroup_id,
        }

    def test_cannot_belong_to_a_secret_group(self, band, member):
        response = client_for(member).post("/api/events/", self._event(band.id), format="json")
        assert response.status_code == 400
        assert "hemmelig" in str(response.data["subgroup_id"])

    def test_same_answer_for_a_group_that_does_not_exist(self, band, outsider):
        client = client_for(outsider)
        secret = client.post("/api/events/", self._event(band.id), format="json")
        missing = client.post("/api/events/", self._event(999_999), format="json")
        assert secret.status_code == missing.status_code == 400
        assert secret.data == missing.data
