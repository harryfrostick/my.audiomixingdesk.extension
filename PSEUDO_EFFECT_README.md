# MDKit Tag Pseudo Effect Setup

## Overview

This repository includes a custom **Pseudo Effect** called **MDKit Tag** that provides a dropdown menu control with four tagging options:
- 1 = Overlay
- 2 = VO
- 3 = SFX
- 4 = Music

The pseudo effect is used by the Audio Mixing Desk extension to tag audio layers in After Effects compositions.

## Files Included

### 1. **pseudo-effect-data.js**
Contains the binary definition of the MDKit Tag pseudo effect. This file includes:
- Effect name: "MDKit Tag"
- Internal matchName: "Pseudo/MDK-Tag"
- Menu items: Overlay, VO, SFX, Music
- Default value: 1 (Overlay)

### 2. **mdk-tag.ffx**
Animation preset file (.ffx) that contains the complete MDKit Tag effect configuration. This is a backup/alternative way to apply the effect if the pseudo effect is not available.

### 3. **hostscript.jsx**
ExtendScript code that applies the MDKit Tag pseudo effect to selected layers. The key function is:

```javascript
fx.addProperty('Pseudo/MDK-Tag');
```

This creates the effect using the pseudo effect definition.

## How It Works

### In ExtendScript (After Effects Script)

```javascript
// Add the pseudo effect to a layer
var tagEffect = fx.addProperty('Pseudo/MDK-Tag');

// Set the menu value (1-4)
tagEffect.property(1).setValue(4); // Sets to "Music"
```

### In the Extension UI

The user clicks one of the tag buttons (Music, VO, SFX) in the extension panel, which sends the corresponding index (4, 2, 3) to the host script, which then applies and configures the pseudo effect.

## Why Pseudo Effect?

The pseudo effect approach was chosen because:

1. **Reliability** — AE creates the effect with all properties pre-configured
2. **No manipulation required** — the effect name, items, and structure are already correct
3. **Stale reference prevention** — no property manipulation means no broken references
4. **Cleaner code** — single line to create the effect vs. multi-step construction with potential failure points

## Installation / Setup

### For Development

1. Ensure `hostscript.jsx` uses the correct matchName:
   ```javascript
   var tagEffect = fx.addProperty('Pseudo/MDK-Tag');
   ```

2. The pseudo effect is registered within After Effects, so it will be available immediately.

### For Production / Distribution

Include both files in your extension package:
- `pseudo-effect-data.js` — for reference and backup
- `mdk-tag.ffx` — optional preset for manual application
- `hostscript.jsx` — the main script that applies the effect

### If Pseudo Effect is Unavailable

If the pseudo effect is not recognized by AE, fallback to the `.ffx` preset:

```javascript
var presetPath = new File(Folder.userData.fullName + '/Adobe/After Effects/Presets/Utility/mdk-tag.ffx');
layer.applyPreset(presetPath);
```

## File Structure for Repository

```
/extension
  /hostscript
    hostscript.jsx
  /presets
    mdk-tag.ffx
  /docs
    PSEUDO_EFFECT_README.md
  /data
    pseudo-effect-data.js
```

## Testing

To verify the pseudo effect works:

1. Open After Effects
2. Create a composition with a layer
3. In the ExtendScript console, run:
   ```javascript
   var fx = app.project.activeItem.selectedLayers[0].property('Effects');
   var effect = fx.addProperty('Pseudo/MDK-Tag');
   effect.name; // Should return "MDKit Tag"
   effect.property(1).value; // Should return 1
   ```

## Notes

- The pseudo effect matchName is `"Pseudo/MDK-Tag"` — this is what AE uses internally
- The display name is `"MDKit Tag"` — this is what appears in the Effects panel
- Menu indices are 1-based: 1, 2, 3, 4 (not 0-based)
- The pseudo effect is read-only after creation — you can only change the menu value
