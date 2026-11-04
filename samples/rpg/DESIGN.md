# Luka of the Star Sword — sample design

This sample is kept small to teach dialogue/battle state transitions; deterministic test conditions are separate from normal progression. An original Japanese story with title/prologue, grid movement, dialogue, front-view battles, a boss and an ending.

The renewal deliberately preserves game logic and assets so delivery/usability changes can be compared independently
from game-rule changes. The standalone wrapper keeps res://examples/rpg/ rather than rewriting scripts and fixtures.
It selects only this game's explicit input actions and omits MCP autoload/plugin wiring, allowing ordinary play first.
The source remains examples/rpg; generated deliveries are not another editable authority.

Run controlled scenarios separately from ordinary player-input checks. A clean cold boot does not establish a full
route, a screenshot does not establish input/audio, and automated checks cannot supply human taste judgement.
