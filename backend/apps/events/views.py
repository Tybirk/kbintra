"""
Views for Events app — CRUD, RSVP, attendees, iCal.
"""

from datetime import UTC, datetime
from typing import Any

from django.db.models import QuerySet
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Event, EventAttendance
from .serializers import (
    AttendanceSerializer,
    EventCancelSerializer,
    EventCreateUpdateSerializer,
    EventSerializer,
    HouseholdMemberSerializer,
    RsvpSubmitSerializer,
)


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners to edit/delete."""

    def has_object_permission(self, request: Request, view: Any, obj: Event) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.created_by == request.user


class EventListCreateView(generics.ListCreateAPIView):
    """List all events or create a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return EventCreateUpdateSerializer
        return EventSerializer

    def get_queryset(self) -> QuerySet[Event]:
        queryset = Event.objects.select_related(
            "created_by", "subgroup", "folder", "thread", "thread__subgroup"
        ).prefetch_related("rooms")

        # Filter by date range
        start = self.request.query_params.get("start")
        end = self.request.query_params.get("end")

        if start:
            try:
                start_date = datetime.fromisoformat(start.replace("Z", "+00:00"))
                queryset = queryset.filter(end_datetime__gt=start_date)
            except ValueError:
                pass

        if end:
            try:
                end_date = datetime.fromisoformat(end.replace("Z", "+00:00"))
                queryset = queryset.filter(start_datetime__lt=end_date)
            except ValueError:
                pass

        # Filter by visibility
        visibility = self.request.query_params.get("visibility")
        if visibility:
            queryset = queryset.filter(visibility=visibility)

        # Filter by room
        room_id = self.request.query_params.get("room")
        if room_id:
            queryset = queryset.filter(rooms__id=room_id).distinct()

        # Filter by subgroup
        subgroup_id = self.request.query_params.get("subgroup")
        if subgroup_id:
            queryset = queryset.filter(subgroup_id=subgroup_id)

        # Filter by "mine" (current user's events)
        mine = self.request.query_params.get("mine")
        if mine and mine.lower() == "true":
            queryset = queryset.filter(created_by=self.request.user)

        return queryset

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        event = (
            Event.objects.select_related("created_by", "subgroup", "folder")
            .prefetch_related("rooms")
            .get(id=serializer.instance.id)
        )
        read_data = EventSerializer(event, context={"request": request}).data
        return Response(read_data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer: EventCreateUpdateSerializer) -> None:
        event = serializer.save()
        # Create discussion thread and enqueue notification task for community events
        if event.visibility == Event.Visibility.COMMUNITY:
            from apps.events.services import create_event_thread
            from apps.notifications.tasks import notify_event_created_task

            thread = create_event_thread(event)
            if thread:
                event.thread = thread
                event.save(update_fields=["thread"])

            notify_event_created_task(event.id, event.created_by_id)


class EventDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, update, or delete an event."""

    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    queryset = Event.objects.select_related(
        "created_by", "subgroup", "folder", "thread", "thread__subgroup"
    ).prefetch_related("rooms")

    def get_serializer_class(self) -> type:
        if self.request.method in ["PUT", "PATCH"]:
            return EventCreateUpdateSerializer
        return EventSerializer

    def perform_update(self, serializer: EventCreateUpdateSerializer) -> None:
        # Capture pre-update state before serializer.save() modifies the instance
        old_title = serializer.instance.title
        old_start = serializer.instance.start_datetime
        old_location = serializer.instance.location
        old_room_ids = set(serializer.instance.rooms.values_list("id", flat=True))

        event = serializer.save()

        # Sync thread title if title changed
        if event.thread_id and event.title != old_title:
            event.thread.title = event.title
            event.thread.save(update_fields=["title"])

        # Notify if time/location changed
        time_changed = event.start_datetime != old_start
        location_changed = (
            event.location != old_location
            or set(event.rooms.values_list("id", flat=True)) != old_room_ids
        )
        if (time_changed or location_changed) and event.visibility == Event.Visibility.COMMUNITY:
            try:
                from apps.notifications.tasks import notify_event_updated_task

                notify_event_updated_task(event.id, self.request.user.id)
            except ImportError:
                pass

    def perform_destroy(self, instance: Event) -> None:
        if instance.thread_id:
            instance.thread.delete()
        instance.delete()


class UpcomingEventsView(generics.ListAPIView):
    """List upcoming community events (for dashboard widget)."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = EventSerializer

    def get_queryset(self) -> QuerySet[Event]:
        now = timezone.now()
        return (
            Event.objects.filter(
                start_datetime__gte=now,
                visibility=Event.Visibility.COMMUNITY,
            )
            .select_related("created_by", "subgroup", "folder", "thread", "thread__subgroup")
            .prefetch_related("rooms")[:5]
        )


class EventRsvpView(APIView):
    """Submit RSVP for self + household members."""

    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request: Request, pk: int) -> Response:
        try:
            event = Event.objects.get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        if not event.rsvp_enabled:
            return Response(
                {"error": "RSVP er ikke aktiveret for denne begivenhed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check deadline
        if event.rsvp_deadline and timezone.now() > event.rsvp_deadline:
            return Response(
                {"error": "RSVP-fristen er overskredet."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = RsvpSubmitSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        user_house_id = user.house_id

        for item in serializer.validated_data["attendances"]:
            user_id = item.get("user_id")
            child_id = item.get("child_id")
            rsvp_status = item["status"]

            # Validate household membership
            if user_id:
                from apps.users.models import User

                try:
                    target_user = User.objects.get(id=user_id)
                except User.DoesNotExist:
                    return Response(
                        {"error": f"Bruger {user_id} ikke fundet."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                # Must be same household or self
                if target_user.id != user.id and (
                    not user_house_id or target_user.house_id != user_house_id
                ):
                    return Response(
                        {"error": "Du kan kun svare for medlemmer af din husstand."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                EventAttendance.objects.update_or_create(
                    event=event,
                    user=target_user,
                    defaults={"status": rsvp_status, "responded_by": user, "child": None},
                )

            elif child_id:
                from apps.houses.models import Child

                try:
                    child = Child.objects.get(id=child_id)
                except Child.DoesNotExist:
                    return Response(
                        {"error": f"Barn {child_id} ikke fundet."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not user_house_id or child.house_id != user_house_id:
                    return Response(
                        {"error": "Du kan kun svare for børn i din husstand."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

                EventAttendance.objects.update_or_create(
                    event=event,
                    child=child,
                    defaults={"status": rsvp_status, "responded_by": user, "user": None},
                )

        # Return updated event
        event_serializer = EventSerializer(event, context={"request": request})
        return Response(event_serializer.data)


class EventAttendeesView(APIView):
    """Get full attendance list for an event."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        try:
            event = Event.objects.get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        attendances = event.attendances.select_related("user", "child").order_by(
            "status", "user__first_name", "child__name"
        )
        serializer = AttendanceSerializer(attendances, many=True)
        return Response(serializer.data)


class EventHouseholdView(APIView):
    """Get current user's household members for RSVP form."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, pk: int) -> Response:
        try:
            event = Event.objects.get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        user = request.user
        members = []

        # Current user always included
        own_attendance = event.attendances.filter(user=user).first()
        members.append(
            {
                "type": "adult",
                "id": user.id,
                "name": f"{user.first_name} {user.last_name}",
                "current_status": own_attendance.status if own_attendance else None,
            }
        )

        if user.house_id:
            from apps.users.models import User

            # Other adults in same house
            housemates = User.objects.filter(house_id=user.house_id, is_active=True).exclude(
                id=user.id
            )
            for housemate in housemates:
                att = event.attendances.filter(user=housemate).first()
                members.append(
                    {
                        "type": "adult",
                        "id": housemate.id,
                        "name": f"{housemate.first_name} {housemate.last_name}",
                        "current_status": att.status if att else None,
                    }
                )

            # Children in same house
            from apps.houses.models import Child

            children = Child.objects.filter(house_id=user.house_id)
            for child in children:
                att = event.attendances.filter(child=child).first()
                members.append(
                    {
                        "type": "child",
                        "id": child.id,
                        "name": child.name,
                        "current_status": att.status if att else None,
                    }
                )

        serializer = HouseholdMemberSerializer(members, many=True)
        return Response(serializer.data)


class EventICalView(APIView):
    """Download .ics file for an event."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, pk: int) -> HttpResponse:
        try:
            event = Event.objects.prefetch_related("rooms").get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        # Build iCal manually (no icalendar dependency needed for simple events)

        from django.utils.html import strip_tags

        location = event.resolved_location
        uid = f"event-{event.id}@kbintra"
        # Always output UTC timestamps (Z suffix requires UTC per RFC 5545)
        dtstart = event.start_datetime.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        dtend = event.end_datetime.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        dtstamp = timezone.now().astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
        summary = event.title.replace(",", "\\,").replace(";", "\\;")

        # Strip HTML and escape special chars (RFC 5545: commas, semicolons, newlines)
        description = (
            strip_tags(event.description)
            .replace(",", "\\,")
            .replace(";", "\\;")
            .replace("\n", "\\n")
            .replace("\r", "")
        )

        ical = (
            "BEGIN:VCALENDAR\r\n"
            "VERSION:2.0\r\n"
            "PRODID:-//KB Intra//Event//DA\r\n"
            "BEGIN:VEVENT\r\n"
            f"UID:{uid}\r\n"
            f"DTSTAMP:{dtstamp}\r\n"
            f"DTSTART:{dtstart}\r\n"
            f"DTEND:{dtend}\r\n"
            f"SUMMARY:{summary}\r\n"
        )
        if description:
            ical += f"DESCRIPTION:{description}\r\n"
        if location:
            ical += f"LOCATION:{location}\r\n"
        ical += "END:VEVENT\r\nEND:VCALENDAR\r\n"

        response = HttpResponse(ical, content_type="text/calendar; charset=utf-8")
        from django.utils.text import slugify

        safe_filename = slugify(event.title) or f"event-{event.id}"
        response["Content-Disposition"] = f'attachment; filename="{safe_filename}.ics"'
        return response


class EventCancelView(APIView):
    """Soft-cancel a community event. POST /api/events/<pk>/cancel/"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        from django.shortcuts import get_object_or_404

        event = get_object_or_404(
            Event.objects.select_related("created_by", "subgroup", "folder").prefetch_related(
                "rooms"
            ),
            pk=pk,
        )

        if event.created_by != request.user:
            return Response(
                {"error": "Kun arrangørens kan aflyse dette arrangement."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if event.is_cancelled:
            return Response(
                {"error": "Arrangementet er allerede aflyst."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = EventCancelSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        event.is_cancelled = True
        event.cancellation_message = serializer.validated_data["cancellation_message"]
        event.save(update_fields=["is_cancelled", "cancellation_message", "updated_at"])

        if event.visibility == Event.Visibility.COMMUNITY:
            from apps.notifications.tasks import notify_event_cancelled_task

            notify_event_cancelled_task(event.id, request.user.id)

        return Response(EventSerializer(event, context={"request": request}).data)


class EventFilesView(APIView):
    """List and upload files for an event.

    A folder is created on-demand when the first file is uploaded.
    Requires the event to have a subgroup (folders live under subgroups).
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request: Request, pk: int) -> Response:
        try:
            event = Event.objects.select_related("folder").get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        if not event.folder:
            return Response([])

        from apps.forum.models import File

        files = File.objects.filter(folder=event.folder).select_related("uploaded_by")
        data = [
            {
                "id": f.id,
                "name": f.name,
                "file_url": f.file.url,
                "uploaded_by": {
                    "id": f.uploaded_by.id,
                    "first_name": f.uploaded_by.first_name,
                    "last_name": f.uploaded_by.last_name,
                    "profile_picture": (
                        f.uploaded_by.profile_picture.url if f.uploaded_by.profile_picture else None
                    ),
                },
                "uploaded_at": f.uploaded_at.isoformat(),
            }
            for f in files
        ]
        return Response(data)

    def post(self, request: Request, pk: int) -> Response:
        try:
            event = Event.objects.select_related("folder", "subgroup").get(pk=pk)
        except Event.DoesNotExist:
            return Response({"error": "Begivenhed ikke fundet."}, status=status.HTTP_404_NOT_FOUND)

        files = request.FILES.getlist("files")
        if not files:
            return Response(
                {"error": "Ingen filer vedhæftet."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from apps.forum.models import File, Folder

        # Create folder on demand
        if not event.folder:
            if event.subgroup:
                year = str(event.start_datetime.year)
                year_folder, _ = Folder.objects.get_or_create(
                    subgroup=event.subgroup,
                    name=year,
                    parent=None,
                )
                event_folder = Folder.objects.create(
                    subgroup=event.subgroup,
                    name=event.title[:100],
                    parent=year_folder,
                )
            else:
                event_folder = Folder.objects.create(
                    name=event.title[:100],
                )
            event.folder = event_folder
            event.save(update_fields=["folder"])

        created_files = []
        for uploaded_file in files:
            f = File.objects.create(
                subgroup=event.subgroup,
                folder=event.folder,
                name=uploaded_file.name,
                file=uploaded_file,
                uploaded_by=request.user,
            )
            created_files.append(
                {
                    "id": f.id,
                    "name": f.name,
                    "file_url": f.file.url,
                    "uploaded_by": {
                        "id": request.user.id,
                        "first_name": request.user.first_name,
                        "last_name": request.user.last_name,
                        "profile_picture": (
                            request.user.profile_picture.url
                            if request.user.profile_picture
                            else None
                        ),
                    },
                    "uploaded_at": f.uploaded_at.isoformat(),
                }
            )

        return Response(created_files, status=status.HTTP_201_CREATED)
