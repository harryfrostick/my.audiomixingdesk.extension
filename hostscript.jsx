/**
 * hostscript.jsx
 * Audio Mixing Desk — ExtendScript host functions
 * Loaded automatically by CEP via <ScriptPath> in manifest.xml
 *
 * Every function returns a JSON string so the JS layer can parse
 * { ok: true, message: "..." }  or  { ok: false, message: "..." }
 *
 * MDKit Tag system
 * ────────────────
 * Layers are categorised by a "Dropdown Menu Control" effect added directly
 * to the layer and renamed "MDKit Tag".  The dropdown has four items:
 *
 *   1 – Overlay
 *   2 – VO
 *   3 – SFX
 *   4 – Music
 *
 * Setup Audio Controls reads the effect value and links each tagged layer's
 * Audio Levels to the matching category null slider.
 * The expression also respects a per-layer "Base Level" Slider Control so
 * individual dB trims survive the global category + master offsets.
 *
 * NOTE: Dropdown Menu Control requires After Effects 17.0 (2020) or later.
 *       setPropertyParameters (to name the items) requires AE 17.0.1+.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _ok(msg)  { return JSON.stringify({ ok: true,  message: msg }); }
function _err(msg) { return JSON.stringify({ ok: false, message: msg }); }

// ---------------------------------------------------------------------------
// MDKit Tag — Dropdown Menu Control implementation
// ---------------------------------------------------------------------------

/**
 * The effect name applied to tagged layers.
 * Matches what AE will show in the Effects panel.
 */
var MDKIT_TAG_EFFECT_NAME = 'MDKit Tag';

/**
 * Dropdown item labels (1-indexed to match AE’s Dropdown Menu Control).
 * Index 0 is unused; indices 1-4 match the dropdown positions.
 */
var MDKIT_ITEMS = ['', 'Overlay', 'VO', 'SFX', 'Music'];

/**
 * Map dropdown index → lower-case key used throughout the script.
 * 1 = overlay  (no linked slider yet — reserved for future use)
 * 2 = vo
 * 3 = sfx
 * 4 = music
 */
var DROPDOWN_TO_KEY = { 1: 'overlay', 2: 'vo', 3: 'sfx', 4: 'music' };

/** Reverse map: lower-case key → dropdown index. */
var KEY_TO_DROPDOWN = { overlay: 1, vo: 2, sfx: 3, music: 4 };

/** All valid MDKit tag keys. */
var MD_TAGS = ['overlay', 'music', 'vo', 'sfx'];

/** ES3-safe alternative to Array.indexOf (not available in ExtendScript). */
function inArray(arr, val) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === val) return true;
    }
    return false;
}

/**
 * Read the MDKit Tag dropdown value from a layer.
 * Returns 'overlay', 'vo', 'sfx', 'music', or null if the effect is absent.
 */
function getMDTag(layer) {
    try {
        var fx = layer.property('Effects');
        if (!fx) return null;
        var tagEffect = fx.property(MDKIT_TAG_EFFECT_NAME);
        if (!tagEffect) return null;
        // Access Menu by index 1 — more reliable than by display name
        var menuProp = tagEffect.property(1);
        if (!menuProp) return null;
        var idx = menuProp.value;
        return DROPDOWN_TO_KEY[idx] || null;
    } catch (e) {}
    return null;
}

/**
 * Apply (or update) the "MDKit Tag" Dropdown Menu Control on a layer.
 * Creates the effect if it doesn't exist yet, then sets the item index.
 *
 * Throws on failure so the caller can surface the error to the user.
 *
 * @param {Layer}  layer  — target AE layer
 * @param {string} tag    — one of 'overlay', 'vo', 'sfx', 'music'
 */
function setMDTag(layer, tag) {
    var idx = KEY_TO_DROPDOWN[tag.toLowerCase()];
    if (!idx) throw new Error('Unknown tag key: "' + tag + '"');

    var fx = layer.property('Effects');
    if (!fx) throw new Error('Layer "' + layer.name + '" has no Effects property.');

    var tagEffect = fx.property(MDKIT_TAG_EFFECT_NAME);

    if (!tagEffect) {
        tagEffect = fx.addProperty('Dropdown Menu Control');
        if (!tagEffect) throw new Error('addProperty returned null on "' + layer.name + '".');

        tagEffect.name = MDKIT_TAG_EFFECT_NAME;

        tagEffect = fx.property(MDKIT_TAG_EFFECT_NAME);
        var menuProp = tagEffect.property(1);
        
        try {
            menuProp.setPropertyParameters(['Overlay', 'VO', 'SFX', 'Music']);
        } catch (e) {
            // Ignore if unavailable
        }

        menuProp.setValue(idx);

    } else {
        tagEffect.property(1).setValue(idx);
    }
}

/**
 * Remove the "MDKit Tag" effect from a layer entirely.
 */
function clearMDTag(layer) {
    try {
        var fx = layer.property('Effects');
        if (!fx) return;
        var tagEffect = fx.property(MDKIT_TAG_EFFECT_NAME);
        if (tagEffect) tagEffect.remove();
    } catch (e) {}
}

/**
 * Ensure a null layer named `nullName` exists in `comp` and that it has
 * a Slider Control effect named `sliderName`.
 * Returns { layer, slider } where slider is the actual "Slider" sub-property.
 */
function ensureControl(comp, nullName, sliderName, labelColor) {
    var ctrlLayer = null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var lyr = comp.layer(i);
        if (lyr.name === nullName && lyr.nullLayer) {
            ctrlLayer = lyr;
            break;
        }
    }
    if (!ctrlLayer) {
        ctrlLayer = comp.layers.addNull();
        ctrlLayer.name = nullName;
        if (labelColor != null) ctrlLayer.label = labelColor;
        ctrlLayer.moveToBeginning();
    }
    var fx = ctrlLayer.property("Effects");
    var slider = fx.property(sliderName);
    if (!slider) {
        slider = fx.addProperty("Slider Control");
        slider.name = sliderName;
    }
    // Return the actual numeric "Slider" property for expression / value access
    var sliderProp = slider.property("Slider") || slider;
    return { layer: ctrlLayer, slider: sliderProp };
}

/**
 * Bake the current evaluated value of an Audio Levels property:
 * - If there are existing keyframes, re-evaluate every frame and write a
 *   new keyframe at that value (then remove the expression).
 * - If there are no keyframes, set a single static value and clear
 *   the expression.
 */
function bakeAudioLevelKeyframes(audioProp) {
    try { audioProp.expressionEnabled = false; } catch (e) {}

    var numKF = audioProp.numKeys;
    if (numKF > 0) {
        // Collect existing key times
        var times = [];
        for (var k = 1; k <= numKF; k++) {
            times.push(audioProp.keyTime(k));
        }
        // Temporarily re-enable expression to sample evaluated values
        try { audioProp.expressionEnabled = true; } catch (e) {}
        var values = [];
        for (var t = 0; t < times.length; t++) {
            try { values.push(audioProp.valueAtTime(times[t], false)); }
            catch (e) { values.push([0, 0]); }
        }
        try { audioProp.expressionEnabled = false; } catch (e) {}

        // Remove all existing keyframes (back-to-front)
        for (var k = audioProp.numKeys; k >= 1; k--) {
            audioProp.removeKey(k);
        }
        // Write baked keyframes
        for (var t = 0; t < times.length; t++) {
            audioProp.setValueAtTime(times[t], values[t]);
        }
    } else {
        // Static — just capture the current evaluated value
        var val;
        try { audioProp.expressionEnabled = true; } catch (e) {}
        try { val = audioProp.valueAtTime(0, false); } catch (e) { val = [0, 0]; }
        try { audioProp.expressionEnabled = false; } catch (e) {}
        audioProp.setValue(val);
    }

    // Wipe the expression entirely
    try {
        audioProp.expression = "";
        audioProp.expressionEnabled = false;
    } catch (e) {}
}

// ---------------------------------------------------------------------------
// MDKit Tag → Category lookup
// ---------------------------------------------------------------------------

/**
 * Maps lower-case MDKit tag keys to their control null/slider names.
 * 'overlay' has no dedicated slider yet and maps to null — tagged layers
 * will be skipped by linkMDTaggedLayers() but still counted in the UI.
 */
var TAG_CONTROL_MAP = {
    music:   { nullName: 'Music Control NULL', sliderName: 'Music Control' },
    vo:      { nullName: 'VO Control NULL',    sliderName: 'VO Control'    },
    sfx:     { nullName: 'SFX Control NULL',   sliderName: 'SFX Control'   },
    overlay: null  // reserved — no dedicated slider in the current panel
};

/**
 * Build the Audio Levels expression that links a tagged layer to its
 * category control (which itself already adds Master).
 * The expression also respects an optional per-layer "Base Level" slider
 * so individual dB trims are preserved.
 *
 *  Audio Levels = Base Level trim + Category slider (which = cat base + Master)
 */
function buildAudioLevelExpr(ctrl) {
    return (
        'var base = 0;\n' +
        'try { base = effect("Base Level")("Slider"); } catch(e) {}\n' +
        'var ctrl = thisComp.layer("' + ctrl.nullName + '")' +
                  '.effect("' + ctrl.sliderName + '")("Slider");\n' +
        'var dB = base + ctrl;\n' +
        '[dB, dB];'
    );
}

/**
 * Iterate all audio layers in comp; for each MDtag-labelled layer apply
 * the Audio Levels expression that links it to its category slider.
 * Returns the count of layers linked.
 */
function linkMDTaggedLayers(comp, masterNullName, masterSliderName) {
    var linked = 0;
    for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        if (!layer.audioEnabled) continue;

        var tag = getMDTag(layer);
        if (!tag) continue;

        var ctrl = TAG_CONTROL_MAP[tag];
        if (!ctrl) continue;

        var audioProp = layer.property('Audio Levels');
        if (!audioProp) continue;

        try {
            audioProp.expression = '';
            audioProp.expressionEnabled = true;
            audioProp.expression = buildAudioLevelExpr(ctrl);
            linked++;
        } catch (e) {}
    }
    return linked;
}

// ---------------------------------------------------------------------------
// 1. Setup Audio Controls
// ---------------------------------------------------------------------------

function setupAudioControls() {
    try {
        app.beginUndoGroup('Setup Audio Controls');

        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            app.endUndoGroup();
            return _err('Please select an active composition.');
        }

        var master = {
            nullName:   'Master Audio Control NULL',
            sliderName: 'Master Audio Control',
            label: 13
        };
        var controls = [
            { type: 'Music', nullName: 'Music Control NULL', sliderName: 'Music Control', label: 9 },
            { type: 'VO',    nullName: 'VO Control NULL',    sliderName: 'VO Control',    label: 9 },
            { type: 'SFX',  nullName: 'SFX Control NULL',   sliderName: 'SFX Control',   label: 9 }
        ];

        // Ensure Master null + slider exist
        ensureControl(comp, master.nullName, master.sliderName, master.label);

        // Ensure each category null + slider; link category slider → master
        for (var c = 0; c < controls.length; c++) {
            var ref = ensureControl(comp,
                                    controls[c].nullName,
                                    controls[c].sliderName,
                                    controls[c].label);
            try {
                ref.slider.expression = '';
                ref.slider.expressionEnabled = true;
                ref.slider.expression =
                    'base = value;\n' +
                    'master = thisComp.layer("' + master.nullName + '")' +
                            '.effect("' + master.sliderName + '")("Slider");\n' +
                    'base + master;';
            } catch (exprErr) {}
        }

        // Link all MDtag-labelled audio layers to their category slider
        var linked = linkMDTaggedLayers(comp, master.nullName, master.sliderName);

        app.endUndoGroup();
        var msg = 'Audio controls set up successfully.';
        if (linked > 0) msg += ' Linked ' + linked + ' MDtag layer(s).';
        else msg += ' No MDtag layers found — tag layers with MDtag:Music, MDtag:VO or MDtag:SFX in their comments.';
        return _ok(msg);
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err('Setup failed: ' + e.toString());
    }
}

// ---------------------------------------------------------------------------
// 2. Bake & Remove Audio Controls (Track Mixer)
// ---------------------------------------------------------------------------

function bakeRemoveAudioControls() {
    try {
        app.beginUndoGroup("Bake & Remove Audio Controls");

        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            app.endUndoGroup();
            return _err("Please select an active composition.");
        }

        var master = {
            nullName:   "Master Audio Control NULL",
            sliderName: "Master Audio Control"
        };
        var controls = [
            { type: "Music", nullName: "Music Control NULL", sliderName: "Music Control" },
            { type: "VO",    nullName: "VO Control NULL",    sliderName: "VO Control"    },
            { type: "SFX",  nullName: "SFX Control NULL",   sliderName: "SFX Control"   }
        ];

        // Build normalised expression signatures — two variants:
        //   sigNew: MDtag-style expr (buildAudioLevelExpr)
        //   sigLegacy: old hard-coded Base Level format from the original script
        function sigNew(ctrl) {
            return buildAudioLevelExpr(ctrl).replace(/\s/g, '');
        }
        function sigLegacy(ctrl) {
            var s =
                'base = effect("Base Level")("Slider");\n' +
                'ctrl = thisComp.layer("' + ctrl.nullName + '")' +
                        '.effect("' + ctrl.sliderName + '")("Slider");\n' +
                'val = base + ctrl;\n' +
                '[val, val];';
            return s.replace(/\s/g, '');
        }
        var ctrlSigsNew    = {};
        var ctrlSigsLegacy = {};
        for (var c = 0; c < controls.length; c++) {
            ctrlSigsNew[controls[c].type]    = sigNew(controls[c]);
            ctrlSigsLegacy[controls[c].type] = sigLegacy(controls[c]);
        }

        // Bake audio layers that reference any of our control expressions
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.audioEnabled) continue;

            var audioProp = layer.property('Audio Levels');
            if (!audioProp) continue;

            var exprText = '';
            try { exprText = (audioProp.expression || '').replace(/\s/g, ''); } catch (e) {}

            var matched = false;
            for (var c = 0; c < controls.length; c++) {
                var t = controls[c].type;
                if (exprText && (exprText === ctrlSigsNew[t] || exprText === ctrlSigsLegacy[t])) {
                    matched = true;
                    break;
                }
            }
            if (!matched) continue;

            try { bakeAudioLevelKeyframes(audioProp); } catch (e) {}

            // Remove Base Level slider from this layer if present
            try {
                var fx = layer.property("Effects");
                if (fx && fx.property("Base Level")) fx.property("Base Level").remove();
            } catch (e) {}
        }

        // Clear expressions on category sliders (they reference Master)
        for (var c = 0; c < controls.length; c++) {
            try {
                var catLayer = comp.layer(controls[c].nullName);
                if (catLayer && catLayer.nullLayer) {
                    var sFx = catLayer.property("Effects").property(controls[c].sliderName);
                    if (sFx) {
                        var sp = sFx.property("Slider") || sFx;
                        sp.expression = "";
                        sp.expressionEnabled = false;
                    }
                }
            } catch (e) {}
        }

        // Remove category NULLs
        for (var c = 0; c < controls.length; c++) {
            try {
                var ctrlLayer = comp.layer(controls[c].nullName);
                if (ctrlLayer && ctrlLayer.nullLayer) ctrlLayer.remove();
            } catch (e) {}
        }
        // Remove Master NULL
        try {
            var masterLayer = comp.layer(master.nullName);
            if (masterLayer && masterLayer.nullLayer) masterLayer.remove();
        } catch (e) {}

        app.endUndoGroup();
        return _ok("Audio controls baked and removed.");
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err("Bake & Remove failed: " + e.toString());
    }
}

// ---------------------------------------------------------------------------
// 3. Migrate Audio Levels → Base Level Slider
// ---------------------------------------------------------------------------

function migrateAudioLevelsToSlider() {
    try {
        app.beginUndoGroup("Migrate Audio Levels to Slider");

        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            app.endUndoGroup();
            return _err("Please select an active composition.");
        }

        var migratedCount = 0;

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.audioEnabled) continue;

            var audioProp = layer.property("Audio Levels");
            if (!audioProp) continue;

            // Skip layers that already have a Base Level slider
            var fx = layer.property("Effects");
            if (fx && fx.property("Base Level")) continue;

            // Determine the representative dB value
            var dbVal = 0;
            var numKF = audioProp.numKeys;
            if (numKF > 0) {
                // Use the value of the first keyframe's left channel
                try {
                    var kfVal = audioProp.keyValue(1);
                    dbVal = kfVal instanceof Array ? kfVal[0] : kfVal;
                } catch (e) { dbVal = 0; }
            } else {
                try {
                    var sv = audioProp.value;
                    dbVal = sv instanceof Array ? sv[0] : sv;
                } catch (e) { dbVal = 0; }
            }

            // Add a "Base Level" Slider Control to the layer itself
            var baseSlider;
            try {
                baseSlider = fx.addProperty("Slider Control");
                baseSlider.name = "Base Level";
                var baseSliderProp = baseSlider.property("Slider") || baseSlider;
                baseSliderProp.setValue(dbVal);
            } catch (e) { continue; }

            // Replace Audio Levels with an expression referencing Base Level
            try {
                audioProp.expression = "";
                audioProp.expressionEnabled = true;
                audioProp.expression =
                    'var dB = effect("Base Level")("Slider");\n' +
                    '[dB, dB];';
            } catch (e) {}

            migratedCount++;
        }

        app.endUndoGroup();
        if (migratedCount === 0) {
            return _ok("No eligible audio layers found to migrate.");
        }
        return _ok("Migrated " + migratedCount + " layer(s) to Base Level slider.");
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err("Migration failed: " + e.toString());
    }
}

// ---------------------------------------------------------------------------
// 4. Bake Audio Levels (flatten expressions to keyframe values)
// ---------------------------------------------------------------------------

function bakeAudioLevels() {
    try {
        app.beginUndoGroup("Bake Audio Levels");

        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            app.endUndoGroup();
            return _err("Please select an active composition.");
        }

        var bakedCount = 0;

        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.audioEnabled) continue;

            var audioProp = layer.property("Audio Levels");
            if (!audioProp) continue;

            var hasExpr = false;
            try { hasExpr = audioProp.expressionEnabled && audioProp.expression !== ""; } catch (e) {}
            if (!hasExpr) continue;

            try { bakeAudioLevelKeyframes(audioProp); } catch (e) {}

            // Remove the Base Level slider if present — values are now baked
            try {
                var fx = layer.property("Effects");
                if (fx && fx.property("Base Level")) fx.property("Base Level").remove();
            } catch (e) {}

            bakedCount++;
        }

        app.endUndoGroup();
        if (bakedCount === 0) {
            return _ok("No audio layers with active expressions found.");
        }
        return _ok("Baked audio levels on " + bakedCount + " layer(s).");
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err("Bake Audio Levels failed: " + e.toString());
    }
}

// ---------------------------------------------------------------------------
// Slider sync helpers — called by main.js to push panel slider values into AE
// ---------------------------------------------------------------------------

/**
 * Set the value of a named slider effect on a named null layer in the active comp.
 * value  — a number (the new slider value)
 */
function setSliderValue(nullName, sliderName, value) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return _err('No active composition.');
        var layer = comp.layer(nullName);
        if (!layer) return _err("Layer '" + nullName + "' not found.");
        var fx = layer.property('Effects');
        var slider = fx.property(sliderName);
        if (!slider) return _err("Slider '" + sliderName + "' not found.");
        var sp = slider.property('Slider') || slider;
        sp.setValue(parseFloat(value));
        return _ok('Slider updated.');
    } catch (e) {
        return _err('setSliderValue failed: ' + e.toString());
    }
}

/**
 * Read the current value of a named slider effect on a named null layer.
 * Returns { ok, message, value }.
 */
function getSliderValue(nullName, sliderName) {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) return _err('No active composition.');
        var layer = comp.layer(nullName);
        if (!layer) return JSON.stringify({ ok: false, value: null, message: 'Layer not found.' });
        var fx = layer.property('Effects');
        var slider = fx.property(sliderName);
        if (!slider) return JSON.stringify({ ok: false, value: null, message: 'Slider not found.' });
        var sp = slider.property('Slider') || slider;
        return JSON.stringify({ ok: true, value: sp.value, message: 'ok' });
    } catch (e) {
        return JSON.stringify({ ok: false, value: null, message: e.toString() });
    }
}

// ---------------------------------------------------------------------------
// MDtag management — called by the tag buttons in the panel
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Active comp resolution
// ---------------------------------------------------------------------------

/**
 * Reliably find the active composition even when a CEP panel has stolen focus
 * (which can make app.project.activeItem return null).
 *
 * Strategy:
 *  1. Try app.project.activeItem — works most of the time.
 *  2. Search all project items for a CompItem that has selectedLayers.
 *  3. Return the first CompItem found as a last resort.
 */
function getActiveComp() {
    // 1. Standard path
    try {
        var ai = app.project.activeItem;
        if (ai && ai instanceof CompItem) return ai;
    } catch (e) {}

    // 2. Find comp with selected layers
    try {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!(item instanceof CompItem)) continue;
            var sel = item.selectedLayers;
            if (sel && sel.length > 0) return item;
        }
    } catch (e) {}

    // 3. First comp in the project
    try {
        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (item instanceof CompItem) return item;
        }
    } catch (e) {}

    return null;
}

/**
 * Collect selected layers from a comp using both available methods.
 * Returns an array (may be empty).
 */
function getSelectedLayers(comp) {
    var result = [];

    // Method A: comp.selectedLayers (preferred)
    try {
        var sel = comp.selectedLayers;
        if (sel && sel.length > 0) {
            for (var i = 0; i < sel.length; i++) result.push(sel[i]);
            return result;
        }
    } catch (e) {}

    // Method B: iterate all layers and check layer.selected
    try {
        for (var i = 1; i <= comp.numLayers; i++) {
            var lyr = comp.layer(i);
            if (lyr.selected) result.push(lyr);
        }
    } catch (e) {}

    return result;
}

/**
 * Tag all currently selected layers in the active comp with the given MDKit tag.
 * Uses getActiveComp() + getSelectedLayers() for maximum reliability.
 */
function tagSelectedLayers(tag) {
    try {
        var normTag = tag.toLowerCase();
        if (!inArray(MD_TAGS, normTag)) return _err('Unknown tag: "' + tag + '"');

        var comp = getActiveComp();
        if (!comp) return _err('No composition found. Open a comp in the AE timeline.');

        var toTag = getSelectedLayers(comp);
        if (toTag.length === 0) {
            return _err(
                'No selected layers in "' + comp.name + '" (' + comp.numLayers + ' total). ' +
                'Click in the AE timeline to select layers, then click the tag button.'
            );
        }

        app.beginUndoGroup('MDKit Tag: Tag as ' + tag);
        var count  = 0;
        var errors = [];
        for (var i = 0; i < toTag.length; i++) {
            try {
                setMDTag(toTag[i], normTag);
                count++;
            } catch (layerErr) {
                errors.push('"' + toTag[i].name + '": ' + layerErr.message);
            }
        }
        app.endUndoGroup();

        if (count === 0) {
            return _err('Tagging failed on all layers. ' + errors.join(' | '));
        }
        var label = MDKIT_ITEMS[KEY_TO_DROPDOWN[normTag]] || normTag;
        var msg = 'Tagged ' + count + ' layer(s) as ' + label + '.';
        if (errors.length > 0) msg += ' Skipped: ' + errors.join(' | ');
        return _ok(msg);
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err('tagSelectedLayers error: ' + e.toString());
    }
}

/**
 * Apply MDKit Tag to selected layers using the index directly from the panel dropdown.
 * This bypasses all key-to-index mapping and stale reference issues.
 *
 * @param {number} idx - The dropdown index (1=Overlay, 2=VO, 3=SFX, 4=Music)
 * @return {string} JSON response
 */
// ---------------------------------------------------------------------------
// 1. Pseudo-Effect Data Definition
// ---------------------------------------------------------------------------

var PSEUDO_DATA = {
    name: "mdk-tag",
    matchName: "Pseudo/MDK-Tag",
    // This is the binary string from your pseudo-effect-data.js
    binary: "(new String(\"RIFX\x00\x00\x06\\\"FaFXhead\x00\x00\x00\x10\x00\x00\x00\x03\x00\x00\x00D\x00\x00\x00\x01\x01\x00\x00\x00LIST\x00\x00\x05\u00FEbescbeso\x00\x00\x008\x00\x00\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00]\u00A8\x00\x1D\u00F8R\x00\x00\x00\x00\x00d\x00d\x00d\x00d?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\u00FF\u00FF\u00FF\u00FFLIST\x00\x00\x00\u00ACtdsptdot\x00\x00\x00\x04\u00FF\u00FF\u00FF\u00FFtdpl\x00\x00\x00\x04\x00\x00\x00\x02LIST\x00\x00\x00@tdsitdix\x00\x00\x00\x04\u00FF\u00FF\u00FF\u00FFtdmn\x00\x00\x00(ADBE Effect Parade\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00LIST\x00\x00\x00@tdsitdix\x00\x00\x00\x04\x00\x00\x00\x00tdmn\x00\x00\x00(Pseudo/MDK-Tag\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00tdsn\x00\x00\x00\nMDKit Tag\x00LIST\x00\x00\x00dtdsptdot\x00\x00\x00\x04\u00FF\u00FF\u00FF\u00FFtdpl\x00\x00\x00\x04\x00\x00\x00\x01LIST\x00\x00\x00@tdsitdix\x00\x00\x00\x04\u00FF\u00FF\u00FF\u00FFtdmn\x00\x00\x00(ADBE End of path sentinel\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00LIST\x00\x00\x04\u0080sspcfnam\x00\x00\x000\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00LIST\x00\x00\x01\u00C6parTparn\x00\x00\x00\x04\x00\x00\x00\x02tdmn\x00\x00\x00(Pseudo/MDK-Tag-0000\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00pard\x00\x00\x00\u0094\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x0E\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\u00FF\u00FF\u00FF\u00FF\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00tdmn\x00\x00\x00(Pseudo/MDK-Tag-0001\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00pard\x00\x00\x00\u0094\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x07Type\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x00\x00\x00\x00\x00\x00\x01\x00\x03\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00pdnm\x00\x00\x00\x15Overlay|VO|SFX|Music\x00\x00LIST\x00\x00\x02ntdgptdsb\x00\x00\x00\x04\x00\x00\x00\x01tdsn\x00\x00\x00\nMDKit Tag\x00tdmn\x00\x00\x00(Pseudo/MDK-Tag-0000\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00LIST\x00\x00\x00\u00DAtdbstdsb\x00\x00\x00\x04\x00\x00\x00\x03tdsn\x00\x00\x00\x01\x00\x00tdb4\x00\x00\x00|\u00DB\u0099\x00\x01\x00\x01\x00\x00\x00\x01\x00\x00\x00\x00\x02X?\x1A6\u00E2\u00EB\x1CC-?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x04\x04\u00C0\u00C0\u00C0\u00FF\u00C0\u00C0\u00C0\x00\x00\x00\x00\u0080\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00cdat\x00\x00\x00(\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00tdpi\x00\x00\x00\x04\x00\x00\x00\x0Etdmn\x00\x00\x00(Pseudo/MDK-Tag-0001\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00LIST\x00\x00\x00\u00D2tdbstdsb\x00\x00\x00\x04\x00\x00\x00\x01tdsn\x00\x00\x00\x05Type\x00\x00tdb4\x00\x00\x00|\u00DB\u0099\x00\x01\x00\x01\x00\x00\x00\x01\x00\u00FF\x00\x00]\u00A8?\x1A6\u00E2\u00EB\x1CC-?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00?\u00F0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x04\x04\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00cdat\x00\x00\x00(?\u00F0\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00tdmn\x00\x00\x00(ADBE Group End\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00{\"controlName\":\"MDKit Tag\",\"matchname\":\"Pseudo/MDK-Tag\",\"controlArray\":[{\"name\":\"Type\",\"type\":\"popup\",\"canHaveKeyframes\":true,\"canBeInvisible\":true,\"invisible\":false,\"keyframes\":false,\"id\":2104867906,\"hold\":false,\"default\":1,\"content\":\"Overlay|VO|SFX|Music\",\"error\":[\n\n]}],\"version\":3}\")",
};

// ---------------------------------------------------------------------------
// 2. Helper to apply/register Pseudo-Effect
// ---------------------------------------------------------------------------

function applyPseudoEffect(data, effectsProp) {
    // Check if AE already knows this matchName
    if (!effectsProp.canAddProperty(data.matchName)) {
        var tempFile = new File(Folder.desktop.fsName + "/" + data.name + ".ffx");
        
        // Write binary preset to temp file
        tempFile.encoding = "BINARY";
        tempFile.open("w");
        tempFile.write(eval(data.binary)); 
        tempFile.close();

        // Trick AE into loading the pseudo-effect by applying it via a temp comp
        var tempComp = app.project.items.addComp("temp", 100, 100, 1, 1, 24);
        var tempLayer = tempComp.layers.addShape();
        try { tempLayer.applyPreset(tempFile); } catch(e) {}
        tempComp.remove();
        
        // Cleanup temp file
        if (tempFile.exists) tempFile.remove();
    }

    return effectsProp.addProperty(data.matchName);
}

// ---------------------------------------------------------------------------
// 3. Updated applyTagByIndex
// ---------------------------------------------------------------------------

function applyTagByIndex(idx) {
    try {
        var comp = getActiveComp(); //
        if (!comp) return _err('No composition found.');

        var toTag = getSelectedLayers(comp); //
        if (toTag.length === 0) return _err('No selected layers.');

        app.beginUndoGroup('Apply MDKit Tag');
        var count = 0;
        var errors = [];

        for (var i = 0; i < toTag.length; i++) {
            var layer = toTag[i];
            try {
                var fx = layer.property('ADBE Effect Parade');
                if (!fx) throw new Error('No Effects group found');

                // Remove existing if present to ensure fresh apply
                var existing = fx.property('MDKit Tag') || fx.property(PSEUDO_DATA.matchName);
                if (existing) existing.remove();

                // Apply pseudo effect using our helper
                var tagEffect = applyPseudoEffect(PSEUDO_DATA, fx);
                if (!tagEffect) throw new Error('Failed to create effect');

                tagEffect.name = 'MDKit Tag';

                // Property 1 is the "Type" dropdown in your data
                var menuProp = tagEffect.property(1);
                if (menuProp) {
                    menuProp.setValue(idx);
                }

                count++;
            } catch (e) {
                errors.push(layer.name + ': ' + e.toString());
            }
        }
        app.endUndoGroup();

        if (count === 0) return _err('All failed: ' + errors.join(' | '));
        
        var tagNames = { 1: 'Overlay', 2: 'VO', 3: 'SFX', 4: 'Music' };
        var msg = 'Tagged ' + count + ' layer(s) as ' + (tagNames[idx] || idx) + '.';
        return _ok(msg);

    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err('applyTagByIndex Error: ' + e.toString());
    }
}

/**
 * Remove the MDKit Tag effect from all currently selected layers.
 */
function clearTagSelectedLayers() {
    try {
        var comp = getActiveComp();
        if (!comp) return _err('No composition found.');

        var toProcess = getSelectedLayers(comp);
        if (toProcess.length === 0) {
            return _err(
                'No selected layers in "' + comp.name + '". ' +
                'Select layers in the timeline first.'
            );
        }

        app.beginUndoGroup('MDKit Tag: Clear Tag');
        var count = 0;
        for (var i = 0; i < toProcess.length; i++) {
            clearMDTag(toProcess[i]);
            count++;
        }
        app.endUndoGroup();

        return _ok('Cleared MDKit Tag from ' + count + ' layer(s).');
    } catch (e) {
        try { app.endUndoGroup(); } catch (x) {}
        return _err('clearTagSelectedLayers error: ' + e.toString());
    }
}

// ---------------------------------------------------------------------------
// Diagnostic helpers
// ---------------------------------------------------------------------------

/**
 * Simple connectivity test — call pingHost() from the panel to verify
 * the CEP ↔ ExtendScript bridge is working.
 */
function pingHost() {
    return JSON.stringify({
        ok: true,
        message: 'AE host connected. Version: ' + app.version
    });
}

/**
 * Return a JSON snapshot of the current AE state: project name, active
 * comp, layer count, selected layer names. Useful for diagnosing why
 * tagging doesn’t find layers.
 */
function getCompInfo() {
    try {
        var info = {
            ok:            true,
            aeVersion:     app.version,
            hasProject:    false,
            activeItem:    'none',
            compName:      '',
            totalLayers:   0,
            selectedByArr: 0,
            selectedByProp:0,
            selectedNames: []
        };

        if (!app.project) return JSON.stringify(info);
        info.hasProject = true;

        var ai = app.project.activeItem;
        info.activeItem = ai ? (ai instanceof CompItem ? 'CompItem:' + ai.name : typeof ai) : 'null';

        var comp = getActiveComp();
        if (!comp) return JSON.stringify(info);

        info.compName    = comp.name;
        info.totalLayers = comp.numLayers;

        // Method A count
        try {
            var sa = comp.selectedLayers;
            info.selectedByArr = sa ? sa.length : 0;
        } catch(e) { info.selectedByArr = 'err:' + e.message; }

        // Method B count + names
        try {
            for (var i = 1; i <= comp.numLayers; i++) {
                var lyr = comp.layer(i);
                if (lyr.selected) {
                    info.selectedByProp++;
                    info.selectedNames.push(lyr.name);
                }
            }
        } catch(e) { info.selectedByProp = 'err:' + e.message; }

        return JSON.stringify(info);
    } catch(e) {
        return JSON.stringify({ ok: false, message: e.toString() });
    }
}

/**
 * Return a JSON summary of MDtag distribution in the active comp.
 * Used by the panel to display a live count per category.
 */
function getTaggedLayerCount() {
    try {
        var comp = app.project.activeItem;
        if (!(comp && comp instanceof CompItem)) {
            return JSON.stringify({ ok: false, message: 'No active composition.', counts: {} });
        }
        var counts = { music: 0, vo: 0, sfx: 0, untagged: 0 };
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            if (!layer.audioEnabled) continue;
            var t = getMDTag(layer);
            if (t && counts.hasOwnProperty(t)) counts[t]++;
            else counts.untagged++;
        }
        return JSON.stringify({ ok: true, message: 'ok', counts: counts });
    } catch (e) {
        return JSON.stringify({ ok: false, message: e.toString(), counts: {} });
    }
}
