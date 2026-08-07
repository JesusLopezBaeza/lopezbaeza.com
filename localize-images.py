#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Download every image the site currently loads from Wix, and rewrite the pages
to use local copies instead.

WHY YOU NEED THIS
-----------------
Right now the pages point at Wix's image servers (static.wixstatic.com). That
means the site works immediately — but if you close your Wix account, those
images disappear and your site breaks. Run this once and the images live in
your own folder forever.

HOW TO RUN IT (macOS)
---------------------
1. Open the Terminal app.
2. Type  cd   then a space, then drag this "site" folder onto the window, then Enter.
3. Type   python3 localize-images.py   and press Enter.
4. Wait. It prints a line per image.

Then deploy the folder as normal. Safe to run twice — it skips what it has.
"""

import os, re, sys, hashlib, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
IMGDIR = os.path.join(HERE, "assets", "img")
PATTERN = re.compile(
    r'https://static\.wixstatic\.com/media/[^"\'\s)]+'          # old Wix media
    r'|https://spinunit\.org/web/assets/img/[^"\'\s)]+'         # SPIN Unit project covers
)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}


def original(url):
    """Strip Wix's on-the-fly resize so we download the full-resolution file."""
    return url.split("/v1/")[0]


def local_name(url):
    if "spinunit.org" in url:
        # .../assets/img/2024-tartu-parking-study/00.jpg -> 2024-tartu-parking-study-00.jpg
        parts = url.rstrip("/").split("/")
        return f"{parts[-2]}-{parts[-1]}"
    base = urllib.parse.unquote(original(url).rsplit("/", 1)[-1])
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, "jpg"
    ext = ext.lower().split("?")[0]
    if ext not in ("jpg", "jpeg", "png", "gif", "webp", "avif"):
        ext = "jpg"
    digest = hashlib.md5(original(url).encode()).hexdigest()[:8]
    clean = re.sub(r"[^A-Za-z0-9]+", "-", stem).strip("-").lower()[:48] or "img"
    return f"{clean}-{digest}.{ext}"


def main():
    pages = [f for f in os.listdir(HERE) if f.endswith(".html")]
    if not pages:
        sys.exit("No .html files here — run this from inside the site folder.")

    os.makedirs(IMGDIR, exist_ok=True)

    urls = set()
    for p in pages:
        with open(os.path.join(HERE, p), encoding="utf-8") as f:
            urls.update(PATTERN.findall(f.read()))

    print(f"{len(urls)} images referenced across {len(pages)} pages.\n")

    mapping, failed = {}, []
    for i, url in enumerate(sorted(urls), 1):
        name = local_name(url)
        dest = os.path.join(IMGDIR, name)
        rel = f"assets/img/{name}"
        mapping[url] = rel
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            print(f"[{i:3d}/{len(urls)}] have  {name}")
            continue
        try:
            req = urllib.request.Request(original(url), headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
                out.write(r.read())
            kb = os.path.getsize(dest) // 1024
            print(f"[{i:3d}/{len(urls)}] saved {name}  ({kb} KB)")
        except Exception as exc:
            print(f"[{i:3d}/{len(urls)}] FAIL  {name}  — {exc}")
            failed.append(url)
            mapping.pop(url, None)

    changed = 0
    for p in pages:
        path = os.path.join(HERE, p)
        with open(path, encoding="utf-8") as f:
            text = original_text = f.read()
        for url, rel in mapping.items():
            text = text.replace(url, rel)
        if text != original_text:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            changed += 1

    # Record the swap where build.py can find it. Without this the next rebuild
    # would regenerate the pages from the Python sources, which still contain
    # the Wix URLs, and quietly undo everything this script just did.
    note = os.path.join(HERE, "..", "build", "localized.json")
    if os.path.isdir(os.path.dirname(note)):
        import json
        existing = {}
        if os.path.exists(note):
            try:
                with open(note, encoding="utf-8") as f:
                    existing = json.load(f)
            except ValueError:
                pass
        existing.update(mapping)
        with open(note, "w", encoding="utf-8") as f:
            json.dump(existing, f, indent=2, ensure_ascii=False, sort_keys=True)
        print(f"Recorded {len(existing)} swaps in build/localized.json — "
              "rebuilds will keep using the local copies.")

    print(f"\nDone. {len(mapping)} images local, {changed} pages rewritten.")
    if failed:
        print(f"\n{len(failed)} could not be downloaded and still point at Wix:")
        for u in failed:
            print("  " + u)
        print("\nDownload these by hand from your Wix Media Manager, drop them in "
              "assets/img/, and edit the page to point at them.")


if __name__ == "__main__":
    main()
