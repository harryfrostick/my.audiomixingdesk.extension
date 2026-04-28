# MDKit Tag Integration Guide

## Quick Start

To apply the MDKit Tag pseudo effect to a layer in After Effects:

```javascript
var layer = app.project.activeItem.selectedLayers[0];
var fx = layer.property('Effects');
var tagEffect = fx.addProperty('Pseudo/MDK-Tag');
tagEffect.property(1).setValue(4); // Set to "Music" (index 4)
```

## Step-by-Step Integration

### 1. Prepare the Layer
```javascript
var comp = app.project.activeItem;
var layer = comp.selectedLayers[0];
```

### 2. Get Effects Property
```javascript
var fx = layer.property('Effects');
if (!fx) {
    alert('Layer has no Effects property');
    return;
}
```

### 3. Remove Existing MDKit Tag (Optional)
```javascript
var existing = fx.property('MDKit Tag');
if (existing) {
    existing.remove();
}
```

### 4. Add the Pseudo Effect
```javascript
var tagEffect = fx.addProperty('Pseudo/MDK-Tag');
if (!tagEffect) {
    alert('Could not add MDKit Tag effect');
    return;
}
```

### 5. Set the Tag Value
```javascript
var menuProp = tagEffect.property(1); // Property 1 is the menu
menuProp.setValue(idx); // idx = 1, 2, 3, or 4
```

## Complete Example Function

```javascript
function applyMDKitTag(layer, tagIndex) {
    try {
        // Validate input
        if (!layer || tagIndex < 1 || tagIndex > 4) {
            return { ok: false, message: 'Invalid parameters' };
        }

        // Get effects
        var fx = layer.property('Effects');
        if (!fx) {
            return { ok: false, message: 'Layer has no Effects' };
        }

        // Remove existing
        var existing = fx.property('MDKit Tag');
        if (existing) existing.remove();

        // Add pseudo effect
        var tagEffect = fx.addProperty('Pseudo/MDK-Tag');
        if (!tagEffect) {
            return { ok: false, message: 'Could not add effect' };
        }

        // Set value
        tagEffect.property(1).setValue(tagIndex);

        var tagNames = { 1: 'Overlay', 2: 'VO', 3: 'SFX', 4: 'Music' };
        return {
            ok: true,
            message: 'Tagged as ' + tagNames[tagIndex]
        };

    } catch (e) {
        return { ok: false, message: e.toString() };
    }
}
```

## Tag Index Reference

| Index | Tag Name |
|-------|----------|
| 1 | Overlay |
| 2 | VO |
| 3 | SFX |
| 4 | Music |

## Debugging

### Check if Effect Was Applied
```javascript
var tagEffect = fx.property('MDKit Tag');
if (!tagEffect) {
    alert('MDKit Tag effect not found');
} else {
    alert('MDKit Tag found, value: ' + tagEffect.property(1).value);
}
```

### Verify Pseudo Effect Registration
```javascript
try {
    var testFx = fx.addProperty('Pseudo/MDK-Tag');
    if (testFx) {
        alert('Pseudo effect is registered');
        testFx.remove();
    } else {
        alert('Pseudo effect not found');
    }
} catch (e) {
    alert('Error: ' + e.message);
}
```

## Fallback: Using the FFX Preset

If the pseudo effect is not available, you can apply the `.ffx` preset instead:

```javascript
var presetPath = new File(Folder.userData.fullName + '/Adobe/After Effects/Presets/Utility/mdk-tag.ffx');

if (presetPath.exists) {
    layer.applyPreset(presetPath);
    var tagEffect = fx.property('MDKit Tag');
    tagEffect.property(1).setValue(tagIndex);
} else {
    alert('Preset file not found at: ' + presetPath.fsName);
}
```

## Notes

- The pseudo effect is **matchName-based**, not display name-based
- Use `'Pseudo/MDK-Tag'` when adding the property
- Use `'MDKit Tag'` when fetching it by display name
- Always wrap in try-catch for error handling
- The effect is applied via `beginUndoGroup`/`endUndoGroup` for undo support

## File References

- **hostscript.jsx** — Complete host script with full implementation
- **pseudo-effect-data.js** — Binary definition for reference
- **mdk-tag.ffx** — Backup preset file

## Support

If the pseudo effect fails to apply:
1. Verify After Effects is up to date
2. Check that the matchName is exactly `'Pseudo/MDK-Tag'`
3. Ensure the layer is selected in an open composition
4. Use the fallback `.ffx` preset method
