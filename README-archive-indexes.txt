COMPACT ARCHIVE INDEX BUILDER
============================

Run this after the monthly JSON chunks have been exported:

    python3 build-archive-indexes.py

Or point it at another static export directory:

    python3 build-archive-indexes.py --directory /path/to/export

Optional sizing controls:

    python3 build-archive-indexes.py --posts-per-segment 250 --tags-per-file 100

The builder reads data-mounth-*.json and creates compact indexes for all three
WordPress archive taxonomies:

  - tags       -> data-tag-NNN.json
  - categories -> data-category-SLUG-NN.json
  - formats    -> data-format-SLUG-NN.json (aside, quote, link, audio, video,
                  standard, and any other formats present in the source data)

archive-index-manifest.json is the single combined manifest for tags,
categories, and formats. tag.html, categories.html, and type.html all load
this manifest and fetch only the segments for the selected term.
tag_categories.json is also refreshed as a single-file compact lookup
containing all tags, categories, formats, and post-title/navigation records.
category-manifest.json is retained as a small compatibility manifest for
older category-page templates; the current categories.html does not need it.

The builder also repairs an upstream export omission: standard posts already
have the format-standard article class and format metadata, but the exported
article HTML omitted the .post-format / .entry-format badge. The builder adds
a local type.html#standard link labelled “Padrão”, fills an empty formatLabel,
and updates index.html's embedded first chunk. This is idempotent and does not
change post body text.

Every generated archive post record contains only navigation metadata:

    id, title, date, url, month

No excerpt, summary, HTML, full content, or post body is copied into the tag,
category, or format index files or the compact combined lookup. Monthly chunks
remain the source of truth for the actual post content.
