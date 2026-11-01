"""Small, explicit processing of generated character artwork; no artwork is redrawn here."""

import colorsys

from PIL import Image


def key_magenta_background(image, tolerance=120):
    """Return a copy with chroma-key pixels transparent, preserving costume RGB."""
    result = image.convert("RGBA")
    limit = tolerance * tolerance
    pixels = []
    for r, g, b, a in result.get_flattened_data():
        distance = (255 - r) ** 2 + g ** 2 + (255 - b) ** 2
        if distance <= limit:
            a = 0
        elif a:
            hue, saturation, value = colorsys.rgb_to_hsv(r, g, b)
            if 275 / 360 <= hue <= 325 / 360 and saturation >= 0.6 and value >= 55:
                a = 0
        pixels.append((r, g, b, a))
    result.putdata(pixels)
    return result


def fit_pose(image, frame_size=(128, 176), foot_anchor=(64, 170), target_height=156):
    """Nearest-scale a pose and align the visible boot band to a shared foot edge."""
    body = image.convert("RGBA").crop(image.getchannel("A").getbbox())
    width = max(1, round(body.width * target_height / body.height))
    body = body.resize((width, target_height), Image.Resampling.NEAREST)
    band_height = max(1, target_height // 10)
    band = body.getchannel("A").crop((0, target_height - band_height, width, target_height))
    foot_box = band.getbbox()
    center_x = (foot_box[0] + foot_box[2]) / 2
    left = round(foot_anchor[0] - center_x)
    top = foot_anchor[1] - target_height
    if left < 0 or top < 0 or left + width > frame_size[0] or top + target_height > frame_size[1]:
        raise ValueError("pose would be clipped by its frame")
    frame = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    frame.paste(body, (left, top))
    return frame


def keyed_crop(sheet, box):
    """Key an observed sheet region; require an empty border on all sides."""
    left, top, right, bottom = box
    if not (0 <= left < right <= sheet.width and 0 <= top < bottom <= sheet.height):
        raise ValueError("source crop outside image")
    selected = key_magenta_background(sheet.crop(box))
    bounds = selected.getchannel("A").getbbox()
    if not bounds or min(bounds[:2]) <= 0 or bounds[2] >= selected.width or bounds[3] >= selected.height:
        raise ValueError("source crop is empty or clips artwork")
    return selected


def fit_icon(image, frame_size=(96, 96), *, target_extent=72):
    """Fit an inventory icon to its largest visible dimension, not a foot anchor."""
    rgba = image.convert("RGBA")
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("empty icon artwork")
    width, height = bounds[2] - bounds[0], bounds[3] - bounds[1]
    return fit_scaled_frame(rgba, frame_size, min(target_extent / width, target_extent / height))


def fit_scaled_frame(image, frame_size, scale, *, foot_y=None):
    """Centre rigid art at a shared pixel scale, optionally on a shared foot row."""
    import math
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError("scale must be positive and finite")
    rgba = image.convert("RGBA")
    bounds = rgba.getchannel("A").getbbox()
    if bounds is None:
        raise ValueError("empty artwork")
    body = rgba.crop(bounds)
    width = max(1, round(body.width * scale))
    height = max(1, round(body.height * scale))
    left = (frame_size[0] - width) // 2
    top = foot_y - height if foot_y is not None else (frame_size[1] - height) // 2
    if left < 1 or top < 1 or left + width >= frame_size[0] or top + height >= frame_size[1]:
        raise ValueError("artwork would be clipped by frame")
    body = body.resize((width, height), Image.Resampling.NEAREST)
    frame = Image.new("RGBA", frame_size, (0, 0, 0, 0))
    frame.paste(body, (left, top))
    return frame
