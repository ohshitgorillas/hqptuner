---
status: testing
phase: 6
fields_version: 1
started: 2026-11-12
updated: 2026-11-12
---

## Items

### 1. Every enumerated aclean filter has a filter-data entry
expected: Each aclean filter name the running engine enumerates (GET /api/enumerations) joins by name to an entry in hqptuner/data/filters.json
status: pass
first_pass: pass
source: verifier
evidence: Live GET /api/enumerations lists poly-sinc-aclean-gauss/-ext2/-xtr (filters[56..58]). Each carries a `static` block joined from filters.json. scripts/gates/check_metadata.py (production join over filters_pcm and filters_sdm) exit=0.

### 2. aclean entries carry v1's description and simplified name
expected: The three aclean entries in filters.json and filter-plain-names.json match v1 at 316d72c5 verbatim: description, genre, quality, focus, phase and simplified name
status: pass
first_pass: pass
source: verifier
evidence: The three filters.json entries are dict-equal to 316d72c5's, in the same key order. filter-plain-names.json is byte-identical to 316d72c5's. Live GET /api/metadata serves all three plain-name entries.

### 3. Engine enumeration capture is the 6.2.0 capture
expected: hqptuner/data/engine-enums.json matches v1's 6.2.0 capture and lists the three aclean filters in filters_pcm and filters_sdm
status: pass
first_pass: pass
source: verifier
evidence: hqptuner/data/engine-enums.json is byte-identical to 316d72c5's (engine 6.2.0, captured 2026-11-03). Aclean names at filters_pcm[45..47] and filters_sdm[56..58].

## Summary

total: 3
passed: 3
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 0
