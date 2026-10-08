document.addEventListener('DOMContentLoaded', () => {
  // Translations
  const translations = {
    en: {
      appName: "Loudillys",
      volumeLabel: "Volume",
      speedLabel: "Speed"
    },
    pt: {
      appName: "Loudillys",
      volumeLabel: "Volume",
      speedLabel: "Velocidade"
    },
    es: {
      appName: "Loudillys",
      volumeLabel: "Volumen",
      speedLabel: "Velocidad"
    }
  };

  const langSelect = document.getElementById('langSelect');

  // Determine language
  let currentLang = localStorage.getItem('vb_lang') || navigator.language.split('-')[0];
  if (!translations[currentLang]) currentLang = 'en';

  langSelect.value = currentLang;

  const updateTexts = (lang) => {
    const t = translations[lang];
    document.getElementById('appName').textContent = t.appName;
    document.getElementById('volumeLabel').textContent = t.volumeLabel;
    document.getElementById('speedLabel').textContent = t.speedLabel;
    return t;
  };

  let t = updateTexts(currentLang);

  langSelect.addEventListener('change', () => {
    currentLang = langSelect.value;
    localStorage.setItem('vb_lang', currentLang);
    t = updateTexts(currentLang);
  });

  const volumeSlider = document.getElementById('volumeSlider');
  const speedSlider = document.getElementById('speedSlider');
  const volumeValue = document.getElementById('volumeValue');
  const speedValue = document.getElementById('speedValue');

  // Sync settings from active tab
  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          if (window.VolumeBooster && window.VolumeBooster.getSettings) {
            return window.VolumeBooster.getSettings();
          }
          return null;
        }
      });

      // Find the first frame that returned valid settings
      const validResult = results.find(r => r.result && (r.result.volume !== undefined || r.result.speed !== undefined));
      const settings = validResult ? validResult.result : null;

      if (settings) {
        if (settings.volume !== undefined) {
          volumeSlider.value = settings.volume;
          // Round volume to 1 decimal place (e.g. 2.7)
          volumeValue.textContent = `${Number(settings.volume).toFixed(1)}x`;
        }
        if (settings.speed !== undefined) {
          speedSlider.value = settings.speed;
          // Round speed to up to 2 decimal places and remove trailing zeros (e.g. 1.25, 1)
          speedValue.textContent = `${Number(Number(settings.speed).toFixed(2))}x`;
        }
      }
    } catch (e) {
      console.error("Failed to sync settings:", e);
    }
  })();

  const applySettings = async (volume, speed) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) return;

    try {
      // 1. Check if VolumeBooster is already loaded, inject if not
      const checkResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => !!window.VolumeBooster
      });

      const needsInjection = !checkResults.some(r => r.result === true);

      if (needsInjection) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ['content.js']
        });
      }

      // 2. Execute the update function in ALL frames
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: (v, s) => {
          if (window.VolumeBooster) {
            window.VolumeBooster.update(v, s);
          }
        },
        args: [volume, speed]
      });

    } catch (err) {
      console.error(err);
    }
  };

  let applyTimeout = null;
  const debouncedApplySettings = (volume, speed) => {
    if (applyTimeout) clearTimeout(applyTimeout);
    applyTimeout = setTimeout(() => {
      applySettings(volume, speed);
    }, 40);
  };

  // Update display values and apply settings on slider move
  volumeSlider.addEventListener('input', () => {
    volumeValue.textContent = `${volumeSlider.value}x`;
    debouncedApplySettings(parseFloat(volumeSlider.value), null);
  });

  speedSlider.addEventListener('input', () => {
    speedValue.textContent = `${speedSlider.value}x`;
    debouncedApplySettings(null, parseFloat(speedSlider.value));
  });

  const applyBtn = document.getElementById('applyBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', () => {
      const volume = parseFloat(volumeSlider.value);
      const speed = parseFloat(speedSlider.value);
      applySettings(volume, speed);
    });
  }
});
