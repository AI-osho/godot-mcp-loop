# Tower Defense — promotion and delivery changes

This is a new formal sample, promoted from the independently exercised original game, not a redesign of the legacy six.
Public 0.11.0 does not include this sample or node_add_tree; 0.12.0 includes both.

Kept: original game rules, actors, map, two tower roles, three waves, PNG/WAV assets and ordinary mouse flow.
Changed for delivery: no preinstalled addon/autoload, portable sample-specific user-directory setting, editable asset
source output path, English technical documentation/Japanese play guide, and three validated construction plans.
The title plan includes the original author's later node_set control-text correction so replay matches the final scene.
The sample configures both physical 960×640 and logical 960×640 canvas size; integrating it into the repository's
1152×648 default project no longer scales mouse positions against a different logical canvas.

samples/tower-defense is the authority; examples/tower-defense is generated with prefixed resource references.
The integrated copy regenerates imports and uses path-only texture references instead of stale standalone import UIDs.
Valid script UIDs and the standalone scene/asset bytes are preserved by that relocation.
Generated import caches/private SDK harnesses/raw execution evidence are not sample source. Repeat cold import and
normal input checks on the selected package rather than treating the original creator's result as proof of the new delivery.
