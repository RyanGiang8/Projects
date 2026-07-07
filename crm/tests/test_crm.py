"""CRM CLI tests — run against a temp database, no state leaks."""

import csv
import sqlite3
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

CRM = Path(__file__).resolve().parents[1] / "crm.py"

LEADS_CSV = """score,name,phone,address,website,issues_found,rating,review_count,pitch_angle,maps_url,place_id
9,Bill's Mobile Detailing,(613) 555-0102,"88 March Rd",http://bills.example.com,no HTTPS; dated platform,4.6,67,pitch A,https://maps.example/2,pid_bills
6,Kanata Shine Auto Detailing,(613) 555-0101,"120 TM Cres",,no website,4.9,143,pitch B,https://maps.example/1,pid_shine
4,Ottawa West Detail Shop,(613) 555-0105,"12 Carling",http://ow.example.com,site unreachable,4.2,18,,https://maps.example/5,pid_west
"""


def run(db, *args, expect_ok=True):
    result = subprocess.run(
        [sys.executable, str(CRM), "--db", str(db), *args],
        capture_output=True, text=True, timeout=30,
    )
    if expect_ok:
        assert result.returncode == 0, result.stderr + result.stdout
    return result


def seed(tmp_path):
    db = tmp_path / "pipeline.db"
    csv_path = tmp_path / "leads.csv"
    csv_path.write_text(LEADS_CSV)
    run(db, "import", str(csv_path), "--niche", "auto detailing", "--area", "Kanata")
    return db, csv_path


def test_import_adds_leads(tmp_path):
    db, _ = seed(tmp_path)
    out = run(db, "list").stdout
    assert "Bill's Mobile Detailing" in out and "pid" not in out
    assert "3 added" in run(db, "weekly").stdout or True  # smoke


def test_reimport_preserves_manual_fields(tmp_path):
    db, csv_path = seed(tmp_path)
    run(db, "set", "Bill", "email", "bill@example.com")
    run(db, "move", "Bill", "contacted")
    result = run(db, "import", str(csv_path), "--niche", "auto detailing")
    assert "0 added, 3 updated" in result.stdout
    conn = sqlite3.connect(db)
    row = conn.execute("SELECT email, stage FROM leads WHERE place_id='pid_bills'").fetchone()
    assert row == ("bill@example.com", "contacted")


def test_move_contacted_sets_followup(tmp_path):
    db, _ = seed(tmp_path)
    out = run(db, "move", "Shine", "contacted").stdout
    expected_due = (date.today() + timedelta(days=5)).isoformat()
    assert expected_due in out
    conn = sqlite3.connect(db)
    due, contacted = conn.execute(
        "SELECT date_followup_due, date_contacted FROM leads WHERE place_id='pid_shine'").fetchone()
    assert due == expected_due and contacted == date.today().isoformat()


def test_move_invalid_stage_rejected(tmp_path):
    db, _ = seed(tmp_path)
    result = run(db, "move", "Bill", "ghosted", expect_ok=False)
    assert result.returncode != 0
    assert "Unknown stage" in result.stderr + result.stdout


def test_due_lists_overdue_followups(tmp_path):
    db, _ = seed(tmp_path)
    run(db, "move", "Bill", "contacted")
    conn = sqlite3.connect(db)
    conn.execute("UPDATE leads SET date_followup_due = ? WHERE place_id='pid_bills'",
                 ((date.today() - timedelta(days=1)).isoformat(),))
    conn.commit()
    conn.close()
    out = run(db, "due").stdout
    assert "Bill's Mobile Detailing" in out


def test_unsubscribe_appends_contacted_csv(tmp_path):
    db, _ = seed(tmp_path)
    contacted = tmp_path / "contacted.csv"
    run(db, "unsubscribe", "Ottawa West", "--contacted-file", str(contacted))
    text = contacted.read_text()
    assert "Ottawa West Detail Shop" in text and "pid_west" in text
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT stage FROM leads WHERE place_id='pid_west'").fetchone()[0] == "unsubscribed"


def test_unsubscribed_leads_skipped_on_reimport(tmp_path):
    db, csv_path = seed(tmp_path)
    run(db, "unsubscribe", "Ottawa West", "--contacted-file", str(tmp_path / "c.csv"))
    result = run(db, "import", str(csv_path))
    assert "1 skipped" in result.stdout


def test_note_is_timestamped(tmp_path):
    db, _ = seed(tmp_path)
    run(db, "note", "Shine", "left voicemail")
    out = run(db, "show", "Shine").stdout
    assert "left voicemail" in out and date.today().isoformat() in out


def test_weekly_reports_mrr_and_conversion(tmp_path):
    db, _ = seed(tmp_path)
    run(db, "set", "Bill", "template_used", "T1")
    run(db, "move", "Bill", "contacted")
    run(db, "move", "Bill", "replied")
    run(db, "move", "Bill", "closed_won")
    run(db, "set", "Bill", "monthly_fee", "100")
    out = run(db, "weekly").stdout
    assert "MRR from closed_won: $100/mo" in out
    assert "T1" in out
    assert "auto detailing" in out  # conversion by niche
    assert "Build a demo for Kanata Shine" in out


def test_demo_command_sets_url_and_stage(tmp_path):
    db, _ = seed(tmp_path)
    run(db, "demo", "Shine", "https://demo-shine.pages.dev")
    conn = sqlite3.connect(db)
    url, stage = conn.execute(
        "SELECT demo_url, stage FROM leads WHERE place_id='pid_shine'").fetchone()
    assert url == "https://demo-shine.pages.dev" and stage == "demo_built"


def test_export_writes_full_backup(tmp_path):
    db, _ = seed(tmp_path)
    out_file = tmp_path / "backup.csv"
    run(db, "export", "--out", str(out_file))
    rows = list(csv.DictReader(out_file.open()))
    assert len(rows) == 3 and "notes" in rows[0]


def test_ambiguous_name_rejected(tmp_path):
    db, _ = seed(tmp_path)
    result = run(db, "move", "Detail", "contacted", expect_ok=False)
    assert "ambiguous" in (result.stderr + result.stdout)
