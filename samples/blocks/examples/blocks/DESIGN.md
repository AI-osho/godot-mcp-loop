# Falling Blocks — sample design

This sample is kept small to teach seeded state, board values and scoring assertions. SRS-style rotation and wall kicks, a ghost piece, seeded order, levels and scoring.

The renewal deliberately preserves game logic and assets so delivery/usability changes can be compared independently
from game-rule changes. The standalone wrapper keeps res://examples/blocks/ rather than rewriting scripts and fixtures.
It selects only this game's explicit input actions and omits MCP autoload/plugin wiring, allowing ordinary play first.
The source remains examples/blocks; generated deliveries are not another editable authority.

Run controlled scenarios separately from ordinary player-input checks. A clean cold boot does not establish a full
route, a screenshot does not establish input/audio, and automated checks cannot supply human taste judgement.
