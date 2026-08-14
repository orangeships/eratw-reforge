# importer/

Reserved for Phase 2+. Read-only parsers over `eratw-sub-modding-main/`.

Subtrees:
- `csv/`   — Train.csv / VariableSize.csv / CharaN.csv / _Rename.csv / etc.
- `erb/`   — DIM.ERH constants, ERB function index, kojo resolver, TRYCALLFORM graph.
- `xml/`   — resources/**/*.xml manifest, plugins/tw_*.xml dictionaries.
- `encoding/` — UTF-8 / UTF-8 BOM / CP932 / GB18030 auto-detection.
- `als/`   — Abl.als / CFLAG.als / TFLAG.als / Talent.als etc. (companion files to CSV/).

Phase 1 ships no code here. Phase 2.1 starts with `csv/` for variable sizes
and command catalog only.