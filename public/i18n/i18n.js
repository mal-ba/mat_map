/* Jjin Matjip i18n runtime.
   Loaded via <script src="/i18n/i18n.js" defer></script> on every page.
   - Reads saved language from localStorage ("jjin_lang").
   - Fetches /i18n/lang/<lang>.json and applies it to every element carrying
     data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-alt /
     data-i18n-aria-label / data-i18n-value attributes (added by extract-i18n.js).
   - Falls back to the original Korean text when a key or language is missing.
   - Draws a small floating language switcher in the bottom-right corner on
     every page, so switching language works everywhere without editing
     each page's markup.
*/
(function () {
  "use strict";

  var STORAGE_KEY = "jjin_lang";
  var DEFAULT_LANG = "ko";

  var LANGUAGES = [
    { code: "ko",    label: "한국어" },
    { code: "en",    label: "English" },
    { code: "en-NZ", label: "English (NZ)" },
    { code: "ru",    label: "Русский" },
    { code: "zh",    label: "中文" },
    { code: "ja",    label: "日本語" },
    { code: "fr",    label: "Français" },
    { code: "de",    label: "Deutsch" },
    { code: "pl",    label: "Polski" },
    { code: "it",    label: "Italiano" },
    { code: "es-AR", label: "Español (AR)" },
    { code: "es-MX", label: "Español (MX)" },
    { code: "mn",    label: "Монгол" },
    { code: "vi",    label: "Tiếng Việt" },
    { code: "hi",    label: "हिन्दी" },
    { code: "pt-BR", label: "Português (BR)" },
    { code: "ar",    label: "العربية" }
  ];

  var RTL_LANGS = { ar: true };

  function getSavedLang() {
    try {
      return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch (e) {
      return DEFAULT_LANG;
    }
  }

  function saveLang(lang) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      /* ignore (private browsing etc.) */
    }
  }

  function applyDocumentDirection(lang) {
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute(
      "dir",
      RTL_LANGS[lang] ? "rtl" : "ltr"
    );
  }

  function applyDict(dict) {
    if (!dict) return;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (dict[key] != null) el.textContent = dict[key];
    });

    var attrMap = {
      "data-i18n-placeholder": "placeholder",
      "data-i18n-title": "title",
      "data-i18n-alt": "alt",
      "data-i18n-aria-label": "aria-label",
      "data-i18n-value": "value"
    };

    Object.keys(attrMap).forEach(function (dataAttr) {
      var targetAttr = attrMap[dataAttr];
      document.querySelectorAll("[" + dataAttr + "]").forEach(function (el) {
        var key = el.getAttribute(dataAttr);
        if (dict[key] != null) el.setAttribute(targetAttr, dict[key]);
      });
    });
  }

  function loadAndApply(lang) {
    applyDocumentDirection(lang);

    if (lang === "ko") {
      // Page's own markup is already Korean (the source language) —
      // nothing to fetch, just make sure any earlier translation is
      // reverted by re-reading the original text we cached on first run.
      restoreOriginal();
      return Promise.resolve();
    }

    cacheOriginalOnce();

    return fetch("/i18n/lang/" + lang + ".json", { cache: "no-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("i18n fetch failed: " + res.status);
        return res.json();
      })
      .then(function (dict) {
        applyDict(dict);
      })
      .catch(function (err) {
        console.warn("[i18n] falling back to Korean:", err);
        restoreOriginal();
      });
  }

  // Cache the original Korean text/attributes the first time we switch away
  // from Korean, so we can restore them exactly if the user switches back
  // or a fetch fails, without needing a ko.json round-trip.
  var ORIGINAL_CACHED = false;
  function cacheOriginalOnce() {
    if (ORIGINAL_CACHED) return;
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.setAttribute("data-i18n-orig", el.textContent);
    });
    [
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-title", "title"],
      ["data-i18n-alt", "alt"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-value", "value"]
    ].forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "]").forEach(function (el) {
        el.setAttribute(pair[0] + "-orig", el.getAttribute(pair[1]) || "");
      });
    });
    ORIGINAL_CACHED = true;
  }

  function restoreOriginal() {
    document.querySelectorAll("[data-i18n-orig]").forEach(function (el) {
      el.textContent = el.getAttribute("data-i18n-orig");
    });
    [
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-title", "title"],
      ["data-i18n-alt", "alt"],
      ["data-i18n-aria-label", "aria-label"],
      ["data-i18n-value", "value"]
    ].forEach(function (pair) {
      document.querySelectorAll("[" + pair[0] + "-orig]").forEach(function (el) {
        el.setAttribute(pair[1], el.getAttribute(pair[0] + "-orig"));
      });
    });
  }

  function buildSwitcher() {
    var wrap = document.createElement("div");
    wrap.id = "jjin-i18n-switcher";
    wrap.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483000",
      "font-family:system-ui,-apple-system,'Malgun Gothic',sans-serif",
      "font-size:13px"
    ].join(";");

    var select = document.createElement("select");
    select.setAttribute("aria-label", "Language / 언어 선택");
    select.style.cssText = [
      "padding:6px 8px",
      "border-radius:8px",
      "border:1px solid #d0d0d0",
      "background:#ffffff",
      "box-shadow:0 1px 4px rgba(0,0,0,0.15)",
      "max-width:150px"
    ].join(";");

    LANGUAGES.forEach(function (l) {
      var opt = document.createElement("option");
      opt.value = l.code;
      opt.textContent = l.label;
      select.appendChild(opt);
    });

    select.value = getSavedLang();
    select.addEventListener("change", function () {
      var lang = select.value;
      saveLang(lang);
      loadAndApply(lang);
    });

    wrap.appendChild(select);
    document.body.appendChild(wrap);
  }

  function init() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", init);
      return;
    }
    buildSwitcher();
    loadAndApply(getSavedLang());
  }

  init();
})();
