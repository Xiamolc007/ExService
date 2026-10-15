# Maple Mono CN for Tiptap CodeBlock

The Website serves Maple Mono CN Regular v7.9 as local WOFF2 assets. Its scope is block and inline `code` in the shared Tiptap editing/viewing stylesheet; body text, toolbar labels and ExUI's global mono token keep their existing fonts. Both code forms retain their existing relative font size.

Source: [the official v7.9 release](https://github.com/subframe7536/maple-font/releases/tag/v7.9), `MapleMono-CN-unhinted.zip`, `MapleMono-CN-Regular.ttf`. Copyright and SIL OFL 1.1 are retained in `LICENSE.txt`. Source and generated-file SHA256 values are recorded in `manifest.json`.

The regular face is split into non-overlapping 512-codepoint Unicode windows. `font.scss` supplies each slice's actual `unicode-range`; the browser fetches only slices required by displayed code. `font-display: swap` allows the existing monospace stack during loading. All 22,731 source codepoints and their advance widths are verified during generation. Font-family strings remain display-only and are not written into document JSON or Markdown.

To reproduce, download the pinned release archive and run `scripts/assets/build-maple-mono-font.py` with that archive as its argument in a Python environment containing `fonttools==4.60.1` and `brotli==1.2.0`. The generator checks both archive and Regular face hashes before writing assets. The Website runtime does not use Python or request external font hosts.
