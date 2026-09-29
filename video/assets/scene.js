// Shared helpers for the scenes. Timing data comes from assets/voice/timings.js.
(function () {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Scene-local time, in seconds, when the k-th spoken word matches.
  window.cue = function (n, word, k) {
    const scene = window.TIMINGS.scenes[n - 1];
    let seen = 0;
    for (const w of scene.words) {
      if (norm(w.w) === norm(word)) {
        if (seen === (k || 0)) return w.start;
        seen++;
      }
    }
    throw new Error("No spoken word '" + word + "' #" + (k || 0) + " in scene " + n);
  };

  // Split an element's text into one span for each character.
  window.chars = function (el) {
    const text = el.textContent;
    el.textContent = "";
    return [...text].map((ch) => {
      const s = document.createElement("span");
      s.textContent = ch;
      s.style.whiteSpace = "pre";
      el.appendChild(s);
      return s;
    });
  };

  // Type the characters of an element between t and t + dur.
  window.type = function (tl, el, t, dur) {
    const cs = window.chars(el);
    tl.fromTo(cs, { opacity: 0 }, { opacity: 1, duration: 0.01, stagger: dur / cs.length, ease: "none" }, t);
  };

  // Draw a rounded callout ring around a box, with a little pop.
  window.ring = function (tl, el, t) {
    tl.fromTo(el, { opacity: 0, scale: 1.18 }, { opacity: 1, scale: 1, duration: 0.35, ease: "back.out(2)" }, t);
  };

  // Move the cursor to x,y (pane coordinates) and click at tClick.
  window.click = function (tl, cur, x, y, tClick) {
    tl.to(cur, { x: x, y: y, duration: 0.9, ease: "power2.inOut" }, tClick - 1.1);
    tl.to(cur, { scale: 0.82, duration: 0.1, ease: "power1.in" }, tClick);
    tl.to(cur, { scale: 1, duration: 0.15, ease: "power1.out" }, tClick + 0.1);
  };

  // Move the cursor without a click.
  window.glide = function (tl, cur, x, y, t, d) {
    tl.to(cur, { x: x, y: y, duration: d || 0.7, ease: "power2.inOut" }, t);
  };

  window.CURSOR_SVG =
    '<svg viewBox="0 0 44 44" width="44" height="44"><path d="M6 3 L6 33 L14 26 L20 40 L27 37 L21 24 L32 24 Z" fill="#ffffff" stroke="#0a0a09" stroke-width="3" stroke-linejoin="round"/></svg>';
  window.TICK_SVG =
    '<svg viewBox="0 0 28 28"><path d="M5 15 L11.5 21 L23 8" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Fade the scene out at its end.
  window.leave = function (tl, n, sel) {
    const d = window.TIMINGS.scenes[n - 1].dur;
    tl.to(sel, { opacity: 0, duration: 0.3, ease: "power1.in" }, d - 0.32);
  };

  // Step dots: on = current step (1 to 6).
  window.dotsHTML = function (step) {
    let h = "";
    for (let i = 1; i <= 6; i++) h += '<div class="dot ' + (i < step ? "done" : i === step ? "on" : "") + '"></div>';
    return h;
  };

  // Position of an element inside a positioned ancestor, ignoring transforms.
  function rel(el, root) {
    let x = 0, y = 0, e = el;
    while (e && e !== root) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }
  window.rel = rel;

  // Put a focus ring exactly around a target, with the same padding on every side.
  // The ring and the target must share the same positioned ancestor (the stage).
  window.fit = function (ring, target, pad) {
    const p = pad === undefined ? 12 : pad;
    const r = rel(target, ring.offsetParent);
    ring.style.left = r.x - p + "px";
    ring.style.top = r.y - p + "px";
    ring.style.width = r.w + 2 * p + "px";
    ring.style.height = r.h + 2 * p + "px";
  };

  // Camera: pan and zoom a stage inside its viewport so that (cx, cy) is centered.
  window.VW = 1012;
  window.VH = 852;
  window.cam = function (tl, stage, cx, cy, s, t, d) {
    tl.to(stage, { x: window.VW / 2 - cx * s, y: window.VH / 2 - cy * s, scale: s, duration: d === undefined ? 1.1 : d, ease: "power2.inOut" }, t);
  };
  window.camSet = function (stage, cx, cy, s) {
    gsap.set(stage, { x: window.VW / 2 - cx * s, y: window.VH / 2 - cy * s, scale: s });
  };
  // Center of an element in stage coordinates.
  window.mid = function (el, stage) {
    const r = rel(el, stage);
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  // ---- 1Password-like UI pieces, drawn at 2x screen scale ----
  window.SSHKEY_SVG =
    '<svg viewBox="0 0 100 100" width="100%" height="100%"><rect x="8" y="6" width="74" height="70" rx="14" fill="#6b7480"/><rect x="14" y="12" width="62" height="56" rx="9" fill="#3e444d"/><path d="M28 30 L40 40 L28 50" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M46 52 H62" stroke="#fff" stroke-width="6" stroke-linecap="round"/><circle cx="26" cy="72" r="16" fill="#f4b73a"/><circle cx="22" cy="72" r="5" fill="#8a5b00"/><path d="M40 68 H88 V80 H80 V90 H70 V80 H40Z" fill="#f4b73a"/></svg>';
  window.GLOBE_SVG =
    '<svg viewBox="0 0 70 70" width="100%" height="100%"><circle cx="35" cy="35" r="26" fill="none" stroke="#fff" stroke-width="5"/><ellipse cx="35" cy="35" rx="12" ry="26" fill="none" stroke="#fff" stroke-width="5"/><path d="M9 35 H61 M14 20 H56 M14 50 H56" fill="none" stroke="#fff" stroke-width="4"/></svg>';

  // One line of absolutely placed text. y is the vertical center.
  window.T = function (id, x, y, txt, size, opt) {
    const o = opt || {};
    return '<div class="a" id="' + id + '" style="left:' + x + 'px;top:' + (y - size * 0.62) + 'px;font-size:' + size + 'px;line-height:' + size * 1.24 + 'px;' +
      (o.w ? "font-weight:" + o.w + ";" : "") + (o.c ? "color:" + o.c + ";" : "") + (o.mono ? "font-family:var(--mono);" : "") + (o.extra || "") + '">' + txt + "</div>";
  };
  // A box. Use for rows, tiles, buttons, fields. Set explicit sizes so rings fit exactly.
  window.B = function (id, x, y, w, h, style, inner) {
    return '<div class="a" id="' + id + '" style="left:' + x + "px;top:" + y + "px;width:" + w + "px;height:" + h + "px;" + (style || "") + '">' + (inner || "") + "</div>";
  };
  window.CHECK = function (id, x, y, on, size) {
    const z = size || 42;
    return window.B(id, x, y, z, z, "border-radius:" + z * 0.22 + "px;border:3px solid #8a8a8a;box-sizing:border-box;",
      '<div id="' + id + '-on" class="a" style="left:-3px;top:-3px;width:' + z + "px;height:" + z + "px;border-radius:" + z * 0.22 + "px;background:#1a6dff;opacity:" + (on ? 1 : 0) +
      ';display:flex;align-items:center;justify-content:center"><svg viewBox="0 0 28 28" width="' + z * 0.66 + '" height="' + z * 0.66 + '"><path d="M5 15 L11.5 21 L23 8" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>');
  };

  // The 1Password main window at 1920 x 1500. o: {vaults:[names], sel:name, items:[{t,s}], detail:html}
  window.mainWindow = function (p, o) {
    let h = "";
    h += window.B(p + "-mw", 0, 0, 1920, 1500, "background:#262626;border-radius:30px;overflow:hidden");
    h += window.B(p + "-side", 0, 0, 486, 1500, "background:#20262d;border-right:2px solid #15191e");
    h += window.B(p + "-topbar", 486, 0, 1434, 138, "background:#262626;border-bottom:2px solid #171717");
    [["red", 50], ["#f6c443", 94], ["#3ac24b", 138]].forEach(function (c, i) {
      h += window.B(p + "-l" + i, c[1] - 14, 34, 28, 28, "border-radius:50%;background:" + (c[0] === "red" ? "#ff5f57" : c[0]) + ";");
    });
    h += window.B(p + "-avatar", 30, 118, 56, 56, "border-radius:50%;background:#c9a58c;border:3px solid #e8d3c4;box-sizing:border-box");
    h += window.T(p + "-acct", 112, 148, "Your Name", 32, {});
    h += window.B(p + "-div", 0, 208, 486, 2, "background:#3a4048");
    const rows = [["Profile", 275, "#2f7cf6"], ["All Items", 378, "#8f9aa6"], ["Favorites", 459, "#f28c28"], ["Watchtower", 541, "#9aa4ae"], ["Developer", 622, "#38b6a8"]];
    rows.forEach(function (r) {
      h += window.B(p + "-ic-" + r[0], 78, r[1] - 17, 34, 34, "border-radius:8px;background:" + r[2]);
      h += window.T(p + "-r-" + r[0], 124, r[1], r[0], 32, {});
    });
    h += window.T(p + "-vh", 122, 728, "VAULTS", 27, { w: 700, c: "#b8bec6" });
    h += window.B(p + "-plus", 396, 700, 56, 56, "border-radius:14px;font-size:44px;line-height:52px;text-align:center;color:#d8dde3", "+");
    const vs = o.vaults || [];
    vs.forEach(function (v, i) {
      const y = 806 + i * 84;
      h += window.B(p + "-vsel" + i, 60, y - 40, 372, 80, "border-radius:14px;background:#4a4e54;opacity:" + (v.name === o.sel ? 1 : 0));
      h += window.B(p + "-vi" + i, 78, y - 20, 40, 40, "border-radius:50%;background:" + (v.color || "#8fa0b4") + ";overflow:hidden", v.globe ? '<div style="width:100%;height:100%;padding:6px;box-sizing:border-box">' + window.GLOBE_SVG + "</div>" : "");
      h += window.T(p + "-vn" + i, 132, y, v.name, 32, { extra: "" });
    });
    h += window.T(p + "-tags", 122, 806 + vs.length * 84 + 60, "TAGS", 27, { w: 700, c: "#b8bec6" });
    h += window.T(p + "-arch", 122, 1360, "Archive", 32, {});
    h += window.T(p + "-del", 122, 1440, "Recently Deleted", 32, {});
    // top bar
    h += window.B(p + "-search", 592, 58, 962, 54, "border-radius:14px;border:2px solid #8a8a8a;box-sizing:border-box");
    h += window.T(p + "-searcht", 660, 86, "Search in Your Name", 32, { c: "#d0d0d0" });
    h += window.T(p + "-help", 1620, 86, "Help", 32, { c: "#8ab4ff" });
    h += window.B(p + "-newitem", 1720, 58, 180, 56, "border-radius:12px;background:#0a6cf5;text-align:center;line-height:56px;font-size:32px;font-weight:600", "+ New Item");
    // list pane
    h += window.T(p + "-cat", 566, 190, "All Categories", 32, {});
    h += window.B(p + "-vline", 1345, 138, 2, 1362, "background:#171717");
    (o.items || []).forEach(function (it, i) {
      const y = 290 + i * 118;
      if (i === o.hi) h += window.B(p + "-li" + i, 510, y - 14, 815, 104, "border-radius:16px;background:#333");
      h += window.B(p + "-lic" + i, 540, y, 70, 70, "border-radius:14px;background:" + (it.c || "#5a6470"), it.icon || "");
      h += window.T(p + "-lit" + i, 640, y + 18, it.t, 36, { w: 600 });
      h += window.T(p + "-lis" + i, 640, y + 68, it.s || "", 28, { c: "#a0a0a0" });
    });
    if (o.empty) h += window.T(p + "-empty", 926, 790, o.empty, 32, { c: "#c8c8c8", extra: "transform:translateX(-50%)" });
    h += window.B(p + "-detail", 1347, 138, 573, 1362, "", o.detail || "");
    return h;
  };

  // Left copy column, step dots, and the window entrance. Returns nothing; adds tweens.
  window.intro = function (tl, n, step, title, sub, opt) {
    const o = opt || {};
    const c = document.getElementById("s" + n + "-copy");
    c.innerHTML =
      '<div class="eyebrow" id="s' + n + '-eb">' + (o.eyebrow || "Step " + step + " of 6") + "</div>" +
      '<h1 class="h1" id="s' + n + '-h1">' + title + "</h1>" +
      (sub ? '<p class="sub" id="s' + n + '-sub">' + sub + "</p>" : "");
    const d = document.getElementById("s" + n + "-dots");
    if (d) d.innerHTML = window.dotsHTML(step);
    tl.fromTo("#s" + n + "-eb", { opacity: 0, x: -50 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, 0.05);
    tl.fromTo("#s" + n + "-h1", { opacity: 0, y: 36 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" }, 0.15);
    if (sub) tl.fromTo("#s" + n + "-sub", { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.5, ease: "power2.out" }, 0.3);
    if (d) tl.fromTo(d, { opacity: 0 }, { opacity: 1, duration: 0.4 }, 0.4);
    tl.fromTo("#s" + n + "-win", { x: 170 }, { x: 0, duration: 0.6, ease: "power3.out" }, 0);
  };

  window.CURSOR_BIG =
    '<svg viewBox="0 0 44 44" width="64" height="64"><path d="M6 3 L6 33 L14 26 L20 40 L27 37 L21 24 L32 24 Z" fill="#ffffff" stroke="#0a0a09" stroke-width="3" stroke-linejoin="round"/></svg>';

  // Build a scene after the fonts are loaded, so that measured sizes are exact.
  window.build = function (fn) {
    const fam = ['32px "Atkinson Hyperlegible Next"', '700 32px "Atkinson Hyperlegible Next"', '32px "Atkinson Hyperlegible Mono"'];
    Promise.all(fam.map(function (f) { return document.fonts.load(f); })).then(function () { return document.fonts.ready; }).then(fn, fn);
  };

  // Make a scene host measurable while it is being built. Returns a function that undoes it.
  window.unhide = function (n) {
    const h = document.getElementById("s" + n);
    h.style.setProperty("display", "block", "important");
    h.style.setProperty("visibility", "visible", "important");
    return function () { h.style.removeProperty("display"); h.style.removeProperty("visibility"); };
  };
})();
