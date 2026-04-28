/**
 * main.js
 * Audio Mixing Desk — CEP panel JavaScript
 *
 * Bridges the HTML UI (index.html) with the ExtendScript host (hostscript.jsx)
 * via Adobe's CSInterface library.
 */

(function () {
    'use strict';

    // -------------------------------------------------------------------------
    // CSInterface bootstrap
    // -------------------------------------------------------------------------
    var cs = new CSInterface();

    // -------------------------------------------------------------------------
    // DOM references
    // -------------------------------------------------------------------------
    var sliders = {
        master: document.getElementById('masterSlider'),
        music:  document.getElementById('musicSlider'),
        vo:     document.getElementById('voSlider'),
        sfx:    document.getElementById('sfxSlider')
    };

    var valueDisplays = {
        master: document.getElementById('masterValue'),
        music:  document.getElementById('musicValue'),
        vo:     document.getElementById('voValue'),
        sfx:    document.getElementById('sfxValue')
    };

    var buttons = {
        setup: document.getElementById('setupBtn'),
        bake:  document.getElementById('bakeBtn')
    };

    var tagButtons = {
        overlay: document.getElementById('tagOverlayBtn'),
        vo:      document.getElementById('tagVOBtn'),
        sfx:     document.getElementById('tagSFXBtn'),
        music:   document.getElementById('tagMusicBtn'),
        clear:   document.getElementById('tagClearBtn')
    };

    var layerCounts = {
        music: document.getElementById('musicCount'),
        vo:    document.getElementById('voCount'),
        sfx:   document.getElementById('sfxCount')
    };

    var statusEl = document.getElementById('status');

    // -------------------------------------------------------------------------
    // Slider → AE null-layer mapping
    // -------------------------------------------------------------------------
    var sliderMap = {
        master: { nullName: 'Master Audio Control NULL', sliderName: 'Master Audio Control' },
        music:  { nullName: 'Music Control NULL',        sliderName: 'Music Control'        },
        vo:     { nullName: 'VO Control NULL',           sliderName: 'VO Control'           },
        sfx:    { nullName: 'SFX Control NULL',          sliderName: 'SFX Control'          }
    };

    // -------------------------------------------------------------------------
    // Utility helpers
    // -------------------------------------------------------------------------

    function setStatus(message, isActive) {
        statusEl.textContent = message;
        if (isActive) {
            statusEl.classList.add('active');
        } else {
            statusEl.classList.remove('active');
        }
    }

    function flashStatus(message, durationMs) {
        setStatus(message, true);
        setTimeout(function () { setStatus('Ready'); }, durationMs || 2500);
    }

    /**
     * Call an ExtendScript function by name and pass a JSON-safe args array.
     * The host functions return JSON strings; we parse and handle them here.
     *
     * @param {string}   fnName    – global function name in hostscript.jsx
     * @param {Array}    args      – arguments to pass (will be JSON-serialised)
     * @param {Function} onSuccess – callback(message) on { ok: true }
     * @param {Function} onError   – optional callback(message) on { ok: false }
     */
    function callHost(fnName, args, onSuccess, onError) {
        // Build the evalScript call string
        var argParts = (args || []).map(function (a) {
            return JSON.stringify(a);
        });
        var scriptStr = fnName + '(' + argParts.join(', ') + ')';

        cs.evalScript(scriptStr, function (result) {
            var parsed;
            try {
                parsed = JSON.parse(result);
            } catch (e) {
                parsed = { ok: false, message: result || 'Unknown error' };
            }

            if (parsed.ok) {
                if (typeof onSuccess === 'function') onSuccess(parsed);
            } else {
                var errMsg = parsed.message || 'An error occurred.';
                if (typeof onError === 'function') {
                    onError(errMsg);
                } else {
                    flashStatus('Error: ' + errMsg, 3500);
                }
            }
        });
    }

    // -------------------------------------------------------------------------
    // Slider change → push value to AE
    // -------------------------------------------------------------------------

    function onSliderChange(key) {
        var dbVal = parseFloat(sliders[key].value);

        // Update the numeric display
        valueDisplays[key].textContent = dbVal.toFixed(1);

        var map = sliderMap[key];
        callHost(
            'setSliderValue',
            [map.nullName, map.sliderName, dbVal],
            function () { /* silent success */ },
            function () { /* silent — controls may not be set up yet */ }
        );
    }

    Object.keys(sliders).forEach(function (key) {
        // Live update display
        sliders[key].addEventListener('input', function () {
            onSliderChange(key);
        });
        // Push to AE on mouse release
        sliders[key].addEventListener('change', function () {
            onSliderChange(key);
        });
    });

    // Initialise displays
    Object.keys(sliders).forEach(function (key) {
        valueDisplays[key].textContent = parseFloat(sliders[key].value).toFixed(1);
    });

    // -------------------------------------------------------------------------
    // Button → ExtendScript
    // -------------------------------------------------------------------------

    if (buttons.setup) {
        buttons.setup.addEventListener('click', function () {
            // Reset all sliders to 0 dB before setup
            Object.keys(sliders).forEach(function (key) {
                sliders[key].value = 0;
                valueDisplays[key].textContent = '0.0';
            });
            setStatus('Setting up audio controls…', true);
            callHost('setupAudioControls', [], function (res) {
                flashStatus(res.message);
            });
        });
    }

    if (buttons.bake) {
        buttons.bake.addEventListener('click', function () {
            setStatus('Baking & removing controls…', true);
            callHost('bakeRemoveAudioControls', [], function (res) {
                flashStatus(res.message);
            });
        });
    }

    // -------------------------------------------------------------------------
    // Tag dropdown → ExtendScript
    // -------------------------------------------------------------------------
    // Tag buttons → ExtendScript
    // -------------------------------------------------------------------------

    var tagMapping = {
        overlay: 1,
        vo:      2,
        sfx:     3,
        music:   4
    };

    Object.keys(tagMapping).forEach(function (tagKey) {
        var btn = tagButtons[tagKey];
        if (!btn) return;
        btn.addEventListener('click', function () {
            var idx = tagMapping[tagKey];
            var tagName = tagKey.toUpperCase();
            
            setStatus('Tagging selected layers as ' + tagName + '…', true);
            callHost(
                'applyTagByIndex',
                [idx],
                function (res) {
                    flashStatus(res.message, 3000);
                    refreshLayerCounts();
                },
                function (errMsg) {
                    flashStatus('Tag failed: ' + errMsg, 5000);
                }
            );
        });
    });

    if (tagButtons.clear) {
        tagButtons.clear.addEventListener('click', function () {
            setStatus('Clearing tags…', true);
            callHost(
                'clearTagSelectedLayers',
                [],
                function (res) {
                    flashStatus(res.message, 3000);
                    refreshLayerCounts();
                },
                function (errMsg) {
                    flashStatus('Clear failed: ' + errMsg, 5000);
                }
            );
        });
    }

    // -------------------------------------------------------------------------
    // Layer count badges — refresh on load and every 3 s
    // -------------------------------------------------------------------------

    function refreshLayerCounts() {
        cs.evalScript('getTaggedLayerCount()', function (result) {
            var parsed;
            try { parsed = JSON.parse(result); } catch (e) { return; }
            if (!parsed.ok) return;
            var c = parsed.counts || {};
            if (layerCounts.music) layerCounts.music.textContent = (c.music  || 0) + ' layers';
            if (layerCounts.vo)    layerCounts.vo.textContent    = (c.vo     || 0) + ' layers';
            if (layerCounts.sfx)  layerCounts.sfx.textContent   = (c.sfx    || 0) + ' layers';
        });
    }

    // Initial refresh + polling
    refreshLayerCounts();
    setInterval(refreshLayerCounts, 3000);

    // -------------------------------------------------------------------------
    // Initialise
    // -------------------------------------------------------------------------
    setStatus('Ready');

})();
