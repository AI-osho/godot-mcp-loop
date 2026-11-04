# Minimal Platformer — sample design

This sample is kept small to teach game_input, game_wait_for, game_query and scenario_run. A small movement fixture for edit, input and position assertions; not a campaign with a title or ending.

The renewal deliberately preserves game logic and assets so delivery/usability changes can be compared independently
from game-rule changes. The standalone wrapper keeps res://examples/platformer/ rather than rewriting scripts and fixtures.
It selects only this game's explicit input actions and omits MCP autoload/plugin wiring, allowing ordinary play first.
The source remains examples/platformer; generated deliveries are not another editable authority.

Run controlled scenarios separately from ordinary player-input checks. A clean cold boot does not establish a full
route, a screenshot does not establish input/audio, and automated checks cannot supply human taste judgement.
