{
 "findings": [
  {
   "file": "hqptuner/presets/presetlane.py",
   "line": 298,
   "severity": "medium",
   "claim": "The new PresetStore lock covers only the file write. Auto-save decides which preset to write by reading `store.active` (line 290) outside the lock and before an `await mgr.require_http().backup()`, so a preset delete that completes during that await is undone: the deleted preset comes back. This contradicts the rule the diff adds to docs/architecture.md: \"two writers to one store both land\".",
   "failure_scenario": "Auto-save is on and preset X is active. The user applies an edit: `with_autosave` calls `presetlane.autosave`, which reads active == X and then awaits the daemon's /backup. While it waits, the user clicks Delete on X. `DELETE /api/preset/X` runs outside `applyops.write_lock` (routes/preset.py:68-74 and line 58-59 for the profile route). It takes the store lock, unlinks X.xml, clears active.json, then forgets X's matrix mode and deletes the daemon mirror. The backup then returns and `store.save(X, working, trigger=\"autosave\")` takes the lock and writes X.xml again as a new file (overwrote=False). `_record_autopilot` writes X's auto-pilot entry back too. Result: the delete returned success, but X is in the picker again, has lost its matrix mode, has no daemon mirror and is not active. The delete's write is lost, even though every individual write held the lock."
  }
 ]
}