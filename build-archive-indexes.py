#!/usr/bin/env python3
"""Build compact static archive indexes for tags, categories, and post formats.

Run this from anywhere:
    python3 build-archive-indexes.py [--directory EXPORT_DIR]

The source is the exported data-mounth-*.json files. Generated archive records
contain only navigation metadata (id, title, date, url, month), never excerpts,
HTML, summaries, or post text.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import html as html_lib
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

RECORD_FIELDS = ("id", "title", "date", "url", "month")
DEFAULT_POSTS_PER_SEGMENT = 250
DEFAULT_TAGS_PER_FILE = 100
FORMAT_LABELS = {
    "standard": "Padrão",
    "aside": "Nota",
    "quote": "Citação",
    "link": "Link",
    "audio": "Áudio",
    "video": "Vídeo",
    "image": "Imagem",
    "gallery": "Galeria",
    "chat": "Chat",
}


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    temporary.replace(path)


def term_parts(value: Any) -> tuple[str, str] | None:
    """Return (slug, display name) for a WP taxonomy item."""
    if isinstance(value, dict):
        slug = str(value.get("slug") or "").strip()
        name = str(value.get("name") or slug).strip()
    elif isinstance(value, str):
        slug = value.strip()
        name = slug
    else:
        return None
    if not slug:
        return None
    return slug, name or slug


def post_date(post: dict[str, Any]) -> str:
    value = str(post.get("dateYmd") or post.get("date") or "")
    return value[:10]


def normalize_post_format(post: dict[str, Any]) -> bool:
    """Restore the format badge when the upstream exporter omitted it.

    The source theme/exporter omits the post-format block for WordPress'
    default (standard) format, even though the exported post is classified
    as format-standard. The static archive uses the same badge for every
    format, so restore the missing link in the exported article HTML. This is
    deliberately idempotent and never changes the article body.
    """
    changed = False
    slug = str(post.get("format") or "standard").strip().lower() or "standard"
    if post.get("format") != slug:
        post["format"] = slug
        changed = True

    label = str(post.get("formatLabel") or FORMAT_LABELS.get(
        slug, slug.replace("-", " ").title()
    )).strip()
    if not post.get("formatLabel"):
        post["formatLabel"] = label
        changed = True

    article_html = post.get("html")
    if not isinstance(article_html, str) or not article_html:
        return changed

    # Existing non-standard format badges must be preserved as-is.
    if re.search(r'class\s*=\s*["\'][^"\']*\bpost-format\b', article_html, re.I):
        return changed

    badge = (
        '<span class="post-format"><a class="entry-format" href="type.html#'
        + html_lib.escape(slug, quote=True)
        + '">' + html_lib.escape(label) + '</a></span> '
    )
    # Insert immediately before the date, inside the same entry-meta block.
    updated, count = re.subn(
        r'(?=<span\b[^>]*class\s*=\s*["\'][^"\']*\bentry-date\b[^"\']*["\'][^>]*>)',
        lambda _match: badge,
        article_html,
        count=1,
        flags=re.I,
    )
    if count:
        post["html"] = updated
        changed = True
    return changed


def normalize_month_chunks(root: Path) -> tuple[int, int]:
    """Normalize post-format labels/markup in the full monthly export chunks."""
    changed_posts = 0
    changed_files = 0
    for path in sorted(root.glob("data-mounth-*.json")):
        payload = read_json(path)
        posts = payload.get("posts", []) if isinstance(payload, dict) else []
        if not isinstance(posts, list):
            continue
        file_changed = False
        for post in posts:
            if isinstance(post, dict) and normalize_post_format(post):
                changed_posts += 1
                file_changed = True
        if file_changed:
            temporary = path.with_name(path.name + ".tmp")
            with temporary.open("w", encoding="utf-8", newline="\n") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=4)
                handle.write("\n")
            temporary.replace(path)
            changed_files += 1
    return changed_posts, changed_files


def normalize_embedded_first_chunk(root: Path) -> bool:
    """Keep index.html's embedded first chunk in sync with monthly JSON."""
    path = root / "index.html"
    if not path.is_file():
        return False
    source = path.read_text(encoding="utf-8")
    marker = "window.WPX_FIRST_CHUNK="
    start = source.find(marker)
    if start < 0:
        return False
    json_start = start + len(marker)
    end = source.find(";</script>", json_start)
    if end < 0:
        return False
    try:
        payload = json.loads(source[json_start:end])
    except json.JSONDecodeError:
        print("Warning: could not parse index.html's embedded first chunk; left unchanged", file=sys.stderr)
        return False
    posts = payload.get("posts", []) if isinstance(payload, dict) else []
    if not isinstance(posts, list):
        return False
    changed = False
    for post in posts:
        if isinstance(post, dict) and normalize_post_format(post):
            changed = True
    if not changed:
        return False
    encoded = json.dumps(payload, ensure_ascii=False, indent=4)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(source[:json_start] + encoded + source[end:], encoding="utf-8", newline="\n")
    temporary.replace(path)
    return True


def compact_record(post: dict[str, Any]) -> dict[str, Any] | None:
    post_id = post.get("id")
    title = post.get("title")
    url = post.get("url")
    date = post_date(post)
    if post_id is None or not title or not url or not date:
        return None
    return {
        "id": post_id,
        "title": str(title),
        "date": date,
        "url": str(url),
        "month": date[:7],
    }


def slug_file_part(slug: str) -> str:
    # WordPress slugs are normally URL-safe. Keep filenames safe even if a
    # custom taxonomy supplied an unusual slug.
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", slug).strip(".-_")
    return safe or "term"


def sort_posts(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(posts, key=lambda item: (item.get("date", ""), int(item.get("id", 0))), reverse=True)


def split_every(items: list[Any], count: int):
    for start in range(0, len(items), count):
        yield items[start:start + count]


def load_posts(root: Path) -> list[dict[str, Any]]:
    files = sorted(root.glob("data-mounth-*.json"), reverse=True)
    if not files:
        raise RuntimeError(f"No data-mounth-*.json files found in {root}")

    by_id: dict[str, dict[str, Any]] = {}
    for path in files:
        payload = read_json(path)
        posts = payload.get("posts", []) if isinstance(payload, dict) else []
        if not isinstance(posts, list):
            print(f"Warning: {path.name} has no posts array; skipping", file=sys.stderr)
            continue
        for post in posts:
            if not isinstance(post, dict):
                continue
            record = compact_record(post)
            if record is None:
                continue
            key = str(record["id"])
            # If an ID appears in more than one month chunk, keep the version
            # with the newest source date rather than duplicating it.
            previous = by_id.get(key)
            if previous is None or record["date"] > previous["date"]:
                by_id[key] = {
                    "record": record,
                    "tags": post.get("tags") or [],
                    "cats": post.get("cats") or [],
                    "format": post.get("format") or "standard",
                    "formatLabel": post.get("formatLabel") or "",
                }

    if not by_id:
        raise RuntimeError(f"No usable posts found in monthly chunks under {root}")

    posts = list(by_id.values())
    posts.sort(key=lambda item: (item["record"]["date"], int(item["record"]["id"])), reverse=True)
    return posts


def collect_terms(posts: list[dict[str, Any]]):
    tags: dict[str, dict[str, Any]] = {}
    categories: dict[str, dict[str, Any]] = {}
    formats: dict[str, dict[str, Any]] = {}

    def add(table: dict[str, dict[str, Any]], parts: tuple[str, str], record: dict[str, Any]):
        slug, name = parts
        entry = table.setdefault(slug, {"name": name, "posts": []})
        if not entry["name"] and name:
            entry["name"] = name
        entry["posts"].append(record)

    for item in posts:
        record = item["record"]
        for term in item["tags"]:
            parts = term_parts(term)
            if parts:
                add(tags, parts, record)
        for term in item["cats"]:
            parts = term_parts(term)
            if parts:
                add(categories, parts, record)

        slug = str(item["format"] or "standard").strip().lower() or "standard"
        name = str(item["formatLabel"] or FORMAT_LABELS.get(slug, slug.replace("-", " ").title())).strip()
        add(formats, (slug, name), record)

    for table in (tags, categories, formats):
        for entry in table.values():
            entry["posts"] = sort_posts(entry["posts"])
    return tags, categories, formats


def update_legacy_combined_index(
    root: Path,
    posts: list[dict[str, Any]],
    formats: dict[str, dict[str, Any]],
) -> bool:
    """Keep the one-file tag_categories.json lookup complete and compact.

    Older parts of the static export still advertise this file. It already
    stores only post titles and navigation metadata, but historically encoded
    the default format as an empty string and omitted it from the formats map.
    """
    path = root / "tag_categories.json"
    if not path.is_file():
        return False
    payload = read_json(path)
    if not isinstance(payload, dict):
        print("Warning: tag_categories.json is not an object; left unchanged", file=sys.stderr)
        return False

    changed = False
    format_names = payload.setdefault("formats", {})
    if not isinstance(format_names, dict):
        format_names = {}
        payload["formats"] = format_names
        changed = True
    for slug, entry in formats.items():
        name = entry.get("name") or FORMAT_LABELS.get(slug, slug)
        if format_names.get(slug) != name:
            format_names[slug] = name
            changed = True

    format_by_id = {str(item["record"]["id"]): str(item["format"] or "standard") for item in posts}
    combined_posts = payload.get("posts", [])
    if isinstance(combined_posts, list):
        for record in combined_posts:
            if not isinstance(record, dict):
                continue
            post_id = str(record.get("id", ""))
            expected = format_by_id.get(post_id, str(record.get("format") or "standard"))
            if record.get("format") != expected:
                record["format"] = expected
                changed = True

    if changed:
        write_json(path, payload)
    return changed


def old_generated_files(root: Path) -> set[str]:
    """Collect old generated segment names so removed terms don't leave stale files."""
    stale: set[str] = set()
    for manifest_name in ("category-manifest.json", "tag-manifest.json", "format-manifest.json", "archive-index-manifest.json"):
        path = root / manifest_name
        if not path.exists():
            continue
        try:
            manifest = read_json(path)
        except Exception:
            continue
        for definition in (manifest.get("types") or {}).values():
            stale.update(str(name) for name in definition.get("files", []))
        for definition in (manifest.get("terms") or {}).values():
            stale.update(str(name) for name in definition.get("files", []))
        for taxonomy in (manifest.get("taxonomies") or {}).values():
            for definition in (taxonomy.get("terms") or {}).values():
                stale.update(str(name) for name in definition.get("files", []))
    return stale


def build_category_files(root: Path, categories: dict[str, dict[str, Any]], posts_per_segment: int):
    manifest_types: dict[str, Any] = {}
    master_terms: dict[str, Any] = {}
    generated: set[str] = set()

    for slug in sorted(categories, key=lambda s: (categories[s]["name"].casefold(), s)):
        entry = categories[slug]
        segments = list(split_every(entry["posts"], posts_per_segment))
        files: list[str] = []
        for number, records in enumerate(segments, 1):
            filename = f"data-category-{slug_file_part(slug)}-{number:02d}.json"
            files.append(filename)
            generated.add(filename)
            write_json(root / filename, {
                "type": slug,
                "segment": number,
                "cats": {slug: entry["name"]},
                "posts": {slug: records},
            })
        # categories.html expects this legacy schema. Keep it unchanged while
        # sharing the exact same compact records as the new tag/format indexes.
        manifest_types[slug] = {"files": files, "cats": {slug: entry["name"]}}
        master_terms[slug] = {
            "name": entry["name"],
            "files": files,
            "count": len(entry["posts"]),
        }

    write_json(root / "category-manifest.json", {"version": 1, "types": manifest_types})
    return master_terms, generated


def build_tag_files(root: Path, tags: dict[str, dict[str, Any]], terms_per_file: int):
    terms = sorted(tags, key=lambda s: (tags[s]["name"].casefold(), s))
    manifest_terms: dict[str, Any] = {}
    generated: set[str] = set()

    for group_number, group in enumerate(split_every(terms, terms_per_file), 1):
        filename = f"data-tag-{group_number:03d}.json"
        payload_terms: dict[str, str] = {}
        payload_posts: dict[str, list[dict[str, Any]]] = {}
        for slug in group:
            entry = tags[slug]
            payload_terms[slug] = entry["name"]
            payload_posts[slug] = entry["posts"]
            manifest_terms[slug] = {
                "name": entry["name"],
                "files": [filename],
                "count": len(entry["posts"]),
            }
        write_json(root / filename, {
            "taxonomy": "tags",
            "segment": group_number,
            "terms": payload_terms,
            "posts": payload_posts,
        })
        generated.add(filename)

    return manifest_terms, generated


def build_format_files(root: Path, formats: dict[str, dict[str, Any]], posts_per_segment: int):
    manifest_terms: dict[str, Any] = {}
    generated: set[str] = set()

    for slug in sorted(formats, key=lambda s: (formats[s]["name"].casefold(), s)):
        entry = formats[slug]
        files: list[str] = []
        for number, records in enumerate(split_every(entry["posts"], posts_per_segment), 1):
            filename = f"data-format-{slug_file_part(slug)}-{number:02d}.json"
            files.append(filename)
            generated.add(filename)
            write_json(root / filename, {
                "taxonomy": "formats",
                "format": slug,
                "segment": number,
                "terms": {slug: entry["name"]},
                "posts": {slug: records},
            })
        manifest_terms[slug] = {
            "name": entry["name"],
            "files": files,
            "count": len(entry["posts"]),
        }

    return manifest_terms, generated


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", "-d", type=Path, default=Path(__file__).resolve().parent,
                        help="static export directory containing data-mounth-*.json")
    parser.add_argument("--posts-per-segment", type=int, default=DEFAULT_POSTS_PER_SEGMENT,
                        help=f"maximum posts per category/format JSON (default: {DEFAULT_POSTS_PER_SEGMENT})")
    parser.add_argument("--tags-per-file", type=int, default=DEFAULT_TAGS_PER_FILE,
                        help=f"number of tag terms grouped into each tag JSON (default: {DEFAULT_TAGS_PER_FILE})")
    args = parser.parse_args()

    if args.posts_per_segment < 1 or args.tags_per_file < 1:
        parser.error("segment and group sizes must be at least 1")

    root = args.directory.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"not a directory: {root}")

    old_files = old_generated_files(root)
    normalized_posts, normalized_files = normalize_month_chunks(root)
    embedded_chunk_updated = normalize_embedded_first_chunk(root)
    posts = load_posts(root)
    tags, categories, formats = collect_terms(posts)

    category_terms, category_files = build_category_files(root, categories, args.posts_per_segment)
    tag_terms, tag_files = build_tag_files(root, tags, args.tags_per_file)
    format_terms, format_files = build_format_files(root, formats, args.posts_per_segment)
    combined_lookup_updated = update_legacy_combined_index(root, posts, formats)

    # A single compact master manifest joins the three taxonomies. The data
    # files it references contain navigation metadata only, never post text.
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    master = {
        "version": 1,
        "generatedAt": generated_at,
        "recordFields": list(RECORD_FIELDS),
        "taxonomies": {
            "tags": {"terms": tag_terms},
            "categories": {"manifest": "category-manifest.json", "terms": category_terms},
            "formats": {"terms": format_terms},
        },
    }
    write_json(root / "archive-index-manifest.json", master)
    # The master manifest replaces the separate tag/format manifests.
    for obsolete_manifest in ("tag-manifest.json", "format-manifest.json"):
        obsolete_path = root / obsolete_manifest
        if obsolete_path.exists():
            obsolete_path.unlink()

    new_files = category_files | tag_files | format_files
    for filename in old_files - new_files:
        candidate = root / filename
        # Only remove files matching the generated index naming patterns.
        if candidate.is_file() and re.match(r"^data-(?:category|tag|format)-[A-Za-z0-9._-]+\.json$", filename):
            candidate.unlink()

    total_bytes = sum((root / name).stat().st_size for name in new_files if (root / name).exists())
    print(f"Indexed {len(posts):,} posts")
    print(
        f"Format markup: normalized {normalized_posts:,} monthly post records "
        f"in {normalized_files:,} files"
        + ("; index.html first chunk updated" if embedded_chunk_updated else "")
    )
    print(f"Tags: {len(tag_terms):,} terms across {len(tag_files):,} JSON files")
    print(f"Categories: {len(category_terms):,} terms across {len(category_files):,} JSON files")
    print(f"Formats: {len(format_terms):,} terms across {len(format_files):,} JSON files")
    if combined_lookup_updated:
        print("Combined lookup: tag_categories.json updated (standard format included)")
    print(f"Combined data files: {total_bytes:,} bytes (titles and navigation metadata only)")
    print(f"Master manifest: {root / 'archive-index-manifest.json'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1)
