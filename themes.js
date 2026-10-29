/* Budgie themes: light, dark, a choice of colour, and a few special looks. */
(function () {
  var LIGHT = {bg: "#F3F5F8", card: "#FFFFFF", ink: "#17202B", muted: "#566273", line: "#DFE4EA", line2: "#EEF1F4", track: "#E7EBF0", good: "#1F6E47", warn: "#9A4A06", bad: "#A3271A", "accent-ink": "#FFFFFF", "hero-ink": "#FFFFFF",
    // each kind of money has its own colour everywhere it shows: coming in, bills, spending, saving (the same whatever the theme colour)
    "k-in": "#1F7A4D", "k-bill": "#6B4FBB", "k-spend": "#2369A8", "k-save": "#B07A12"};
  var DARK = {bg: "#0F141B", card: "#18202A", ink: "#E6ECF3", muted: "#A3B0BF", line: "#2A3542", line2: "#222C37", track: "#2A3542", good: "#6FD39C", warn: "#F2A766", bad: "#FF8A7A", "accent-ink": "#0C1724", "hero-ink": "#0C1724",
    "k-in": "#6FD39C", "k-bill": "#B8A3F2", "k-spend": "#7DB8EE", "k-save": "#EBC064"};
  var COLOURS = {
    blue: {name: "Blue", light: "#2E5E8C", dark: "#7FB0E0", softL: "#E3ECF5", softD: "#1E2D3D"},
    green: {name: "Green", light: "#2F7D6D", dark: "#6CC4AE", softL: "#E2F1ED", softD: "#1F3631"},
    purple: {name: "Purple", light: "#5E43A0", dark: "#B7A2E8", softL: "#ECE7F7", softD: "#2A2340"},
    orange: {name: "Orange", light: "#A84C08", dark: "#F2A766", softL: "#F8EBDF", softD: "#3A2A1C"},
    pink: {name: "Pink", light: "#A3346A", dark: "#F09BC2", softL: "#F7E5EE", softD: "#3A2130"},
    teal: {name: "Teal", light: "#00766E", dark: "#42D6C3", softL: "#DCF3EE", softD: "#123A34"},
    slate: {name: "Slate", light: "#3D4A5C", dark: "#AEB9C7", softL: "#E6E9EE", softD: "#262E39"}
  };
  var svg = function (s) { return "url(\"data:image/svg+xml," + encodeURIComponent(s) + "\")"; };
  var SPECIAL = {
    dreamland: {name: "Dreamland", note: "Inspired by Disenchantment: royal purple, gold and parchment",
      vars: {bg: "#F4EAD5", card: "#FFF8EA", ink: "#2B1B3D", muted: "#6A5878", line: "#E3D5B8", line2: "#EFE4CD", track: "#E8DCC3", accent: "#6B3FA0", "accent-ink": "#FFF8EA", soft: "#EDE1F3", hero: "#3E2465", "hero-ink": "#F5C451", good: "#2E6B3A", warn: "#8F4A00", bad: "#9E2626", "k-in": "#2E6B3A", "k-bill": "#8A3F8F", "k-spend": "#2F5E9E", "k-save": "#A8790A",
        font: "'Plus Jakarta Sans', system-ui, sans-serif", head: "'Fredoka', 'Plus Jakarta Sans', sans-serif", radius: "20px",
        pattern: svg("<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='#C9A64D' opacity='.22'><path d='M20 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z'/><path d='M84 66l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z'/><circle cx='60' cy='30' r='1.6'/><circle cx='100' cy='100' r='1.6'/><circle cx='30' cy='90' r='1.2'/></g></svg>")}},
    hunter: {name: "Monster hunter", note: "Inspired by The Witcher: dark steel, silver and amber",
      vars: {bg: "#121314", card: "#1C1E21", ink: "#E7E3DA", muted: "#A39E93", line: "#2E3136", line2: "#26292D", track: "#2E3136", accent: "#C9A24A", "accent-ink": "#121314", soft: "#2B2720", hero: "#3A1C18", "hero-ink": "#F0E6D2", good: "#8FC79A", warn: "#E3B067", bad: "#E07A6E", "k-in": "#8FC79A", "k-bill": "#B9A0D8", "k-spend": "#8FB4DD", "k-save": "#D9B45E",
        font: "'Plus Jakarta Sans', system-ui, sans-serif", head: "'Cinzel', Georgia, serif", radius: "10px",
        pattern: svg("<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><path d='M0 45h90M45 0v90' stroke='#FFFFFF' stroke-opacity='.025'/></svg>")}},
    dragon: {name: "Dragon rider", note: "Inspired by Fourth Wing: black, gold and dragon scales",
      vars: {bg: "#0C0C0E", card: "#19181B", ink: "#F6EEDC", muted: "#BFB39A", line: "#48402E", line2: "#302C25", track: "#353027", accent: "#E2BC61", "accent-ink": "#181205", soft: "#332C1D", hero: "#292215", "hero-ink": "#FFE3A0", good: "#7FE0AE", warn: "#E9C46A", bad: "#FF8F80", "k-in": "#7FE0AE", "k-bill": "#C4A8F0", "k-spend": "#8CC1F0", "k-save": "#E9C46A",
        font: "'Plus Jakarta Sans', system-ui, sans-serif", head: "'Cinzel', Georgia, serif", radius: "16px",
        pattern: svg("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><path d='M0 20a10 10 0 0 1 20 0M20 20a10 10 0 0 1 20 0M-10 10a10 10 0 0 1 20 0M10 10a10 10 0 0 1 20 0M30 10a10 10 0 0 1 20 0' fill='none' stroke='#E2BC61' stroke-opacity='.08'/></svg>")}}
  };
  SPECIAL.nebula = {"name":"Nebula","note":"Deep space, electric violet and distant stars","vars":{"bg":"#101024","card":"#1C1B35","ink":"#F0EEFF","muted":"#B9B4D7","line":"#3D375B","line2":"#2D2947","track":"#3D375B","accent":"#BCA1FF","accent-ink":"#190D36","soft":"#32264F","hero":"#34215C","hero-ink":"#F4EAFF","good":"#8ADBBE","warn":"#F3BC83","bad":"#FF9DAD","k-in":"#8ADBBE","k-bill":"#C9ADFF","k-spend":"#8ACBFF","k-save":"#F0D181","font":"'Plus Jakarta Sans', system-ui, sans-serif","head":"'Plus Jakarta Sans', system-ui, sans-serif","radius":"18px","pattern":"none"}};
  SPECIAL.hyperspace = {"name":"Hyperspace","note":"Inspired by Star Wars: midnight blue, starlight and blue sabres","vars":{"bg":"#080F1D","card":"#111F34","ink":"#EBF4FF","muted":"#A4BBD7","line":"#2D4566","line2":"#21334E","track":"#2B4264","accent":"#65C6FF","accent-ink":"#071725","soft":"#173653","hero":"#123F69","hero-ink":"#EBF8FF","good":"#87DBB5","warn":"#F5C46B","bad":"#FF9D97","k-in":"#87DBB5","k-bill":"#B6AFFF","k-spend":"#65C6FF","k-save":"#F5C46B","font":"'Plus Jakarta Sans', system-ui, sans-serif","head":"'Plus Jakarta Sans', system-ui, sans-serif","radius":"12px","pattern":"none"}};
  SPECIAL.winter = {"name":"Winter morning","note":"Snow, frosted pine and crisp blue skies","vars":{"bg":"#EDF5F8","card":"#FCFEFF","ink":"#173541","muted":"#4D6C78","line":"#CDDFE6","line2":"#E1EBEF","track":"#D9E6EC","accent":"#226C92","accent-ink":"#FFFFFF","soft":"#DCEEF5","hero":"#CDE7F0","hero-ink":"#153F53","good":"#20654A","warn":"#8A480D","bad":"#A52B32","k-in":"#20654A","k-bill":"#6A5196","k-spend":"#226C92","k-save":"#95600B","font":"'Plus Jakarta Sans', system-ui, sans-serif","head":"'Plus Jakarta Sans', system-ui, sans-serif","radius":"20px","pattern":"none"}};
  SPECIAL.nebula.vars.pattern = svg("<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><g fill='#BAA5F5' opacity='.12'><circle cx='18' cy='25' r='1'/><circle cx='92' cy='46' r='1.4'/><circle cx='54' cy='126' r='1'/><circle cx='142' cy='115' r='.7'/></g></svg>");
  SPECIAL.hyperspace.vars.pattern = svg("<svg xmlns='http://www.w3.org/2000/svg' width='180' height='160'><g stroke='#65C6FF' stroke-opacity='.08'><path d='M16 20l5 18M120 84l4 14M50 128l2 8M164 14l2 10'/></g></svg>");
  SPECIAL.winter.vars.pattern = svg("<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><g fill='#538CA1' opacity='.11'><circle cx='20' cy='18' r='1.5'/><circle cx='95' cy='70' r='2'/><circle cx='48' cy='112' r='1'/></g></svg>");
  function apply(t) {
    t = t || {};
    var mode = t.mode || "system", dark = mode === "dark" || (mode === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
    // (only the looks listed here: a setting typed as "constructor", say, is just an unknown look)
    var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; };
    var vars, sp = own(SPECIAL, t.special);
    if (sp) vars = Object.assign({}, sp.vars);
    else {
      var c = own(COLOURS, t.colour) || COLOURS.blue;
      vars = Object.assign({}, dark ? DARK : LIGHT, {accent: dark ? c.dark : c.light, soft: dark ? c.softD : c.softL, hero: dark ? c.dark : c.light,
        font: "'Plus Jakarta Sans', system-ui, sans-serif", head: "'Plus Jakarta Sans', system-ui, sans-serif", radius: "16px", pattern: "none"});
    }
    if (t.easy) { vars.font = "'Lexend', system-ui, sans-serif"; vars.head = "'Lexend', system-ui, sans-serif"; }
    vars.fs = ({small: "14px", normal: "15px", large: "17px", larger: "19px"})[t.size || "normal"] || "15px";
    var root = document.documentElement;
    Object.keys(vars).forEach(function (k) { root.style.setProperty("--" + k, vars[k]); });
    root.style.colorScheme = sp ? (sp.vars.bg < "#5" ? "dark" : "light") : (dark ? "dark" : "light");
    document.body.classList.toggle("easy", !!t.easy);
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", vars.bg);
  }
  window.BudgieThemes = {COLOURS: COLOURS, SPECIAL: SPECIAL, apply: apply};
})();
