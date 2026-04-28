// AudioControlPanel.jsx — Master + VO/Music/SFX with MDKit Tag routing (popup as text)
{
    function buildUI(thisObj) {
        var panel = (thisObj instanceof Panel) ? thisObj : new Window("palette", "Audio Control Panel", undefined, {resizeable: true});

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];

        var btnRunAll = panel.add("button", undefined, "Setup Audio Controls");
        var btnRemoveAll = panel.add("button", undefined, "Bake & Remove Controls");

        // ---------------- Helpers ----------------

        // Migrate Audio Levels keyframes/value → Base Level slider (L/R assumed equal)
        function migrateAudioLevelsToSlider(audioProp, baseSlider) {
            if (!audioProp || !baseSlider) return;

            if (audioProp.isTimeVarying && audioProp.numKeys > 0) {
                while (baseSlider.numKeys > 0) baseSlider.removeKey(1);
                for (var k = 1; k <= audioProp.numKeys; k++) {
                    var t = audioProp.keyTime(k);
                    var vPair = audioProp.keyValue(k);
                    var v = (vPair && vPair.length ? vPair[0] : 0);
                    baseSlider.setValueAtTime(t, v);
                }
            } else {
                var vNow = audioProp.value;
                var v = (vNow && vNow.length ? vNow[0] : 0);
                baseSlider.setValue(v);
            }
        }

        // Bake current evaluated values at existing keyframe times, remove expression
        function bakeAudioLevelKeyframes(prop) {
            if (!prop) return;

            if (!prop.isTimeVarying || prop.numKeys === 0) {
                // No keys: just set current value and clear expression
                var baked = prop.value;
                prop.expression = "";
                prop.expressionEnabled = false;
                prop.setValue(baked);
                return;
            }

            var times = [];
            for (var k = 1; k <= prop.numKeys; k++) times.push(prop.keyTime(k));

            // Enable expression temporarily to read evaluated values
            var wasEnabled = prop.expressionEnabled;
            prop.expressionEnabled = true;
            var bakedValues = [];
            for (var i = 0; i < times.length; i++) bakedValues.push(prop.valueAtTime(times[i], false));

            while (prop.numKeys > 0) prop.removeKey(1);
            prop.expression = "";
            prop.expressionEnabled = false;

            for (var j = 0; j < times.length; j++) prop.setValueAtTime(times[j], bakedValues[j]);
        }

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
            return { layer: ctrlLayer, slider: slider.property("Slider") || slider }; // ensure we return the actual slider property
        }

        // Tries to read popup TEXT; if it’s an index, map it via fallback order.

        //Function
        function getMDKitCategoryText(layer) {
            try {
                var fx = layer.property("Effects");
                if (!fx) return "";
                var tag = fx.property("MDKit Tag");
                if (!tag) return "";

                // Try common property names, then fall back to index 1.
                var popup =
                    tag.property("Category") ||
                    tag.property("Type") ||
                    tag.property("Audio Type") ||
                    tag.property("Menu") ||
                    tag.property("Popup") ||
                    tag.property(1);

                if (!popup) return "";

                var val = popup.value;

                // If AE returns text, use it (and ignore Overlay)
                if (typeof val === "string") {
                    var txt = val.trim();
                    if (/^overlay$/i.test(txt)) return ""; // skip Overlay
                    return txt;
                }

                // If AE returns a number (1-based index), map it exactly to your menu
                if (typeof val === "number") {
                    // 1: Overlay (ignore), 2: VO, 3: SFX, 4: Music
                    var indexMap = ["", /*0*/ "", /*1*/ "", /*placeholder*/ "", /*will reset below*/];
                    indexMap[1] = "";        // Overlay → skip
                    indexMap[2] = "VO";
                    indexMap[3] = "SFX";
                    indexMap[4] = "Music";

                    if (val >= 0 && val < indexMap.length) return indexMap[val] || "";
                }
            } catch (e) {}

            return "";
        }



        // ---------------- Setup Button ----------------
        btnRunAll.onClick = function () {
            app.beginUndoGroup("Setup Audio Controls");

            var comp = app.project.activeItem;
            if (!(comp && comp instanceof CompItem)) {
                alert("Please select an active composition.");
                return;
            }

            // Define controllers
            var master = { nullName: "Master Audio Control NULL", sliderName: "Master Audio Control", label: 13 };
            var controls = [
                { type: "Music", nullName: "Music Control NULL", sliderName: "Music Control", label: 9  },
                { type: "VO",    nullName: "VO Control NULL",    sliderName: "VO Control",    label: 9  },
                { type: "SFX",   nullName: "SFX Control NULL",   sliderName: "SFX Control",   label: 9  }
               ,
                
                
            ];

            // Ensure Master exists
            var masterRefs = ensureControl(comp, master.nullName, master.sliderName, master.label);

            // Ensure category controls exist + link each category slider to master
            var controlRefs = {};
            for (var c = 0; c < controls.length; c++) {
                var ref = ensureControl(comp, controls[c].nullName, controls[c].sliderName, controls[c].label);
                controlRefs[controls[c].type] = ref;

                // Expression: category slider = its own value + master
                try {
                    var sliderProp = ref.slider; // this is the actual "Slider" property
                    sliderProp.expression = "";
                    sliderProp.expressionEnabled = true;
                    sliderProp.expression =
                        'base = value;\n' +
                        'master = thisComp.layer("' + master.nullName + '").effect("' + master.sliderName + '")("Slider");\n' +
                        'base + master;';
                } catch (e) {}
            }

            // Assign layers based on MDKit Tag (popup value as TEXT)
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);

                // Skip our control NULLs
                if (layer.nullLayer && (
                        layer.name === master.nullName ||
                        layer.name === controls[0].nullName ||
                        layer.name === controls[1].nullName ||
                        layer.name === controls[2].nullName
                    )) {
                    continue;
                }

                if (!layer.audioEnabled) continue;

                var category = getMDKitCategoryText(layer);
                if (!category) continue;

                // Find matching control (case-insensitive)
                var ctrlDef = null;
                for (var c = 0; c < controls.length; c++) {
                    if (controls[c].type.toLowerCase() === category.toLowerCase()) {
                        ctrlDef = controls[c];
                        break;
                    }
                }
                if (!ctrlDef) continue;

                var audioProp = layer.property("Audio Levels");
                if (!audioProp) continue;

                // Ensure Base Level slider on the layer
                var fx = layer.property("Effects");
                var baseUI;
                if (!fx.property("Base Level")) {
                    baseUI = fx.addProperty("Slider Control");
                    baseUI.name = "Base Level";
                } else {
                    baseUI = fx.property("Base Level");
                }
                var baseSlider = baseUI.property("Slider") || baseUI;

                // Move existing keyframes/value into Base Level
                migrateAudioLevelsToSlider(audioProp, baseSlider);

                // Link Audio Levels to Base + the appropriate category slider
                var expr =
                    'base = effect("Base Level")("Slider");\n' +
                    'ctrl = thisComp.layer("' + ctrlDef.nullName + '").effect("' + ctrlDef.sliderName + '")("Slider");\n' +
                    'val = base + ctrl;\n' +
                    '[val, val];';

                try {
                    audioProp.expression = "";
                    audioProp.expressionEnabled = true;
                    audioProp.expression = expr;
                } catch (e) {}
            }

            app.endUndoGroup();
        };

        // ---------------- Bake & Remove Button ----------------
        btnRemoveAll.onClick = function () {
            app.beginUndoGroup("Bake & Remove Audio Controls");

            var comp = app.project.activeItem;
            if (!(comp && comp instanceof CompItem)) {
                alert("Please select an active composition.");
                return;
            }

            var master = { nullName: "Master Audio Control NULL", sliderName: "Master Audio Control" };
            var controls = [
                { type: "Music", nullName: "Music Control NULL", sliderName: "Music Control", label: 9  },
                { type: "VO",    nullName: "VO Control NULL",    sliderName: "VO Control",    label: 9  },
                { type: "SFX",   nullName: "SFX Control NULL",   sliderName: "SFX Control",   label: 9  }
                
            ];

            // Build expression signatures (whitespace stripped) for detection
            function sigFor(ctrl) {
                var s =
                    'base = effect("Base Level")("Slider");\n' +
                    'ctrl = thisComp.layer("' + ctrl.nullName + '").effect("' + ctrl.sliderName + '")("Slider");\n' +
                    'val = base + ctrl;\n' +
                    '[val, val];';
                return s.replace(/\s/g, "");
            }
            var ctrlSigs = {};
            for (var c = 0; c < controls.length; c++) ctrlSigs[controls[c].type] = sigFor(controls[c]);

            // For each layer, if its Audio Levels expression matches one of our controls, bake & cleanup
            for (var i = 1; i <= comp.numLayers; i++) {
                var layer = comp.layer(i);
                if (!layer.audioEnabled) continue;

                var audioProp = layer.property("Audio Levels");
                if (!audioProp) continue;

                var exprText = "";
                try { exprText = (audioProp.expression || "").replace(/\s/g, ""); } catch (e) {}

                var matchesOurCtrl = false;
                for (var c = 0; c < controls.length; c++) {
                    if (exprText && exprText === ctrlSigs[controls[c].type]) {
                        matchesOurCtrl = true;
                        break;
                    }
                }

                if (!matchesOurCtrl) continue;

                // Bake expression to keyframes or static value
                try { bakeAudioLevelKeyframes(audioProp); } catch (e) {}

                // Remove the Base Level slider if present
                try {
                    var fx = layer.property("Effects");
                    if (fx && fx.property("Base Level")) fx.property("Base Level").remove();
                } catch (e) {}
            }

            // Clean up category sliders’ expressions (they reference Master)
            for (var c = 0; c < controls.length; c++) {
                try {
                    var catLayer = comp.layer(controls[c].nullName);
                    if (catLayer && catLayer.nullLayer) {
                        var s = catLayer.property("Effects").property(controls[c].sliderName);
                        if (s) {
                            var sp = s.property("Slider") || s;
                            sp.expression = "";
                            sp.expressionEnabled = false;
                        }
                    }
                } catch (e) {}
            }

            // Remove NULLs: categories then master
            for (var c = 0; c < controls.length; c++) {
                try {
                    var ctrlLayer = comp.layer(controls[c].nullName);
                    if (ctrlLayer && ctrlLayer.nullLayer) ctrlLayer.remove();
                } catch (e) {}
            }
            try {
                var masterLayer = comp.layer(master.nullName);
                if (masterLayer && masterLayer.nullLayer) masterLayer.remove();
            } catch (e) {}

            app.endUndoGroup();
        };

        panel.layout.layout(true);
        return panel;
    }

    // Build & show
    var myScriptPanel = buildUI(this);
    if (myScriptPanel instanceof Window) {
        myScriptPanel.center();
        myScriptPanel.show();
    }
}
