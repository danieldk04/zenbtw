#!/usr/bin/env python3
"""Insert tool callout boxes into relevant blog posts before the .cta-box div."""

import os
import re

BLOG_DIR = "/home/user/zenbtw/blog"

CALLOUT_DEADLINE = """<div style="background:#e8f0ec;border:1.5px solid #b8d8c4;border-left:4px solid #1a4731;border-radius:12px;padding:18px 22px;margin:40px 0;display:flex;align-items:flex-start;gap:14px">
  <span style="font-size:22px;flex-shrink:0;line-height:1.2">📅</span>
  <div>
    <strong style="font-size:14px;color:#1a4731;display:block;margin-bottom:3px">Gratis hulpmiddel: BTW Deadlinekalender 2026 &amp; 2027</strong>
    <p style="font-size:13px;color:#4a4640;margin:0 0 10px;line-height:1.55">Alle BTW-aangifte deadlines op een rij — gecorrigeerd voor weekenden. Exporteerbaar naar Google Agenda, Outlook of als PDF.</p>
    <a href="/hulpmiddelen/btw-deadline-kalender/" style="display:inline-block;background:#1a4731;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Bekijk BTW Deadlinekalender →</a>
  </div>
</div>"""

CALLOUT_PLICHTIG = """<div style="background:#e8f0ec;border:1.5px solid #b8d8c4;border-left:4px solid #1a4731;border-radius:12px;padding:18px 22px;margin:40px 0;display:flex;align-items:flex-start;gap:14px">
  <span style="font-size:22px;flex-shrink:0;line-height:1.2">❓</span>
  <div>
    <strong style="font-size:14px;color:#1a4731;display:block;margin-bottom:3px">Gratis checker: Ben ik BTW-plichtig?</strong>
    <p style="font-size:13px;color:#4a4640;margin:0 0 10px;line-height:1.55">Beantwoord 4 vragen en ontdek direct of jij BTW-plichtig bent, de KOR kunt gebruiken of OSS-plichtig bent.</p>
    <a href="/hulpmiddelen/btw-plichtig-checker/" style="display:inline-block;background:#1a4731;color:#fff;padding:7px 16px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">Doe de BTW-plicht check →</a>
  </div>
</div>"""

# blogs that need only the deadline calendar callout
DEADLINE_ONLY = [
    "wanneer-btw-aangifte-etsy.html",
    "marketplace-verkoper-btw-aangifte.html",
    "oss-deadline-kwartaal-2026.html",
    "oss-aangifte-nederland.html",
    "oss-aangifte-zelf-doen.html",
    "nihil-aangifte-btw-kor.html",
]

# blogs that need only the plichtig checker callout
PLICHTIG_ONLY = [
    "etsy-btw-2026.html",
    "vinted-belasting-2026.html",
    "tweedehands-verkopen-belasting-2026.html",
    "hoeveel-btw-vinted-verkoper.html",
    "vinted-ondernemer-btw-registratie.html",
    "kor-vrijstelling-2026.html",
    "kor-buitenland-verkopen.html",
    "factuur-sturen-kor-ondernemer.html",
    "amazon-verkoper-btw-nederland.html",
]

# blogs that need both callouts
BOTH = [
    "etsy-verkoper-belastingaangifte.html",
    "verschil-kor-oss-regeling.html",
    "kor-opzeggen-hoe.html",
    "inkomstenbelasting-marketplace-verkoper.html",
]

# marker to avoid double-inserting
MARKER_DEADLINE = "btw-deadline-kalender"
MARKER_PLICHTIG = "btw-plichtig-checker"

def update_file(filename, insert_deadline, insert_plichtig):
    path = os.path.join(BLOG_DIR, filename)
    if not os.path.exists(path):
        print(f"  SKIP (not found): {filename}")
        return False

    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # check if already updated
    has_deadline = MARKER_DEADLINE in content
    has_plichtig = MARKER_PLICHTIG in content

    if insert_deadline and has_deadline:
        insert_deadline = False
    if insert_plichtig and has_plichtig:
        insert_plichtig = False

    if not insert_deadline and not insert_plichtig:
        print(f"  SKIP (already done): {filename}")
        return False

    # build the insertion block
    parts = []
    if insert_deadline:
        parts.append(CALLOUT_DEADLINE)
    if insert_plichtig:
        parts.append(CALLOUT_PLICHTIG)

    insertion = "\n".join(parts) + "\n"

    # insert before first occurrence of <div class="cta-box">
    target = '<div class="cta-box">'
    if target not in content:
        print(f"  WARN (no cta-box): {filename}")
        return False

    new_content = content.replace(target, insertion + target, 1)

    with open(path, "w", encoding="utf-8") as f:
        f.write(new_content)

    labels = []
    if insert_deadline:
        labels.append("deadline")
    if insert_plichtig:
        labels.append("plichtig")
    print(f"  OK [{', '.join(labels)}]: {filename}")
    return True


updated = []
print("=== BTW Deadlinekalender only ===")
for f in DEADLINE_ONLY:
    if update_file(f, insert_deadline=True, insert_plichtig=False):
        updated.append(f)

print("\n=== BTW-plichtig checker only ===")
for f in PLICHTIG_ONLY:
    if update_file(f, insert_deadline=False, insert_plichtig=True):
        updated.append(f)

print("\n=== Both callouts ===")
for f in BOTH:
    if update_file(f, insert_deadline=True, insert_plichtig=True):
        updated.append(f)

print(f"\nDone. Updated {len(updated)} files.")
