> Generated repository copy. Edit samples/tower-defense, then run scripts/sync-samples.mjs.

# 灯畑の番人 — fixed sample design

One original night garden, two tower roles and three fixed waves keep the construction lesson finite.
The 960×640 layout separates the 720×520 board from the top/right UI. Pads A–H constrain placement; hover shows range.
Lanterns prioritize the first enemy (cost 50, range 140, damage 16, period 0.60 s); mist bells slow an area
(cost 40, range 120, damage 3, period 1 s, radius 48, speed 45% for 1.6 s). Start with 140 coins and 8 base health.
Waves contain 6/8/10 enemies, with 25 preparation coins after the first two completions; no endless mode or upgrades.

The title, game and result structures are small enough for three bounded native node_add_tree requests (13/30/11).
UI input can be checked through actual Control mouse events, while rules are separately testable with native scripts.
Scenes remain saved ordinary Godot resources: the MCP server is not needed to play them.
Runtime actors, artwork and effects are authored code/assets, not a claim that the structural tool invents game rules.

Preserve the one-map/two-tower/three-wave model during promotion. Do not change damage, currency or enemies merely to
make a route pass. Check ordinary victories and unbuilt defeats, pause freezing, retry reset and normal quit separately.
The new sample's resource paths and viewport must also work in its generated repository copy; that is a portability check,
not permission to alter the repository's default main scene or other games' controls.

Artwork is deliberately original low-fi pixel construction with a fixed palette, nearest filtering and amber/cyan role contrast.
Eight synthesized effects give placement/combat/result feedback; no soundtrack is included. Technical tests do not establish
commercial-era art quality or human listening/play preference. Existing creator/evidence directories remain untouched.
