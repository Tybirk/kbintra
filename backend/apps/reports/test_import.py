"""
Tests for the import of Driftsudvalgets cases from the old app's .xlsx export.

The fixture workbook is built here rather than committed, for two reasons: the
real export carries residents' names and email addresses, and hand-building it
lets each format quirk we rely on be exercised explicitly — inline strings, the
"▲ NYE SAGER" separator row, and photos anchored as floating drawings rather
than cell values.
"""

import io
import zipfile

import pytest
from PIL import Image

from apps.forum.models import Subgroup
from apps.reports.models import Report
from apps.users.models import User

SHEET_XML = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1">
  <c r="A1" t="inlineStr"><is><t>ID</t></is></c>
  <c r="B1" t="inlineStr"><is><t>Dato</t></is></c>
  <c r="C1" t="inlineStr"><is><t>Kategori</t></is></c>
  <c r="D1" t="inlineStr"><is><t>Beskrivelse</t></is></c>
  <c r="E1" t="inlineStr"><is><t>Navn</t></is></c>
  <c r="F1" t="inlineStr"><is><t>Husnummer</t></is></c>
  <c r="G1" t="inlineStr"><is><t>Email</t></is></c>
  <c r="H1" t="inlineStr"><is><t>Status</t></is></c>
  <c r="I1" t="inlineStr"><is><t>Billeder</t></is></c>
  <c r="J1" t="inlineStr"><is><t>Link</t></is></c>
</row>
<row r="2">
  <c r="A2" t="inlineStr"><is><t>12</t></is></c>
  <c r="B2" t="inlineStr"><is><t>15-08-2026</t></is></c>
  <c r="C2" t="inlineStr"><is><t>Defekt inventar</t></is></c>
  <c r="D2" t="inlineStr"><is><t>Defekt stoevsugerslange</t></is></c>
  <c r="E2" t="inlineStr"><is><t>Testa</t></is></c>
  <c r="F2" t="inlineStr"><is><t>29</t></is></c>
  <c r="G2" t="inlineStr"><is><t>Testa@example.com</t></is></c>
  <c r="H2" t="inlineStr"><is><t>I gang</t></is></c>
  <c r="J2" t="inlineStr"><is><t>https://old.example/sag/12</t></is></c>
</row>
<row r="3">
  <c r="A3" t="inlineStr"><is><t>▲  NYE SAGER SIDEN SIDSTE UDTRÆK</t></is></c>
</row>
<row r="4">
  <c r="A4" t="inlineStr"><is><t>7</t></is></c>
  <c r="B4" t="inlineStr"><is><t>26-05-2026</t></is></c>
  <c r="C4" t="inlineStr"><is><t>Forslag til nyt inventar</t></is></c>
  <c r="D4" t="inlineStr"><is><t>Rivejern til citroner</t></is></c>
  <c r="E4" t="inlineStr"><is><t>Ukendt Person</t></is></c>
  <c r="F4" t="inlineStr"><is><t>23</t></is></c>
  <c r="G4" t="inlineStr"><is><t>ingen-bruger@example.com</t></is></c>
  <c r="H4" t="inlineStr"><is><t>Afsluttet</t></is></c>
</row>
</sheetData>
</worksheet>
"""

# One photo, anchored to row index 3 (0-based) — i.e. excel row 4, case #7.
DRAWING_XML = """<?xml version="1.0" encoding="UTF-8"?>
<xdr:wsDr
  xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>8</xdr:col><xdr:row>3</xdr:row></xdr:from>
    <xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>
  </xdr:oneCellAnchor>
</xdr:wsDr>
"""

RELS_XML = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
    Target="../media/image1.png"/>
</Relationships>
"""


def _png() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "white").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def export_file(tmp_path):
    """A miniature version of the real export, written to a temp path."""
    path = tmp_path / "Sager test.xlsx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("xl/worksheets/sheet1.xml", SHEET_XML)
        archive.writestr("xl/drawings/drawing1.xml", DRAWING_XML)
        archive.writestr("xl/drawings/_rels/drawing1.xml.rels", RELS_XML)
        archive.writestr("xl/media/image1.png", _png())
    return path


@pytest.fixture
def du(db):
    return Subgroup.objects.create(
        name="Driftsudvalget",
        slug="driftsudvalget",
        is_committee=True,
        allows_members=True,
        reporting_enabled=True,
    )


@pytest.fixture
def reporter(db):
    """Matches row 2 — but with a +tag, as one real resident's address does."""
    return User.objects.create_user(
        email="testa+kbintra@example.com",
        password="pass12345",
        first_name="Testa",
        last_name="Testesen",
    )


def _import(export_file, **kwargs):
    from django.core.management import call_command

    options = {"no_extras": True, "verbosity": 0}
    options.update(kwargs)
    call_command("import_du_reports", str(export_file), **options)


@pytest.mark.django_db
def test_imports_cases_with_original_numbers(export_file, du, reporter):
    _import(export_file)

    assert sorted(Report.objects.values_list("number", flat=True)) == [7, 12]

    case = Report.objects.get(number=12)
    assert case.kind == Report.Kind.DEFECT
    assert case.status == Report.Status.IN_PROGRESS
    assert case.description == "Defekt stoevsugerslange"
    assert case.legacy_url == "https://old.example/sag/12"


@pytest.mark.django_db
def test_original_dates_are_preserved(export_file, du, reporter):
    """auto_now_add would otherwise stamp every historic case with today."""
    _import(export_file)

    assert Report.objects.get(number=12).created_at.date().isoformat() == "2026-08-15"
    assert Report.objects.get(number=7).created_at.date().isoformat() == "2026-05-26"


@pytest.mark.django_db
def test_separator_row_is_skipped(export_file, du, reporter):
    _import(export_file)
    assert Report.objects.count() == 2


@pytest.mark.django_db
def test_reporter_matched_across_plus_addressing(export_file, du, reporter):
    _import(export_file)

    case = Report.objects.get(number=12)
    assert case.submitted_by == reporter
    assert case.legacy_reporter_name == ""


@pytest.mark.django_db
def test_unmatched_reporter_keeps_their_name(export_file, du, reporter):
    _import(export_file)

    case = Report.objects.get(number=7)
    assert case.submitted_by is None
    assert case.legacy_reporter_name == "Ukendt Person"
    assert case.reporter_name == "Ukendt Person"


@pytest.mark.django_db
def test_anchored_photo_lands_on_the_right_case(export_file, du, reporter):
    _import(export_file)

    assert Report.objects.get(number=7).photos.count() == 1
    assert Report.objects.get(number=12).photos.count() == 0


@pytest.mark.django_db
def test_opening_log_entry_records_the_provenance(export_file, du, reporter):
    _import(export_file)

    events = Report.objects.get(number=12).events.all()
    assert len(events) == 1
    assert "tidligere indrapporteringssystem" in events[0].message


@pytest.mark.django_db
def test_closed_cases_get_no_invented_closing_date(export_file, du, reporter):
    _import(export_file)

    case = Report.objects.get(number=7)
    assert case.status == Report.Status.DONE
    # The export records no closing date, so leaving it blank beats guessing.
    assert case.closed_at is None


@pytest.mark.django_db
def test_import_is_idempotent(export_file, du, reporter):
    _import(export_file)
    _import(export_file)

    assert Report.objects.count() == 2
    assert Report.objects.get(number=7).photos.count() == 1


@pytest.mark.django_db
def test_dry_run_writes_nothing(export_file, du, reporter):
    _import(export_file, dry_run=True)
    assert Report.objects.count() == 0


@pytest.mark.django_db
def test_import_does_not_notify(export_file, du, reporter):
    """Importing history must not fire 13 cases' worth of notifications."""
    from apps.notifications.models import Notification

    _import(export_file)
    assert not Notification.objects.exists()


@pytest.mark.django_db
def test_extra_cases_carry_the_ones_after_the_export(export_file, du, reporter):
    """Case #13 postdates the 18 August extract and is carried by hand."""
    _import(export_file, no_extras=False)

    case = Report.objects.get(number=13)
    assert case.status == Report.Status.AWAITING_OTHER
    assert "OK stander 3" in case.description


@pytest.mark.django_db
def test_next_case_continues_after_the_imported_numbers(export_file, du, reporter):
    from apps.reports.services import next_number

    _import(export_file, no_extras=False)
    assert next_number(du.id) == 14


@pytest.mark.django_db
def test_missing_file_is_reported_clearly(db, du, tmp_path):
    from django.core.management import call_command
    from django.core.management.base import CommandError

    with pytest.raises(CommandError, match="findes ikke"):
        call_command("import_du_reports", str(tmp_path / "nope.xlsx"), verbosity=0)


@pytest.mark.django_db
def test_unknown_subgroup_is_reported_clearly(export_file, db):
    from django.core.management import call_command
    from django.core.management.base import CommandError

    with pytest.raises(CommandError, match="Ingen gruppe"):
        call_command("import_du_reports", str(export_file), subgroup="findes-ikke", verbosity=0)
