"""What the search index holds for each kind of object: one function per model.

The save signals and `rebuild_search_index` both build rows from these, so a
rebuild writes exactly what saving would. They used to build them separately and
drifted: a rebuilt car lost its make and the delebil words, and a rebuilt event
showed its time in UTC.

Each returns the keyword arguments for `index_object`, or None when the object
shouldn't be in the index (an inactive user, a car without a plate, …).
"""

import json

from django.utils import timezone

from .services import _isoformat, create_excerpt, strip_html


def user_document(user) -> dict | None:  # type: ignore[no-untyped-def]
    if not user.is_active:
        return None
    return {
        "obj_type": "user",
        "object_id": user.id,
        "title": user.get_full_name() or user.email,
        "body": user.email,
        "url": f"/profil/{user.id}",
        "subtitle": user.house.name if user.house_id else "",
        "created_at": _isoformat(user.date_joined),
    }


def house_document(house) -> dict:  # type: ignore[no-untyped-def]
    return {
        "obj_type": "house",
        "object_id": house.id,
        "title": house.name,
        "body": strip_html(house.description) if house.description else "",
        "url": f"/beboere/hus/{house.slug}",
        "subtitle": create_excerpt(house.description, 80) if house.description else "",
        "created_at": _isoformat(house.created_at),
    }


def car_document(car) -> dict | None:  # type: ignore[no-untyped-def]
    from apps.houses.utils import format_license_plate, normalize_license_plate

    if not car.license_plate:
        return None
    subtitle_parts = [car.house.name]
    if car.is_electric:
        subtitle_parts.append("Elbil")
    if car.is_shared:
        subtitle_parts.append("Delebil")
    # Both the display ("AB 12 345") and the compact ("AB12345") plate, so it is
    # found typed either way; make and model so "Skoda" finds the car; the
    # sharing words so "delebil" lists everything shared.
    body_parts = [
        car.house.name,
        normalize_license_plate(car.license_plate),
        car.make,
        car.model_name,
    ]
    if car.is_shared:
        body_parts.append("delebil delebilpark bildeling")
    return {
        "obj_type": "car",
        "object_id": car.id,
        "title": format_license_plate(car.license_plate),
        "body": " ".join(part for part in body_parts if part),
        "url": f"/beboere/hus/{car.house.slug}",
        "subtitle": " · ".join(subtitle_parts),
        "created_at": _isoformat(car.created_at),
    }


def thread_document(thread) -> dict:  # type: ignore[no-untyped-def]
    # The thread is findable by its opening post.
    first_post = thread.posts.order_by("created_at").first()
    return {
        "obj_type": "thread",
        "object_id": thread.id,
        "title": thread.title,
        "body": strip_html(first_post.content) if first_post else "",
        "url": f"/forum/{thread.subgroup.slug}/traad/{thread.slug}",
        "subtitle": thread.subgroup.name,
        "created_at": _isoformat(thread.created_at),
    }


def post_document(post) -> dict:  # type: ignore[no-untyped-def]
    thread = post.thread
    return {
        "obj_type": "post",
        "object_id": post.id,
        "title": thread.title,
        "body": strip_html(post.content),
        "url": f"/forum/{thread.subgroup.slug}/traad/{thread.slug}#post-{post.id}",
        "subtitle": create_excerpt(post.content, 80),
        "extra": json.dumps({"thread_id": thread.id}),
        "created_at": _isoformat(post.created_at),
    }


def subgroup_document(subgroup) -> dict:  # type: ignore[no-untyped-def]
    return {
        "obj_type": "subgroup",
        "object_id": subgroup.id,
        "title": subgroup.name,
        "body": strip_html(subgroup.description) if subgroup.description else "",
        "url": f"/forum/{subgroup.slug}",
        "subtitle": create_excerpt(subgroup.description, 80) if subgroup.description else "",
        "created_at": _isoformat(subgroup.created_at),
    }


def announcement_document(announcement) -> dict | None:  # type: ignore[no-untyped-def]
    if not announcement.is_active:
        return None
    return {
        "obj_type": "announcement",
        "object_id": announcement.id,
        "title": announcement.title,
        "body": strip_html(announcement.content),
        "url": f"/opslag#announcement-{announcement.id}",
        "subtitle": create_excerpt(announcement.content, 80),
        "created_at": _isoformat(announcement.created_at),
    }


def event_document(event) -> dict | None:  # type: ignore[no-untyped-def]
    if event.is_cancelled:
        return None
    # Local time: a datetime read back from the database is UTC.
    date_str = timezone.localtime(event.start_datetime).strftime("%d/%m/%Y %H:%M")
    location = event.resolved_location
    description = strip_html(event.description) if event.description else ""
    return {
        "obj_type": "event",
        "object_id": event.id,
        "title": event.title,
        "body": " ".join(part for part in (description, location) if part),
        "url": f"/kalender/{event.slug}",
        "subtitle": f"{date_str} – {location}" if location else date_str,
        "extra": json.dumps({"event_date": _isoformat(event.start_datetime)}),
        "created_at": _isoformat(event.created_at),
    }


def file_document(file) -> dict | None:  # type: ignore[no-untyped-def]
    # A file without a group is an event attachment: not searchable on its own.
    if not file.subgroup_id:
        return None
    try:
        file_url = file.file.url
    except ValueError:
        file_url = ""
    return {
        "obj_type": "file",
        "object_id": file.id,
        "title": file.name,
        "body": "",
        "url": f"/forum/{file.subgroup.slug}",
        "subtitle": file.subgroup.name,
        "extra": json.dumps({"file_url": file_url}) if file_url else "",
        "created_at": _isoformat(file.uploaded_at),
    }


def folder_document(folder) -> dict | None:  # type: ignore[no-untyped-def]
    if not folder.subgroup_id:
        return None
    return {
        "obj_type": "folder",
        "object_id": folder.id,
        "title": folder.name,
        "body": "",
        "url": f"/forum/{folder.subgroup.slug}/dokumenter/{folder.slug}",
        "subtitle": folder.subgroup.name,
        "created_at": _isoformat(folder.created_at),
    }


def report_document(report) -> dict:  # type: ignore[no-untyped-def]
    """The description goes in the *title* rather than the case number: BM25 weights
    title 10x, and "#12" is not what anyone searches for — "støvsugerslange" is.
    The number lives in the subtitle where it stays readable.

    This is the single declaration of what is searchable about a case: the
    queue's own search box filters through this index too, and its placeholder
    promises "beskrivelse, sted eller navn" — so the name has to be here.
    """
    body = report.description
    if report.location:
        body = f"{body}\n{report.location}"
    # Not `reporter_name`: that property falls back to the literal "Ukendt",
    # which would make every case with no reporter answer a search for it.
    if report.submitted_by:
        body = f"{body}\n{report.submitted_by.get_full_name() or report.submitted_by.email}"
    elif report.legacy_reporter_name:
        body = f"{body}\n{report.legacy_reporter_name}"
    return {
        "obj_type": "report",
        "object_id": report.id,
        "title": create_excerpt(report.description, 80),
        "body": body,
        "url": f"/indrapportering/{report.subgroup.slug}/{report.number}",
        "subtitle": f"Indrapportering #{report.number} · {report.subgroup.name}",
        "created_at": _isoformat(report.created_at),
    }
