# Bear app assets

- `bear/`: four individual bear PNG poses with transparency.
- `accessories/`: 22 independent PNG decorations/props with transparency.
- `manifest.json`: file paths and intrinsic pixel dimensions.

These are cropped from previously generated character and prop sheets. Sizes are tightly cropped; do not position accessories by identical pixel coordinates. Overlay each accessory as a separate image element on top of the bear with per-item CSS positions/scales. Some clothing and hats may need fine-tuning to fit exactly, because the original illustration sheet was not drawn as a pixel-registered costume system.

For the website, use an HTML container with `position: relative`, place the bear at `width:100%`, and put each chosen accessory at `position:absolute`. Set `pointer-events:none` on overlay images.
