# v4.4.1 timing policy invariants

1. Hard identity evidence (exact video hash) always wins over heuristic release-name scores.
2. Hard conflicts (season, episode, edition, year, FPS) are evaluated before source-family heuristics.
3. `minRankScore` is applied only after Accuracy-First ordering; strong timing evidence can rescue a low heuristic score.
4. Complete provider cycles replace the search pool; degraded cycles merge with the last good pool; failed cycles never poison it.
5. User-reported timing mismatches belong in the permanent regression corpus before future ranking changes.
