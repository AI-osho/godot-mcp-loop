"""Equal-frame horizontal packing used by Koto and the station cargo robot."""
from PIL import Image


def horizontal_atlas(frames):
    frames = list(frames)
    if not frames:
        raise ValueError("atlas requires at least one frame")
    width, height = frames[0].size
    if any(frame.size != (width, height) for frame in frames):
        raise ValueError("atlas requires equal frame sizes")
    atlas = Image.new("RGBA", (width * len(frames), height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.paste(frame.convert("RGBA"), (index * width, 0))
    return atlas
