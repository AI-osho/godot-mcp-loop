> Generated repository copy. Edit samples/tower-defense, then run scripts/sync-samples.mjs.

# Original artwork and sound provenance

The original author created the game's 9 PNGs and 8 WAV effects using authored pixel coordinates, a 23-color named
palette, Pillow 13.0.0 and Python's standard wave/struct/math tools. Two deliberate exceptions to the named palette:
the runner's shading color #665b82, and antialiased edge tones in the board's A–H pad letters, which are drawn with
Pillow's bundled default font (Aileron). No franchise images, asset-store art, image-generation
API, sampled audio or existing soundtrack was used. These are separately authored assets, not artwork-tool generation proof.

Editable originals: art/generate_assets.py and art/palette.json. Runtime files and dimensions/frame metadata are in
assets/ and assets/manifest.json. Optional regeneration: python3 art/generate_assets.py in a developer environment
with Pillow 13.0.0. Normal play has no Python dependency. Regeneration writes this sample's assets/ only.

PNG roles: board 360×260, title_vista 480×320, seedhouse 40×46; amber_tower/mist_tower 84×36 (3 frames),
beetle/runner/heavy 64×20 (4 frames), icons 48×16. Pixel art is normally displayed at 2× with nearest filtering.
Japanese UI uses Godot/system fallback fonts; OS font files are not copied or redistributed.

WAVs: place, shot, mist, kill, base_hit, victory, defeat, click; mono 16-bit 22050 Hz synthesized tones/envelopes/sweeps.
The game plays them through a 12-voice pool at -10 dB. There is no BGM and no imported music sample.
The diagnostic recorder observes actual Master-bus PCM only when explicitly called; ordinary play does not record.
PCM evidence does not certify speakers, listening preference, image-model identity or commercial-rights approval.

MIT © OSHO, with LICENSE included. The Godot engine and optional MCP addon/SDK are separate dependencies and did not
automatically generate this game's rules or artwork. No credentials or private harness/evidence are part of this sample.
