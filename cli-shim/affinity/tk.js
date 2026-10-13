// Quire — Affinity build toolkit.
//
// Adopted wholesale from the user's LENS 01 toolkit rather than rewritten: every
// comment in here records an SDK trap found by probing the real application
// (units are document px not points, Selection is not exported, faces must be
// chosen by traitsName, Inside_AtBack inserts at the front). Re-deriving that
// from scratch would have meant rediscovering all of it the hard way.
//
// Changed from the original: everything issue-specific — asset paths, the act
// map, palette and type — now comes from globalThis.TK_CFG, so one toolkit
// serves every issue instead of being copied per magazine.
//
// eval'd fresh by every execute_script call; API hangs off globalThis.TK.
(function () {
  const { app } = require('/application');
  const { Rectangle, Transform, CurveBuilder, PolyCurve } = require('/geometry');
  const { ShapeNodeDefinition, FrameTextNodeDefinition, ImageNodeDefinition,
          PolyCurveNodeDefinition, AddNoiseFilterRasterNodeDefinition,
          VignetteFilterRasterNodeDefinition } = require('/nodes');
  const { Shape, ShapeType, ShapeRectangle, ShapeEllipse, ShapeFloatParam, ShapeEnumParam,
          ShapeBoolParam, ShapeCornerType } = require('/shapes');
  const { AddChildNodesCommandBuilder, DocumentCommand, InsertionMode,
          NodeMoveType, NodeChildType } = require('/commands');
  const { Colour, RGBAuf, Gradient } = require('/colours');
  const { FillDescriptor, BlendMode, GradientFill, GradientFillType } = require('/fills');
  const { Selection } = require('/selections');
  const { StoryBuilder, RasterFormat } = require('/storybuilder');
  const { ParagraphAlignXType, ParagraphLeadingType } = require('/paragraphatts');
  const { CapsType } = require('/glyphatts');
  const { FontFamily } = require('/fonts');
  const { Bitmap } = require('/rasterobject');
  const { File } = require('/fs');

  // app.documents.current is READ-ONLY â€” it follows the active window, so a
  // background build must set globalThis.TK_DOC before eval'ing this file.
  const doc = globalThis.TK_DOC || app.documents.current;
  const DPI = doc.dpi, MM = v => v * DPI / 25.4, PT = v => v * DPI / 72;
  const SPREADS = doc.spreads.toArray();
  // Affinity's Desktop is OneDrive-redirected on this machine, so never hardcode
  // it — app.userDesktopPath is the only path the File API will actually read.
  const CFG = globalThis.TK_CFG || {};
  const SEP = "\\";
  const ROOT = CFG.root || (app.userDesktopPath + SEP);
  const IMG = CFG.img || (ROOT + "_assets" + SEP);
  const TEXT = CFG.text || (ROOT + "pages" + SEP);

  // ---- palette (v2 â€” DESATURATED) -----------------------------------------
  // The first v2 spreads read as "too loud and still dull": three fully
  // saturated primaries across huge fields, with nothing to look at inside them.
  // NONE of the reference spreads do that. r10 is dusty teal on cream with one
  // orange; r4 is olive, khaki and dull gold; r1 is cream, black and a single
  // brick red; r11 keeps a bone ground ~80% quiet with small accents.
  //
  // So: FIELD tones are muted and carry the large areas. SPOT tones keep their
  // saturation and are reserved for small marks only (see law 4 rev 2 â€” a full
  // -strength primary may not exceed ~2,000mmÂ²).
  const C = {
    bone:  '#F4F1EA',   // 60% â€” the ground for most spreads
    ink:   '#14161C',   // 30% â€” act openers, covers
    // FIELD tones â€” for anything larger than a hand
    pR: '#B8453A', pG: '#3E7A5E', pB: '#33587A',
    // SPOT tones â€” small marks only, where saturation is allowed to sing
    sR: '#E23A2E', sG: '#2FA46B', sB: '#2F6BE0',
    // per-act single accent (field strength)
    actLight: '#33587A', actStuff: '#B8453A', actFeel: '#B98A42',
    // extra grounds so a dark spread isn't always the same near-black
    olive: '#5F604C', slate: '#2A3038', cream: '#EDE7D6', clay: '#8C5A44',
    // inks
    inkSoft: '#3A3D45', inkFaint: '#6E7076', line: '#C9CACD',
    onDark: '#F4F1EA', onDarkSoft: '#C9CACD', onDarkFaint: '#8B8D93', onDarkLine: '#3A3D45',
    grey: '#9B9DA2', shell: '#E3E2DE'
  };
  // ---- the design decision, when one has been made -------------------------
  // A spec that has been decided and approved outranks the constants above one
  // atom at a time. Anything it does not name keeps the default, so a thin spec
  // degrades to the house look rather than to an unstyled page.
  //
  // ponytail: the grid is NOT taken from the spec. live() and the column maths
  // assume 174mm across 6 columns and 53 baselines; changing that is a real
  // refactor, not a substitution. Wire it when a publication needs a different
  // measure, and read SPEC.grid there.
  var SPEC = CFG.spec || null;
  var hex6 = function (v) {
    return (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())) ? v.trim() : null;
  };
  if (SPEC && SPEC.palette) {
    var SP = SPEC.palette;
    if (hex6(SP.paper)) { C.bone = C.cream = C.onDark = hex6(SP.paper); }
    if (hex6(SP.ink)) { C.ink = C.slate = hex6(SP.ink); }
    if (hex6(SP.accent)) { C.actLight = C.actStuff = C.actFeel = C.clay = hex6(SP.accent); }
  }

  // Section boundaries come from the issue's own flatplan, not a fixed
  // three-act map — an issue may have two sections or nine, and the section is
  // what decides a page's colour world and folio tint.
  const SECTIONS = CFG.sections || [];
  // One accent speaks for the whole issue (13 rev. A). When the design has
  // chosen one, every section's tint is that colour; the wheel of seven is
  // what an issue with no decided accent still falls back to.
  const ACCENT = SPEC && SPEC.palette ? hex6(SPEC.palette.accent) : null;
  const WHEEL = ACCENT ? [ACCENT] : [C.actLight, C.actStuff, C.actFeel, C.pG, C.clay, C.slate, C.olive];
  const ACT = Object.fromEntries(SECTIONS.map((s, i) => [s.n, WHEEL[i % WHEEL.length]]));
  function actOf(P) { const s = SECTIONS.find((x) => P >= x.from && P <= x.to); return s ? s.n : 0; }
  function tint(P) { return ACT[actOf(P)] || C.inkFaint; }

  // ---- type ---------------------------------------------------------------
  // Checked on this machine: Archivo / Archivo Black / Source Serif absent.
  // Bahnschrift carries the display voice, Georgia the reading voice.
  // v2. Bahnschrift + Segoe UI are UI faces with no editorial voice â€” they were
  // the whole reason v1 read as a slide deck. Bodoni MT turns out to carry ELEVEN
  // faces here including Black@900 and Poster Compressed, so the display voice is
  // a real didone. Lora is the reading face (density measured at 0.019 w/mmÂ²),
  // Franklin Gothic the label/mid-loud voice.
  const F = { disp: 'Bodoni MT',                  // SHOUT + ELEGANT + POSTER
              brutal: 'Haettenschweiler',         // heavy condensed, stacked titles
              body: 'Lora',
              sans: 'Franklin Gothic Book',       // labels
              sansMed: 'Franklin Gothic Medium',
              cond: 'Franklin Gothic Demi Cond',  // MID-LOUD pull quotes
              hand: 'Segoe Script',               // curved-leader annotation only
              get ser() { return this.body; } };
  const FACE = { disp: 'Black', dispReg: 'Regular', dispIt: 'Italic',
                 poster: 'Poster Compressed',     // NEVER select this by weight
                 brutal: 'Regular', cond: 'Regular',
                 sansSemi: 'Regular', dispWide: 'Bold' };

  // Faces the spec asked for, if this machine has them. A named font that is
  // not installed is dropped back to the default rather than thrown, because a
  // missing typeface should cost a typeface and not a whole issue.
  // Font preflight: a face the spec names and this machine lacks is said, not
  // swallowed, so the page's findings show what it was set in instead.
  const MISSING = [];
  if (SPEC && SPEC.type) {
    var have = function (name) {
      if (typeof name !== 'string' || !name.trim()) return null;
      var found = false;
      try { found = !!FontFamily.all.find(function (x) { return x.name === name.trim(); }); } catch (e) {}
      if (!found) MISSING.push(name.trim());
      return found ? name.trim() : null;
    };
    var disp = have(SPEC.type.display), bodyFace = have(SPEC.type.text);
    if (disp) { F.disp = disp; FACE.disp = 'Bold'; FACE.dispReg = 'Regular'; FACE.dispIt = 'Italic'; }
    if (bodyFace) { F.body = bodyFace; }
  }

  function col(h, a) {
    const c = new RGBAuf();
    c.r = parseInt(h.slice(1, 3), 16) / 255;
    c.g = parseInt(h.slice(3, 5), 16) / 255;
    c.b = parseInt(h.slice(5, 7), 16) / 255;
    c.alpha = (a === undefined ? 1 : a);
    return Colour.createRGBAuf(c);
  }

  // Faces are chosen by traitsName. Matching on isBold/isItalic returns the FIRST
  // face in family order, which for many families is a condensed poster cut.
  const FC = {};
  function font(fam, bold, ital, traits) {
    const key = fam + '|' + (traits || '') + '|' + (bold ? 1 : 0) + (ital ? 1 : 0);
    if (FC[key]) return FC[key];
    const family = FontFamily.all.find(x => x.name === fam);
    if (!family) throw new Error('missing font family: ' + fam);
    const list = [...family.fonts];
    const byTraits = t => list.find(f => f.traitsName === t);
    let f = null;
    if (traits) f = byTraits(traits);
    if (!f) f = byTraits(bold && ital ? 'Bold Italic' : bold ? 'Bold' : ital ? 'Italic' : 'Regular');
    if (!f) {
      const ok = list.filter(x => !!x.isBold === !!bold && !!x.isItalic === !!ital && !x.isCondensed);
      f = ok.find(x => x.isNormal) || ok.find(x => x.weight === 400) || ok[0]
        || list.find(x => x.isNormal) || list[0];
    }
    return FC[key] = f;
  }

  // ---- page geometry ------------------------------------------------------
  // Trim 210 x 297, facing, p1 alone on spread 0 => 33 spreads for 64pp.
  // Margins: head 18 / foot 26.6 / outer 16 / inner 20 (incl. 5mm binding).
  // Baseline = 13.5pt = 4.7625mm, the body leading, so every block snaps to the
  // rhythm instead of being nudged by eye. Live height = 53 baselines.
  const BASE = 13.5 * 25.4 / 72;             // 4.7625 mm
  const LINES = 53;
  const Y0 = 18, Y1 = Y0 + BASE * LINES;     // 18 .. 270.41
  function pg(P) {
    if (P === 1) return { si: 0, ox: 0, recto: true };
    const si = Math.floor(P / 2), v = (P % 2 === 0);
    return { si, ox: v ? 0 : 210, recto: !v };
  }
  function live(P) {
    const g = pg(P), x0 = g.recto ? 20 : 16;
    return { x0, x1: x0 + 174, y0: Y0, y1: Y1, w: 174, h: Y1 - Y0, recto: g.recto };
  }
  // 6 columns per page: 6 x 25.6667 + 5 x 4 = 174 exactly. 12 across the spread.
  const NCOL = 6, COLW = 25.6667, GUT = 4;
  function gx(P, c) { return live(P).x0 + c * (COLW + GUT); }
  function gw(n) { return n * COLW + (n - 1) * GUT; }
  function bl(n) { return Y0 + n * BASE; }
  function lines(mm) { return Math.round(mm / BASE); }
  const W_FULL = gw(6), W_TWOTHIRD = gw(4), W_HALF = gw(3), W_THIRD = gw(2);

  function useSpread(P) {
    const s = SPREADS[pg(P).si];
    if (!doc.currentSpread.isSameNode(s)) doc.executeCommand(DocumentCommand.createSetCurrentSpread(s));
    return s;
  }
  // In a spread's layer list index 0 is the BACK, last index is the FRONT.
  // InsertionMode.Inside_AtBack silently inserts at the FRONT instead, so the
  // reliable send-to-back is a moveNodes(..., Before, ...) after adding.
  function toBack(n, s) {
    const cur = s.layers.toArray();
    const first = cur.find(x => !x.isSameNode(n));
    if (!first) return n;
    doc.executeCommand(DocumentCommand.createMoveNodes(
      Selection.create(doc, n), first, NodeMoveType.Before, NodeChildType.Main));
    return n;
  }
  // Guides are the one API that does NOT take document units: addGuide wants
  // pixels96, so at 300 dpi a 20mm guide is 20/25.4*96, not 20/25.4*300.
  const PX96 = v => v * 96 / 25.4;                 // mm -> pixels96
  function guideV(mm) { doc.addGuide(false, PX96(mm)); }
  function guideH(mm) { doc.addGuide(true, PX96(mm)); }
  /** Draw the live grid for page P as real guides: both edges of every column,
   *  plus the head and foot of the text block. Same numbers gx()/bl() build to,
   *  so a guide that does not line up means the layout is off the grid. */
  function guides(P) {
    const L = live(P);
    for (let c = 0; c < NCOL; c++) { guideV(gx(P, c)); guideV(gx(P, c) + COLW); }
    guideH(L.y0); guideH(L.y1);
  }

  // The master shows up in every spread's layer list as an ordinary sibling,
  // and it arrives at the FRONT — so the first opaque full-page ground drawn on
  // a page hides the running head, folio and rules the master provides. This is
  // the opposite of the interface, where masters sit at the bottom.
  const masterSpread = () => doc.rootNode.getFirstChild(NodeChildType.MasterSpread);
  const masterInstance = (s) => s.layers.toArray().find(n => n.constructor.name === "PhysicalNode");
  /** Put the master instance behind everything on this page's spread. */
  function masterToBack(P) {
    const s = useSpread(P);
    const mi = masterInstance(s);
    if (mi) toBack(mi, s);
    return mi;
  }
  /** Put the master instance directly in front of one node — used to reveal
   *  furniture over a ground while keeping it under the page's own type. */
  function masterAbove(P, node) {
    const s = useSpread(P);
    const mi = masterInstance(s);
    if (mi) doc.executeCommand(DocumentCommand.createMoveNodes(
      Selection.create(doc, mi), node, NodeMoveType.After, NodeChildType.Main));
    return mi;
  }

  function add(P, def, tag, atBack) {
    const s = useSpread(P);
    const b = AddChildNodesCommandBuilder.create();
    b.setInsertionTarget(s); b.addNode(def);
    doc.executeCommand(b.createCommand());
    const l = s.layers.toArray();
    const n = l[l.length - 1];
    if (tag) n.userDescription = tag;
    if (atBack) toBack(n, s);
    return n;
  }
  function paint(n, f, s, w, blend) {
    const sel = Selection.create(doc, n);
    doc.setBrushFillDescriptor(
      f ? FillDescriptor.createSolid(f, blend) : FillDescriptor.createNone(), sel);
    doc.setPenFillDescriptor(s ? FillDescriptor.createSolid(s) : FillDescriptor.createNone(), sel);
    if (w) doc.setLineWeightPts(w, sel);
  }
  function rot(n, deg) {
    const b = n.getSpreadBaseBox(false);
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = deg * Math.PI / 180;
    doc.applyTransform(Transform.createTranslate(cx, cy)
      .multiply(Transform.createRotate(r)).multiply(Transform.createTranslate(-cx, -cy)), n);
    return n;
  }

  // ---- primitives ---------------------------------------------------------
  function shp(P, x, y, w, h, sh, o) {
    o = o || {}; const g = pg(P);
    const d = ShapeNodeDefinition.createDefault();
    d.setShape(sh);
    d.setBoundingRectangle(new Rectangle(MM(g.ox + x), MM(y), MM(Math.max(w, .05)), MM(Math.max(h, .05))));
    const n = add(P, d, o.tag, o.atBack);
    paint(n, o.fill ? col(o.fill, o.alpha) : null,
             o.stroke ? col(o.stroke, o.strokeAlpha) : null, o.weight, o.blend);
    if (o.rot) rot(n, o.rot);
    return n;
  }
  function rect(P, x, y, w, h, o) {
    o = o || {};
    const n = shp(P, x, y, w, h, ShapeRectangle.create(), o);
    if (o.corners) {
      const sel = Selection.create(doc, n);
      doc.setShapeBoolParam(ShapeBoolParam.Rectangle_SingleRadius, false, sel);
      const R = { tl: 'TopLeft', tr: 'TopRight', bl: 'BottomLeft', br: 'BottomRight' };
      for (const k in o.corners) {
        doc.setShapeEnumParam(ShapeEnumParam['Rectangle_' + R[k] + 'CornerType'], ShapeCornerType.Round, sel);
        doc.setShapeFloatParam(ShapeFloatParam['Rectangle_' + R[k] + 'Radius'], MM(o.corners[k]), sel);
      }
    }
    return n;
  }
  function circle(P, cx, cy, dia, o) {
    return shp(P, cx - dia / 2, cy - dia / 2, dia, dia, ShapeEllipse.create(), o);
  }
  function ring(P, cx, cy, dia, o) {
    o = Object.assign({ stroke: C.ink, weight: .3 }, o || {}); o.fill = null;
    return circle(P, cx, cy, dia, o);
  }
  function dot(P, cx, cy, dia, o) { return circle(P, cx, cy, dia, Object.assign({ fill: C.ink }, o || {})); }
  function hr(P, x, y, w, o) {
    o = Object.assign({ fill: C.line }, o || {});
    return rect(P, x, y, w, o.t || .25, o);
  }
  function vr(P, x, y, h, o) {
    o = Object.assign({ fill: C.line }, o || {});
    return rect(P, x, y, o.t || .25, h, o);
  }
  function line(P, x1, y1, x2, y2, o) {
    o = Object.assign({ fill: C.ink }, o || {});
    const dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy), t = o.t || .25;
    const n = rect(P, (x1 + x2) / 2 - L / 2, (y1 + y2) / 2 - t / 2, L, t, o);
    if (dy !== 0) rot(n, Math.atan2(dy, dx) * 180 / Math.PI);
    return n;
  }

  // ---- vector curves ------------------------------------------------------
  // CurveBuilder.bulgeToXY is NOT_IMPLEMENTED; smooth curves come from a
  // Catmull-Rom spline converted to cubics: c1 = p1+(p2-p0)/6, c2 = p2-(p3-p1)/6
  function curveNode(P, curve, o) {
    o = o || {};
    const pc = PolyCurve.create(); pc.addCurve(curve);
    const d = PolyCurveNodeDefinition.createDefault(); d.setCurves(pc);
    const n = add(P, d, o.tag);
    paint(n, o.fill ? col(o.fill, o.alpha) : null,
             o.stroke ? col(o.stroke, o.strokeAlpha) : null, o.weight, o.blend);
    if (o.atBack) toBack(n, SPREADS[pg(P).si]);
    return n;
  }
  function buildSmooth(P, pts, closed) {
    const g = pg(P), n = pts.length, cb = CurveBuilder.create();
    const X = i => MM(g.ox + pts[i][0]), Y = i => MM(pts[i][1]);
    const at = i => closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
    cb.beginXY(X(0), Y(0));
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p0 = pts[at(i - 1)], p1 = pts[at(i)], p2 = pts[at(i + 1)], p3 = pts[at(i + 2)];
      cb.addBezierXY(
        MM(g.ox + p1[0] + (p2[0] - p0[0]) / 6), MM(p1[1] + (p2[1] - p0[1]) / 6),
        MM(g.ox + p2[0] - (p3[0] - p1[0]) / 6), MM(p2[1] - (p3[1] - p1[1]) / 6),
        MM(g.ox + p2[0]), MM(p2[1]));
    }
    if (closed) cb.close();
    return cb.createCurve();
  }
  function smooth(P, pts, o) { return curveNode(P, buildSmooth(P, pts, false), o); }
  function blob(P, pts, o) { return curveNode(P, buildSmooth(P, pts, true), o); }
  function polyline(P, pts, o) {
    const g = pg(P), cb = CurveBuilder.create();
    cb.beginXY(MM(g.ox + pts[0][0]), MM(pts[0][1]));
    for (let i = 1; i < pts.length; i++) cb.lineToXY(MM(g.ox + pts[i][0]), MM(pts[i][1]));
    if (!o || o.close !== false) cb.close();
    return curveNode(P, cb.createCurve(), o);
  }

  // ---- THE MOTIF ----------------------------------------------------------
  // A beam: a quad from (x0,y0) with width w0, running `deg` below horizontal
  // for `len` mm, ending at width w1 â€” filled with a gradient that fades to
  // transparent ALONG the beam axis, screen-blended over the Ink ground so
  // overlaps brighten the way real light does.
  //
  // Rev 1 stacked constant-alpha polygons instead, and the render showed why
  // that fails: hard steps, and the white beam read as a grey tube rather than
  // as light. Gradient recipe (verified): scaleWithObject MUST be false and the
  // transform must be supplied explicitly in spread coordinates â€” an identity
  // transform renders the fill completely invisible, with no error.
  function gradFill(n, hex, a0, a1, x0, y0, deg, len, blend) {
    const r = deg * Math.PI / 180;
    const g = Gradient.create([
      { position: 0, midpoint: .5, smoothness: 0, colour: col(hex, a0) },
      { position: 1, midpoint: .5, smoothness: 0, colour: col(hex, a1) }
    ]);
    const tf = Transform.createTranslate(x0, y0)
      .multiply(Transform.createRotate(r))
      .multiply(Transform.createScale(len, len));
    const fd = FillDescriptor.create(
      GradientFill.create(g, GradientFillType.Linear), false, tf,
      blend === undefined ? BlendMode.Screen : blend, false);
    doc.setBrushFillDescriptor(fd, Selection.create(doc, n));
    return n;
  }
  // Multi-stop version: stops = [[position 0..1, '#hex', alpha], ...]. Used for
  // the spectrum ribbon, which is one node instead of sixty thin rectangles.
  function gradMulti(n, stops, x0, y0, deg, len, blend) {
    const r = (deg || 0) * Math.PI / 180;
    const g = Gradient.create(stops.map(s => ({
      position: s[0], midpoint: .5, smoothness: 0,
      colour: col(s[1], s[2] === undefined ? 1 : s[2])
    })));
    const tf = Transform.createTranslate(x0, y0)
      .multiply(Transform.createRotate(r))
      .multiply(Transform.createScale(len, len));
    doc.setBrushFillDescriptor(FillDescriptor.create(
      GradientFill.create(g, GradientFillType.Linear), false, tf,
      blend === undefined ? BlendMode.Normal : blend, false),
      Selection.create(doc, n));
    return n;
  }
  function beam(P, x0, y0, deg, len, w0, w1, colour, o) {
    o = o || {};
    const g = pg(P);
    const r = deg * Math.PI / 180, dx = Math.cos(r), dy = Math.sin(r);
    const nx = -dy, ny = dx;                       // unit normal
    const quad = [
      [x0 + nx * w0 / 2,               y0 + ny * w0 / 2],
      [x0 + dx * len + nx * w1 / 2,    y0 + dy * len + ny * w1 / 2],
      [x0 + dx * len - nx * w1 / 2,    y0 + dy * len - ny * w1 / 2],
      [x0 - nx * w0 / 2,               y0 - ny * w0 / 2]
    ];
    const n = polyline(P, quad, { tag: o.tag || 'beam', atBack: o.atBack });
    return gradFill(n, colour,
      o.alpha === undefined ? .85 : o.alpha,
      o.alphaEnd === undefined ? 0 : o.alphaEnd,
      MM(g.ox + x0), MM(y0), deg, MM(len * (o.reach || 1)), o.blend);
  }

  // The issue's signature: a three-line R/G/B rule, the motif at its quietest.
  // Every spread carries it EXCEPT where the content already contains a real
  // beam-split (p.4 ribbon, p.12 sensor, p.22 lantern, p.34 prism) â€” doubling
  // the motif there is noise.
  function tripleRule(P, x, y, w, o) {
    o = o || {};
    const gap = o.gap || 1.5, t = o.t || .4 * 25.4 / 72;
    [C.pR, C.pG, C.pB].forEach((c, i) =>
      rect(P, x, y + i * gap, w, t, { fill: c, alpha: o.alpha || .85,
        tag: (o.tag || 'rule') + '-' + i }));
  }

  // A sine whose PERIOD changes along its length â€” the only honest way to draw
  // "colour is a wavelength": long lazy waves at the red end, tight quick ones
  // at the violet end. Stroked open path, not a fill.
  function wave(P, x0, y0, w, amp, p0, p1, o) {
    o = o || {};
    const pts = [], N = o.samples || 240;
    let phase = 0;
    for (let i = 0; i <= N; i++) {
      const f = i / N, x = x0 + w * f;
      const period = p0 + (p1 - p0) * f;           // mm per cycle at this point
      phase += (w / N) / period * Math.PI * 2;
      pts.push([x, y0 + Math.sin(phase) * amp]);
    }
    const g = pg(P), cb = CurveBuilder.create();
    cb.beginXY(MM(g.ox + pts[0][0]), MM(pts[0][1]));
    for (let i = 1; i < pts.length; i++) cb.lineToXY(MM(g.ox + pts[i][0]), MM(pts[i][1]));
    return curveNode(P, cb.createCurve(), {
      stroke: o.stroke || C.bone, strokeAlpha: o.alpha, weight: o.weight || .6, tag: o.tag });
  }

  // ---- text ---------------------------------------------------------------
  function buildStory(runs, o) {
    o = o || {};
    const sb = StoryBuilder.create();
    sb.setToFrameTextDefaultStyle(DPI, RasterFormat.RGBA8);
    const setPa = (v) => {
      const pa = sb.paragraphAtts;
      pa.alignXType = ParagraphAlignXType[v.align || o.align || 'Left'];
      pa.leadingType = ParagraphLeadingType.ExactlyAbsolute;
      pa.absoluteLeading = PT(v.lead || o.lead || 13.5);
      // the frame-text default style carries spaceAfter = 12pt; zero it or every
      // line gap silently inflates.
      pa.spaceBefore = PT(v.space === undefined ? (o.space || 0) : v.space);
      pa.spaceAfter = PT(v.spaceAfter === undefined ? (o.spaceAfter || 0) : v.spaceAfter);
      pa.firstLineIndent = MM(v.indent === undefined ? (o.indent || 0) : v.indent);
      const hy = v.hyph === undefined ? o.hyph : v.hyph;
      pa.isAutoHyphenate = !!hy;
      if (hy) { pa.hyphenateMinLength = 6; pa.hyphenateMinPrefix = 3; pa.hyphenateMinSuffix = 3; pa.maxConsecutiveHyphens = 2; }
      pa.isPreventWidows = true; pa.isPreventOrphans = true;
      sb.setParagraphAtts(pa);
    };
    setPa({});
    for (const r0 of runs) {
      if (r0.pa) { setPa(r0.pa); continue; }
      if (r0.br) { sb.addParagraphBreak(); continue; }
      const r = o.runStyle ? Object.assign({}, o.runStyle, r0) : r0;
      const ga = sb.glyphAtts;
      ga.height = PT(r.size || 9.5);
      ga.font = font(r.fam || F.body, r.bold, r.ital, r.face);
      ga.brushFill = FillDescriptor.createSolid(col(r.color || C.ink, r.alpha));
      ga.capsType = r.caps ? CapsType.AllCaps : CapsType.None;
      ga.characterSpacing = r.track || 0;
      sb.setGlyphAtts(ga);
      sb.addText(r.t);
    }
    return sb;
  }
  function text(P, x, y, w, h, runs, o) {
    o = o || {}; const g = pg(P);
    // letterspacing adds a trailing sidebearing, so centred tracked caps sit
    // right of centre; pull them back by half a track.
    let dx = 0;
    if (o.trackFix && (o.align === 'Centre')) dx = -o.trackFix * 25.4 / 72 / 2;
    const td = FrameTextNodeDefinition.createFromStoryBuilder(
      new Rectangle(MM(g.ox + x + dx), MM(y), MM(w), MM(h)), buildStory(runs, o));
    return add(P, td, o.tag);
  }
  // lineBox.height only exceeds baseBox.height on overset â€” an overflow flag,
  // not a text-height measure.
  // Tolerance must be >= 2 document units: a frame that fits perfectly still
  // reports ~0.54 units of float noise between the two boxes, and a tighter
  // bound reports correct text as overset.
  function overflows(n) { return n.lineBox.height > n.baseBox.height + 2.0; }

  function label(P, x, y, w, t, o) {
    o = o || {};
    const size = o.size || 7.5, track = o.track === undefined ? .1 : o.track;
    return text(P, x, y, w, o.h || 6, [{ t, fam: o.fam || F.sans, size,
      color: o.color || C.inkFaint, caps: o.caps !== false, track, face: o.face }],
      { align: o.align || 'Left', lead: o.lead || size * 1.35, tag: o.tag,
        trackFix: track * size });
  }

  // ---- images -------------------------------------------------------------
  // Place a generated PNG (see build/comfy.ps1) at x,y,w,h in mm. The image is
  // scaled to COVER the box and centred, so the box always fills â€” an image
  // letterboxed inside its own frame is what makes a page look assembled rather
  // than designed. Affinity can only read from the Desktop, hence IMG.
  //   ImageNodeDefinition.create(path) â€” takes a plain path string.
  function img(P, x, y, w, h, file, o) {
    o = o || {}; const g = pg(P);
    const path = /[\\/]/.test(file) ? file : IMG + file;
    // ImageNodeDefinition.create() takes a BITMAP, not a path. Handing it a path
    // string does NOT throw - it silently yields a node whose imageResourceInterface
    // is an empty 5-byte TIFF with no file path, and renders as nothing at all.
    const bmp = Bitmap.loadFromFile(path);
    const d = ImageNodeDefinition.create(bmp);
    // AND setBitmap() explicitly. create(bmp) leaves d.bitmap looking correct but
    // the added node still comes out 1x1 with an empty 5-byte TIFF resource;
    // calling setBitmap after create is what actually binds the pixels.
    d.setBitmap(bmp);
    const n = add(P, d, o.tag, o.atBack);
    // native size, then fit into the target box.
    // Cover overflows the box on every side and nothing here clips it — which
    // is exactly right for a full-bleed page and exactly wrong for an image
    // banded above body copy, where the overflow paints over the type. So a
    // banded image asks for contain and gets the whole picture inside the box.
    const b = n.getSpreadBaseBox(false);
    const iw = b.width, ih = b.height;
    const tw = MM(w), th = MM(h);
    const s = o.contain ? Math.min(tw / iw, th / ih) : Math.max(tw / iw, th / ih);
    // valign 'bottom': a contained picture stands on the foot of its box (a bird on its floor).
    const cx = MM(g.ox + x) + tw / 2, cy = o.valign === 'bottom' ? MM(y) + th - (ih * s) / 2 : MM(y) + th / 2;
    doc.applyTransform(
      Transform.createTranslate(cx, cy)
        .multiply(Transform.createScale(s, s))
        .multiply(Transform.createTranslate(-(b.x + iw / 2), -(b.y + ih / 2))), n);
    if (o.opacity !== undefined) doc.executeCommand(
      DocumentCommand.createSetOpacity(o.opacity, Selection.create(doc, n)));
    if (o.blend) doc.executeCommand(
      DocumentCommand.createSetBlendMode(o.blend, Selection.create(doc, n)));
    // A covering picture is cut to its box: an empty rectangle at the box, the
    // picture moved inside it, clips it (a shape clips its children). Unclipped,
    // a 0.5 picture covering an 81 mm side column was laid 148 mm wide, over the
    // body (Birds p14). The rectangle carries the tag, so the layout report reads
    // the frame that was planned.
    if (!o.contain) {
      const frame = rect(P, x, y, w, h, { fill: null, tag: o.tag });
      if (o.tag) n.userDescription = o.tag + '-pic';
      doc.executeCommand(DocumentCommand.createMoveNodes(
        Selection.create(doc, n), frame, NodeMoveType.Inside, NodeChildType.Main));
      if (o.atBack) toBack(frame, useSpread(P));
      return frame;
    }
    return n;
  }

  // A cutout (08 §5): an alpha picture, whole and unframed, on the outer edge
  // of the live area. Returns its box in page mm so the caller can step the
  // text round it — the script API cannot create a text wrap.
  function cutout(P, y, w, h, file, o) {
    const L = live(P), g = pg(P);
    const n = img(P, L.recto ? L.x1 - w : L.x0, y, w, h, file, Object.assign({}, o || {}, { contain: true }));
    const b = n.getSpreadBaseBox(false), k = 25.4 / DPI;
    return { node: n, x: b.x * k - g.ox, y: b.y * k, w: b.width * k, h: b.height * k };
  }

  // The painted ground's grain on a flat shape: the shape's fill becomes a repeating tile of
  // its own colour with that grain baked in (shim postprocess colourGrain). A bitmap fill,
  // not an overlay layer: an Overlay image did not blend and covered the page in grey.
  // `g` = { tiles: { "#rrggbb": file }, px, mm }: a tile `px` wide is laid `mm` wide.
  function texture(n, hex, g) {
    if (!g || !g.tiles || !n || !hex) return false;
    const file = g.tiles[String(hex).toLowerCase()];
    if (!file) return false;
    const { BitmapFill, RasterExtendType, RasterResamplerType } = require('/fills');
    const bmp = Bitmap.loadFromFile(file);
    // The fill transform maps the WHOLE bitmap onto a unit square (as a gradient's does), so the
    // scale is the tile's size on the page, not the size of one of its pixels: at px-per-unit
    // the 512 px tile collapsed to one sample and every shape rendered as its flat average.
    // Halved because Affinity samples a bitmap fill a mip level down (2 px blocks at the
    // picture's scale): measured on a render, at half scale the tile's grain matches the
    // placed picture's at 1, 2, 4 and 8 px (sd 5.4 vs 5.5, neighbour correlation .30 vs .32).
    const k = MM(g.mm) * 0.5;
    const rs = ['Bilinear', 'Bicubic', 'Lanczos3', 'NearestNeighbour', 'Nearest'].map(function (k) { return RasterResamplerType[k]; }).find(function (v) { return v !== undefined; });
    const f = BitmapFill.create(bmp, RasterExtendType.Wrap, rs, false); // Wrap tiles; Repeat smears the edge pixel
    doc.setBrushFillDescriptor(FillDescriptor.create(f, false, Transform.createScale(k, k), BlendMode.Normal, true), Selection.create(doc, n));
    // A bitmap fill has no colour to read back: the layer name carries it, so Ochin Shape can
    // turn the field into a panel of the same colour (ochin-shape-tool.js ownFill).
    try { if (!n.userDescription) n.userDescription = 'Field ' + String(hex).toUpperCase(); } catch (e) { /* unnamed */ }
    return true;
  }

  // Where a plate lands in the shape that holds it, in page mm: whole in the shape's body
  // (below an arch's round top), standing on its foot. With the subject measured, the
  // subject is fitted rather than the picture: the plate's own ground is the shape's colour,
  // so the crop cannot be seen, and a cut edge of the subject goes to the shape's edge.
  // `k` is mm per picture pixel, which the grain tiles are laid at so speckle matches speckle.
  function plateFit(s, o) {
    const pw = o.size[0], ph = o.size[1];
    const top = s.s === 'poly' ? s.y + s.w * 0.25 : s.y, bw = s.w, bh = s.y + s.h - top;
    const sub = o.subject && o.subject.length === 4 ? o.subject : [0, 0, 1, 1], cut = o.cut || [];
    const fit = o.subject && o.subject.length === 4;
    const mx = fit ? (sub[2] - sub[0]) * .08 : 0, my = fit ? (sub[3] - sub[1]) * .08 : 0;
    const L = cut.indexOf('left') >= 0 ? 0 : Math.max(0, sub[0] - mx), R = cut.indexOf('right') >= 0 ? 1 : Math.min(1, sub[2] + mx);
    const T0 = cut.indexOf('top') >= 0 ? 0 : Math.max(0, sub[1] - my), B0 = cut.indexOf('bottom') >= 0 ? 1 : Math.min(1, sub[3] + my);
    const k = Math.min(bw / ((R - L) * pw), bh / ((B0 - T0) * ph));
    const W = pw * k, H = ph * k;
    const x = cut.indexOf('right') >= 0 ? s.x + bw - W : cut.indexOf('left') >= 0 ? s.x : s.x + bw / 2 - (L + R) / 2 * W;
    return { x: x, y: top + bh - B0 * H, w: W, h: H, k: k };
  }

  // A picture kept with its painted ground, held inside a drawn shape (an arch, a band):
  // the shape is filled with the ground's own colour and grain, the picture placed by
  // plateFit and clipped by the shape, so the plate's edge disappears into the shape.
  function held(P, s, pal, file, o) {
    o = o || {};
    const fill = pal[s.fill] || null;
    const n = s.s === 'poly' && s.pts && s.pts.length > 2
      ? polyline(P, s.pts, { tag: o.tag, fill: fill, alpha: 1 })
      : rect(P, s.x, s.y, s.w, s.h, Object.assign({ tag: o.tag, fill: fill }, s.r ? { corners: { tl: s.r, tr: s.r, bl: s.r, br: s.r } } : {}));
    texture(n, fill, o.grain);
    const f = plateFit(s, o);
    const pic = img(P, f.x, f.y, f.w, f.h, file, { contain: true });
    if (o.tag) pic.userDescription = o.tag + '-pic';
    doc.executeCommand(DocumentCommand.createMoveNodes(Selection.create(doc, pic), n, NodeMoveType.Inside, NodeChildType.Main));
    return n;
  }

  // A kit pattern behind the type, faint (07 §1b: ≤ 20 %).
  function pattern(P, x, y, w, h, file, opacity, o) {
    return img(P, x, y, w, h, file, Object.assign({}, o || {}, { atBack: true, opacity: Math.min(opacity || 0.16, 0.2) }));
  }

  // ---- v2 primitives ------------------------------------------------------
  // FPO placeholder. There is NO image generation in this SDK build (verified:
  // /ai, /generativeai, /imagegen all fail to resolve; the only "diffuse" nodes
  // are blur filters). Drawing the subject out of vector primitives instead is
  // what made v1 worse than an empty frame â€” so illustration is FPO until real
  // art arrives, and the frame carries the brief an illustrator can work from.
  // It occupies the hero's FULL intended area; a small placeholder beside filler
  // graphics is the v1 mistake in a new hat.
  function ph(P, x, y, w, h, slug, brief, o) {
    o = o || {};
    const ac = o.accent || C.pB, tg = o.tag || ('ph-' + slug);
    rect(P, x, y, w, h, { fill: ac, alpha: o.alpha === undefined ? .04 : o.alpha,
                          stroke: ac, strokeAlpha: .55, weight: .5, tag: tg });
    // corner-to-corner diagonals + registration cross: the standard FPO marks.
    // Without them a large empty frame reads as a void or a bug; with them it
    // reads as a plate deliberately held for art.
    line(P, x, y, x + w, y + h, { fill: ac, alpha: .22, t: .3, tag: tg + '-d1' });
    line(P, x + w, y, x, y + h, { fill: ac, alpha: .22, t: .3, tag: tg + '-d2' });
    const cx = x + w / 2, cy = y + h / 2;
    circle(P, cx, cy, 26, { fill: o.void || C.bone, stroke: ac, strokeAlpha: .4, weight: .4, tag: tg + '-x3' });
    line(P, cx - 5, cy, cx + 5, cy, { fill: ac, alpha: .6, t: .4, tag: tg + '-x1' });
    line(P, cx, cy - 5, cx, cy + 5, { fill: ac, alpha: .6, t: .4, tag: tg + '-x2' });
    // a placeholder that bleeds off the trim would otherwise put its own label in
    // the bleed and render it clipped â€” keep marks inside the live page
    const lx = Math.max(x + 6, 8);
    label(P, lx, Math.max(y + 5, 8), x + w - lx - 6, 'PICTURE · ' + slug,
      { size: 7, color: ac, track: .12, tag: tg + '-lab' });
    // brief sits centred under the cross, on a scrim, so it is actually readable
    // as art direction rather than stranded in a corner
    if (brief) {
      const bw = Math.min(w - 24, 104), bx = cx - bw / 2;
      rect(P, bx - 5, cy + 17, bw + 10, 30, { fill: o.void || C.bone, alpha: .82, tag: tg + '-bsc' });
      text(P, bx, cy + 20, bw, 26,
        [{ t: brief, fam: F.body, ital: true, size: 6.5, color: ac, alpha: .95 }],
        { align: 'Left', lead: 9, tag: tg + '-brief' });
    }
    label(P, x + w - 62, y + h - 10, 56, Math.round(w) + ' × ' + Math.round(h) + ' MM',
      { size: 6, color: ac, align: 'Right', track: .1, tag: tg + '-dim' });
    return tg;
  }

  // r1's corner brackets â€” the series glue. Repeated DEVICES are what make two
  // very different layouts read as one magazine; repeated layout is what made
  // v1 boring.
  function brackets(P, o) {
    o = o || {};
    const ins = o.inset === undefined ? 14 : o.inset, a = o.arm || 22,
          t = o.weight || 1.2, c = o.fill || C.ink, al = o.alpha === undefined ? .8 : o.alpha,
          tg = o.tag || 'brk', L = 3, R = 417, T = 3, B = 294;
    const put = (x, y, dx, dy, i) => {
      line(P, x, y, x + dx * a, y, { fill: c, alpha: al, t: t / 2.83, tag: tg + i + 'h' });
      line(P, x, y, x, y + dy * a, { fill: c, alpha: al, t: t / 2.83, tag: tg + i + 'v' });
    };
    put(L + ins, T + ins,  1,  1, 0);
    put(R - ins, T + ins, -1,  1, 1);
    if (o.top) return;                       // foot framed by something else
    put(L + ins, B - ins,  1, -1, 2);
    put(R - ins, B - ins, -1, -1, 3);
  }

  // kill() switches the current spread per deletion, so pass the pages a script
  // owns rather than walking all 33 spreads (that alone can exceed the timeout).
  function kill(prefix, pages) {
    let c = 0;
    let list = SPREADS;
    if (pages && pages.length) {
      const seen = {}; list = [];
      for (const p of pages) { const i = pg(p).si; if (!seen[i]) { seen[i] = 1; list.push(SPREADS[i]); } }
    }
    for (const s of list) for (const n of s.layers.toArray()) {
      const d = n.userDescription;
      if (d && d.indexOf(prefix) === 0) {
        if (!doc.currentSpread.isSameNode(s)) doc.executeCommand(DocumentCommand.createSetCurrentSpread(s));
        // one node refusing to delete must not abort a whole rebuild
        try { n.delete(); c++; } catch (e) { try { n.userDescription = 'dead-' + d; } catch (e2) {} }
      }
    }
    return c;
  }
  function tags(P) {
    return SPREADS[pg(P).si].layers.toArray().map(n => n.userDescription).filter(x => x);
  }

  // ---- connection language (13 rev. A) -----------------------------------
  // The brand's visual signature: a page says which page it is tied to, beside
  // its folio, in the accent — a short rule and "→ p.14".
  function linkNote(P, to, o) {
    o = o || {};
    const L = live(P), colour = o.color || tint(P);
    const x = L.recto ? L.x1 - 52 : L.x0 + 22;
    hr(P, L.recto ? x + 4 : x, 279.5, 8, { fill: colour, t: .35, tag: o.tag });
    return text(P, L.recto ? x - 20 : x + 10, 277, 30, 6,
      // Back to an earlier page points back: p14's '→ p.13' sent the reader forward to it.
      [{ t: (Number(to) < P ? '← p.' : '→ p.') + to, fam: F.sans, size: 8, color: colour }],
      { tag: o.tag, align: L.recto ? 'Right' : 'Left' });
  }

  // The Map: the issue's whole web on one spread (or one page). The centre in
  // the middle, each ring a node around it with the pages that look through it,
  // a spoke to each, and a thin line wherever two rings are tied by a page.
  // `web` = { centre, rings: [{ name, pages: [n] }], pairs: [[i, j]], accent }.
  function webMap(P, web, o) {
    o = o || {};
    const spread = P % 2 === 0 && o.spread !== false;
    const L = live(P), colour = web.accent || tint(P);
    const cx = spread ? 210 : L.x0 + L.w / 2, cy = 168;
    const rx = spread ? 150 : 70, ry = 82;
    const n = Math.max(web.rings.length, 1);
    const at = web.rings.map(function (_, i) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
    (web.pairs || []).forEach(function (p) {
      const a = at[p[0]], b = at[p[1]];
      if (a && b) line(P, a.x, a.y, b.x, b.y, { fill: C.line, t: .25, tag: o.tag });
    });
    at.forEach(function (pt) { line(P, cx, cy, pt.x, pt.y, { fill: colour, t: .4, tag: o.tag }); });
    circle(P, cx, cy, 40, { fill: C.bone, stroke: colour, weight: 1.2, tag: o.tag });
    text(P, cx - 19, cy - 7, 38, 16,
      [{ t: web.centre, fam: F.disp, face: FACE.dispReg, size: 13, color: C.ink }],
      { tag: o.tag, align: 'Centre', lead: 14 });
    web.rings.forEach(function (ring, i) {
      const pt = at[i];
      dot(P, pt.x, pt.y, 5, { fill: colour, tag: o.tag });
      label(P, pt.x - 28, pt.y + 4, 56, ring.name, { align: 'Centre', color: C.ink, tag: o.tag });
      if (ring.pages.length) {
        text(P, pt.x - 28, pt.y + 10, 56, 6,
          [{ t: ring.pages.map(function (p) { return 'p.' + p; }).join('  '), fam: F.sans, size: 7.5, color: colour }],
          { tag: o.tag, align: 'Centre' });
      }
    });
  }

  // ---- the block grid (Phase 5, core page-blocks.ts gridOf) ----------------
  // Symmetric margins, the spec's columns and baseline. The per-type layouts
  // above keep the house grid; only a page built from blocks uses this one.
  function blockGrid() {
    const g = (SPEC && SPEC.grid) || {};
    const pos = (v, d) => (typeof v === 'number' && v > 0 ? v : d);
    const cols = Math.round(pos(g.columns, 12)), gut = pos(g.gutterMm, 4), m = pos(g.marginMm, 14), base = pos(g.baselineMm, 4.7625);
    const rows = Math.floor((297 - 2 * m - 10) / base);
    const colw = (210 - 2 * m - (cols - 1) * gut) / cols;
    return { x0: m, x1: 210 - m, top: m, foot: m + rows * base, cols, gut, colw, base, rows };
  }

  // The largest size at which runs(size) sits in the box on as few lines as
  // the box allows: a wordmark across its measure, a figure in its rows.
  // Overset is the only measure the SDK gives, so it is a search on it.
  function fitText(P, x, y, w, h, runs, lo, hi, o) {
    o = o || {};
    let best = lo;
    for (let i = 0; i < 9 && hi - lo > 0.5; i++) {
      const mid = (lo + hi) / 2;
      const probe = text(P, x, y, w, h, runs(mid), { tag: 'mag-probe', lead: mid * (o.lead || .9), align: o.align });
      const over = overflows(probe);
      kill('mag-probe', [P]);
      if (over) hi = mid; else { best = mid; lo = mid; }
    }
    return { size: best, node: text(P, x, y, w, h, runs(best), { tag: o.tag, lead: best * (o.lead || .9), align: o.align }) };
  }

  // Drawn art (Phase 8, the vector kit): thirteen generators, chosen by a
  // section's art style, seeded so the same page draws the same picture and
  // every position comes from the seed - the folio test drew three hills in
  // the same places on every page. Lines stop at the box and short of any
  // type that sits on the art (`quiet`): the SDK gives no clipping.
  // Kinds combine with "+" ("contours+rain"). One small mark in the accent at
  // most: the accent is the issue's loudest colour and must stay scarce.
  const GENERATORS = ['contours', 'rain', 'rings', 'flow', 'hatch', 'halftone', 'burst', 'spiral', 'hex', 'tri', 'voronoi', 'blobs', 'bauhaus'];
  function drawn(P, x, y, w, h, o) {
    o = o || {};
    let seed = (o.seed || 7) | 0;
    const rnd = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const R = (a, b) => a + rnd() * (b - a);
    const kinds = String(o.kind || 'contours').split('+').filter((k) => GENERATORS.indexOf(k) >= 0);
    if (!kinds.length) kinds.push('contours');
    const tag = o.artTag || o.tag, ink = o.line || C.ink, mark = o.mark;
    rect(P, x, y, w, h, { fill: o.field || C.bone, tag: o.tag });
    const quiet = o.quiet || [];
    const inBox = (p) => p[0] >= x && p[0] <= x + w && p[1] >= y && p[1] <= y + h;
    const inQuiet = (p) => quiet.some((q) => p[0] >= q.x && p[0] <= q.x + q.w && p[1] >= q.y && p[1] <= q.y + q.h);
    const ok = (p) => inBox(p) && !inQuiet(p);
    const cut = (a, b) => {            // where a (inside) -> b (outside the box) leaves it
      let t = 1;
      if (b[0] < x) t = Math.min(t, (x - a[0]) / (b[0] - a[0]));
      if (b[0] > x + w) t = Math.min(t, (x + w - a[0]) / (b[0] - a[0]));
      if (b[1] < y) t = Math.min(t, (y - a[1]) / (b[1] - a[1]));
      if (b[1] > y + h) t = Math.min(t, (y + h - a[1]) / (b[1] - a[1]));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    let budget = 900;                    // nodes: a page is drawn in seconds, not minutes
    const stroke = (pts, alpha, weight, colour, curved) => {
      let run = [];
      const flush = () => {
        if (run.length > 1 && budget-- > 0) {
          if (curved && run.length > 2) smooth(P, run, { stroke: colour || ink, strokeAlpha: alpha, weight, tag });
          else polyline(P, run, { close: false, stroke: colour || ink, strokeAlpha: alpha, weight, tag });
        }
        run = [];
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], prev = pts[i - 1];
        if (ok(p)) { if (!run.length && prev && !inBox(prev)) run.push(cut(p, prev)); run.push(p); }
        else if (run.length) { if (!inBox(p)) run.push(cut(prev, p)); flush(); }
      }
      flush();
    };
    const fillShape = (pts, alpha, colour) => {
      const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
      if (!ok(c) || !pts.every(inBox) || budget-- <= 0) return false;
      polyline(P, pts, { fill: colour || ink, alpha, tag });
      return true;
    };
    const disc = (cx, cy, d, alpha, colour) => {
      if (!ok([cx, cy]) || cx - d / 2 < x || cx + d / 2 > x + w || cy - d / 2 < y || cy + d / 2 > y + h || budget-- <= 0) return false;
      circle(P, cx, cy, d, { fill: colour || ink, alpha, tag });
      return true;
    };
    const circlePts = (cx, cy, rx, ry, wob, ph) => {
      const pts = [];
      for (let a = 0; a <= 6.2832 + .001; a += .07) {
        const f = 1 + (wob || 0) * (Math.sin(3 * a + ph) * .6 + Math.sin(5 * a - ph * 1.7) * .4);
        pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
      }
      return pts;
    };
    const S = Math.min(w, h), at = () => [R(x + w * .1, x + w * .9), R(y + h * .1, y + h * .9)];
    let pin = null, marked = false;
    const accentOnce = (cx, cy, d) => {
      if (marked || !mark || !ok([cx, cy])) return;
      marked = true; pin = { x: cx, y: cy };
      ring(P, cx, cy, d, { stroke: mark, weight: .9, tag });
    };

    const draw = {
      contours() {
        const n = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const c = [R(x - w * .1, x + w * 1.1), R(y - h * .05, y + h * 1.05)], ph = R(0, 6.28), sq = R(.6, 1);
          const rings = 8 + Math.floor(rnd() * 7), step = S * R(.035, .06);
          for (let i = 1; i <= rings; i++) {
            const idx = i % 5 === 0;
            stroke(circlePts(c[0], c[1], i * step * 1.25, i * step * sq, .12, ph + i * .13), idx ? .5 : .28, idx ? .9 : .5, null, true);
          }
          if (k === 0) accentOnce(c[0], c[1], 6.4);
        }
      },
      rain() {
        const slant = Math.tan(R(8, 20) * Math.PI / 180), drops = Math.round(w * h / 160);
        for (let i = 0; i < Math.min(drops, 220); i++) {
          const a = [R(x, x + w), R(y, y + h)], len = R(4, 12);
          stroke([a, [a[0] - len * slant, a[1] + len]], R(.12, .32), R(.35, .7));
        }
      },
      rings() {
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const c = at(), step = S * R(.03, .05), count = 6 + Math.floor(rnd() * 10);
          for (let i = 1; i <= count; i++) stroke(circlePts(c[0], c[1], i * step, i * step, 0, 0), i % 4 === 0 ? .55 : .3, i % 4 === 0 ? .9 : .5);
          if (k === 0) accentOnce(c[0], c[1], step * 2);
        }
      },
      flow() {
        const f1 = R(.01, .03), f2 = R(.01, .03), p1 = R(0, 6.28), p2 = R(0, 6.28), lines = Math.min(70, Math.round(w * h / 500));
        for (let i = 0; i < lines; i++) {
          let p = [R(x, x + w), R(y, y + h)]; const pts = [p];
          for (let s = 0; s < 60; s++) {
            const a = Math.sin(p[0] * f1 + p1) * 1.6 + Math.cos(p[1] * f2 + p2) * 1.6;
            p = [p[0] + Math.cos(a) * 2.2, p[1] + Math.sin(a) * 2.2]; pts.push(p);
          }
          stroke(pts, R(.25, .55), R(.4, .8), null, true);
        }
      },
      hatch() {
        const ang = R(20, 70) * Math.PI / 180 * (rnd() < .5 ? 1 : -1), gap = R(2.2, 4), diag = Math.hypot(w, h);
        const cx = x + w / 2, cy = y + h / 2, shade = at(), rad = S * R(.25, .45);
        // Parallel lines across the box; a second set at right angles inside one
        // shaded disc - the engraver's way of making a shadow.
        const lines = (a, keep) => {
          const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
          for (let t = -diag / 2; t <= diag / 2; t += gap) {
            const pts = [];
            for (let k = 0; k <= 60; k++) {
              const u = -diag / 2 + diag * k / 60, p = [cx + nx * t + dx * u, cy + ny * t + dy * u];
              if (keep(p)) pts.push(p); else if (pts.length) { stroke(pts.splice(0), .32, .4); }
            }
            if (pts.length) stroke(pts, .32, .4);
          }
        };
        lines(ang, () => true);
        lines(ang + Math.PI / 2, (p) => Math.hypot(p[0] - shade[0], p[1] - shade[1]) < rad);
        accentOnce(shade[0], shade[1], 5);
      },
      halftone() {
        const sp = Math.max(4, Math.sqrt(w * h / 600)), c = at(), reach = Math.hypot(w, h) * R(.45, .7);
        for (let gy = y + sp / 2; gy < y + h; gy += sp) {
          for (let gx = x + sp / 2 + ((Math.round((gy - y) / sp) % 2) * sp / 2); gx < x + w; gx += sp) {
            const f = 1 - Math.hypot(gx - c[0], gy - c[1]) / reach;
            if (f > .06) disc(gx, gy, sp * .92 * f, .55);
          }
        }
        accentOnce(c[0], c[1], sp * 1.4);
      },
      burst() {
        const c = rnd() < .5 ? [x + R(-.1, .3) * w, y + R(-.1, 1.1) * h] : at(), rays = 48 + Math.floor(rnd() * 40), L = Math.hypot(w, h) * 1.1;
        for (let i = 0; i < rays; i++) {
          const a = i / rays * 6.2832, l0 = S * (i % 2 ? .08 : .14), l1 = i % 3 ? L : L * .55;
          stroke([[c[0] + Math.cos(a) * l0, c[1] + Math.sin(a) * l0], [c[0] + Math.cos(a) * l1, c[1] + Math.sin(a) * l1]].reduce((pts, p, j, arr) => {
            if (j) for (let k = 1; k <= 30; k++) pts.push([arr[0][0] + (p[0] - arr[0][0]) * k / 30, arr[0][1] + (p[1] - arr[0][1]) * k / 30]);
            return pts;
          }, [[c[0] + Math.cos(a) * l0, c[1] + Math.sin(a) * l0]]), i % 2 ? .25 : .45, i % 2 ? .4 : .8);
        }
        accentOnce(c[0], c[1], S * .1);
      },
      spiral() {
        const c = at(), n = 160 + Math.floor(rnd() * 160), k = S * R(.022, .032), gold = 137.508 * Math.PI / 180;
        for (let i = 1; i <= n; i++) {
          const r = k * Math.sqrt(i), a = i * gold;
          disc(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Math.max(.6, k * .55 * Math.sqrt(i / n) + .4), .5);
        }
        accentOnce(c[0], c[1], k * 2.5);
      },
      hex() {
        const r = S * R(.05, .09), hw = r * Math.sqrt(3);
        for (let row = 0, cy = y; cy < y + h + r; row++, cy += r * 1.5) {
          for (let cx = x + (row % 2 ? hw / 2 : 0); cx < x + w + hw; cx += hw) {
            const pts = []; for (let i = 0; i <= 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
            stroke(pts, .35, .45);
            if (rnd() < .12) fillShape(pts.slice(0, 6), R(.08, .2));
            else if (rnd() < .03) accentOnce(cx, cy, r);
          }
        }
      },
      tri() {
        const s = S * R(.08, .14), th = s * Math.sqrt(3) / 2;
        for (let row = 0, ty = y; ty < y + h; row++, ty += th) {
          for (let i = -1, tx = x - s; tx < x + w + s; i++, tx += s / 2) {
            const up = (i + row) % 2 === 0;
            const pts = up ? [[tx, ty + th], [tx + s / 2, ty], [tx + s, ty + th]] : [[tx, ty], [tx + s, ty], [tx + s / 2, ty + th]];
            if (rnd() < .22) fillShape(pts, R(.1, .5));
            else if (rnd() < .3) stroke(pts.concat([pts[0]]), .35, .45);
          }
        }
        accentOnce(...at(), s * .6);
      },
      voronoi() {
        const n = 14 + Math.floor(rnd() * 10), sites = Array.from({ length: n }, at);
        sites.forEach((s0, i) => {
          let poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
          sites.forEach((s1, j) => {
            if (i === j || poly.length < 3) return;
            const m = [(s0[0] + s1[0]) / 2, (s0[1] + s1[1]) / 2], d = [s1[0] - s0[0], s1[1] - s0[1]];
            const side = (p) => (p[0] - m[0]) * d[0] + (p[1] - m[1]) * d[1];
            const out = [];
            for (let k = 0; k < poly.length; k++) {
              const a = poly[k], b = poly[(k + 1) % poly.length], sa = side(a), sb = side(b);
              if (sa <= 0) out.push(a);
              if (sa * sb < 0) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
            }
            poly = out;
          });
          if (poly.length < 3) return;
          stroke(poly.concat([poly[0]]), .45, .55);
          const inset = poly.map((p) => [s0[0] + (p[0] - s0[0]) * .82, s0[1] + (p[1] - s0[1]) * .82]);
          if (rnd() < .3) fillShape(inset, R(.08, .22));
        });
        accentOnce(sites[0][0], sites[0][1], 5);
      },
      blobs() {
        const n = 3 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) {
          const c = at(), r = S * R(.12, .3), ph = R(0, 6.28), pts = circlePts(c[0], c[1], r, r * R(.7, 1.1), .18, ph).slice(0, -1);
          if (pts.every(ok) && budget-- > 0) blob(P, pts, { fill: k === 0 && mark ? mark : ink, alpha: k === 0 && mark ? .55 : R(.07, .18), tag });
          for (let i = 1; i <= 3; i++) stroke(circlePts(c[0], c[1], r + i * 2.4, (r + i * 2.4) * .9, .18, ph), .25, .4, null, true);
        }
        marked = true;
      },
      bauhaus() {
        const cells = 3, cw = w / cells, chh = h / Math.max(2, Math.round(h / cw));
        const shapes = ['circle', 'square', 'tri', 'half'];
        for (let i = 0; i < 5; i++) {
          const cx = x + (Math.floor(rnd() * cells) + .5) * cw, cy = y + (Math.floor(rnd() * Math.round(h / chh)) + .5) * chh;
          const sz = Math.min(cw, chh) * R(.6, .95), kind = shapes[Math.floor(rnd() * shapes.length)];
          const colour = i === 0 && mark ? mark : ink, alpha = i === 0 ? .85 : R(.15, .6);
          if (kind === 'circle') disc(cx, cy, sz, alpha, colour);
          else if (kind === 'square') fillShape([[cx - sz / 2, cy - sz / 2], [cx + sz / 2, cy - sz / 2], [cx + sz / 2, cy + sz / 2], [cx - sz / 2, cy + sz / 2]], alpha, colour);
          else if (kind === 'tri') fillShape([[cx - sz / 2, cy + sz / 2], [cx, cy - sz / 2], [cx + sz / 2, cy + sz / 2]], alpha, colour);
          else { const pts = []; for (let a = Math.PI; a <= 2 * Math.PI + .001; a += .1) pts.push([cx + Math.cos(a) * sz / 2, cy + Math.sin(a) * sz / 2]); fillShape(pts, alpha, colour); }
        }
        for (let i = 1; i < cells; i++) stroke([[x + i * cw, y], [x + i * cw, y + h]], .25, .4);
        marked = true;
      },
    };
    kinds.forEach((k) => draw[k]());
    if (pin && o.label) label(P, Math.min(pin.x + 6, x + w - 40), pin.y - 3.4, 40, o.label, { color: ink, size: 6.8, tag });
    return pin;
  }

  // The house's rule styles (house.ts RULE_STYLES).
  function rule(P, x, y, w, style, o) {
    o = Object.assign({ fill: C.ink }, o || {});
    if (style === 'double') { hr(P, x, y, w, Object.assign({}, o, { t: .25 })); return hr(P, x, y + 1.1, w, Object.assign({}, o, { t: .25 })); }
    if (style === 'thick-thin') { hr(P, x, y, w, Object.assign({}, o, { t: 1.1 })); return hr(P, x, y + 1.9, w, Object.assign({}, o, { t: .25 })); }
    if (style === 'dashed' || style === 'dotted') {
      const seg = style === 'dashed' ? 3 : .5, gap = style === 'dashed' ? 1.6 : 1.2;
      let last = null;
      for (let s = 0; s < w; s += seg + gap) last = rect(P, x + s, y, Math.min(seg, w - s), style === 'dashed' ? .3 : .5, o);
      return last;
    }
    return hr(P, x, y, w, Object.assign({}, o, { t: .25 }));
  }

  // ---- page art from primitives (core page-art.ts) ------------------------
  // The model composes the art; this only draws it. `pal` maps a role
  // (paper, ink, accent, second, third, field) to its hex. Shapes are drawn in
  // order, first at the back. Returns how many nodes were made.
  function shapes(P, list, pal, o) {
    o = o || {};
    let made = 0, dots = 0;
    (list || []).forEach(function (s) {
      // A brand's own shape (core brand.ts BRAND_KINDS) is drawn by the brand's shape kit.
      if (BRAND_KIND[s.s]) {
        try { if (brandShape(P, s, o)) made++; } catch (e) { if (o.log) o.log.push('brand shape ' + s.s + ' not drawn: ' + e.message); }
        return;
      }
      const fill = s.fill ? pal[s.fill] : null, stroke = s.stroke ? pal[s.stroke] : null;
      if (!fill && !stroke) return;
      const op = s.opacity == null ? 1 : s.opacity;
      const base = { tag: o.tag, fill: fill, alpha: op, stroke: stroke, strokeAlpha: op, weight: stroke ? (s.weight || 1) : undefined };
      const lineOnly = Object.assign({}, base, { fill: null, stroke: stroke || fill, strokeAlpha: op, weight: s.weight || 1 });
      let n = null, curve = false;
      try {
        if (s.s === 'rect') {
          n = rect(P, s.x, s.y, s.w, s.h, Object.assign({}, base, { rot: s.rot || 0 },
            s.r ? { corners: { tl: s.r, tr: s.r, bl: s.r, br: s.r } } : {}));
        } else if (s.s === 'circle') {
          n = shp(P, s.x, s.y, s.w, s.h, ShapeEllipse.create(), Object.assign({}, base, { rot: s.rot || 0 }));
        } else if (s.s === 'blob' && s.pts && s.pts.length > 2) { n = blob(P, s.pts, base); curve = true; }
        else if (s.s === 'poly' && s.pts && s.pts.length > 2) { n = polyline(P, s.pts, base); curve = true; }
        else if (s.s === 'path' && s.pts && s.pts.length > 1) { n = smooth(P, s.pts, lineOnly); curve = true; }
        else if (s.s === 'line' && s.pts && s.pts.length > 1) { n = polyline(P, s.pts, Object.assign({}, lineOnly, { close: false })); curve = true; }
        else if (s.s === 'star') {
          const k = Math.max(3, s.n || 5), cx = s.x + s.w / 2, cy = s.y + s.h / 2, pts = [];
          for (let i = 0; i < k * 2; i++) {
            const a = -Math.PI / 2 + i * Math.PI / k, rr = i % 2 ? .45 : 1;
            pts.push([cx + Math.cos(a) * s.w / 2 * rr, cy + Math.sin(a) * s.h / 2 * rr]);
          }
          n = polyline(P, pts, base); curve = true;
        } else if (s.s === 'dots') {
          // A field of dots: n across, as many rows as the box's shape gives.
          const across = Math.max(2, s.n || 6), step = s.w / across, rows = Math.max(1, Math.round(s.h / step));
          const d = s.r || step * .35;
          for (let r = 0; r < rows && dots < 160; r++) for (let c = 0; c < across && dots < 160; c++, dots++) {
            circle(P, s.x + step * (c + .5), s.y + step * (r + .5), d, { tag: o.tag, fill: fill || stroke, alpha: op });
            made++;
          }
          return;
        }
      } catch (e) { if (o.log) o.log.push('shape ' + s.s + ' not drawn: ' + e.message); return; }
      if (!n) return;
      made++;
      if (curve && s.rot) rot(n, s.rot);
      // A filled shape on a page whose picture kept its painted ground carries that grain.
      if (o.grain && fill && op >= .99 && s.s !== 'path' && s.s !== 'line') texture(n, fill, o.grain);
      // A gradient from its fill to another role, top to bottom of its box.
      if (s.to && fill && pal[s.to]) {
        gradMulti(n, [[0, fill, op], [1, pal[s.to], op]], MM(pg(P).ox + s.x + s.w / 2), MM(s.y), 90, MM(Math.max(1, s.h)));
      }
    });
    return made;
  }

  // ---- a brand's shapes and its Bengali (core brand.ts, cli-shim/bengali.mjs) ----
  // The kit (core/brands/<id>/kit/*.js) is eval'd before this toolkit when the issue has a brand:
  // it defines globalThis.G and globalThis.ochinShape, the same code the "Ochin Shape" Affinity
  // script draws with, so a shape Quire draws reopens in that dialog with its settings.
  const BRAND_KIND = { lalpaar: 'lalpaar', matra: 'matra', kantha: 'stitch', alpana: 'alpana', bird: 'bird', bpanel: 'panel', ornament: 'alpona' };
  // Ochin Shape's palette indexes (shapes.js PALETTE order).
  const BRAND_IX = { shankha: 0, kajol: 1, sindur: 2, holud: 3, neel: 4, kolapata: 5, shapla: 6, padma: 7, mati: 8, paper: 9 };
  const COLOUR_KEYS = ['ink', 'solid', 'pfill', 'endcol', 'body', 'wing', 'beak', 'eye', 'pupil', 'wstitch', 'pcol', 'gcol'];
  function brandShape(P, s, o) {
    if (!globalThis.ochinShape) { if (o.log) o.log.push('brand shape ' + s.s + ': the brand kit is not loaded'); return null; }
    const ox = pg(P).ox, p = Object.assign({}, s.p || {});
    for (const k of COLOUR_KEYS) if (typeof p[k] === 'string' && p[k] in BRAND_IX) p[k] = BRAND_IX[p[k]];
    let kind = BRAND_KIND[s.s];
    if (s.s === 'ornament' && ['alpona', 'kolam', 'rosette', 'band'].indexOf(p.kind) >= 0) kind = p.kind;
    delete p.kind;
    if (s.opacity != null && s.opacity < 1) p.opacity = s.opacity;
    const anchor = { box: { x: s.x + ox, y: s.y, w: s.w, h: s.h } };
    if (s.pts && s.pts.length > 1) anchor.pts = s.pts.map(function (q) { return [q[0] + ox, q[1]]; });
    const n = globalThis.ochinShape({ doc, G: globalThis.G, parent: useSpread(P), anchor, params: Object.assign({ kind, seed: 1000 + P * 7 + Math.round(s.x) }, p) });
    if (n && o.tag) { try { n.userDescription = o.tag; } catch (e) {} }
    return n;
  }
  // Bengali, shaped in Node (bengali.mjs) as words of outlines at 10 pt, wrapped here at the size the
  // block is set at. x, top: the block's left and top edge (mm); align left|right|centre. One node.
  function bn(P, x, top, w, item, colour, o) {
    o = o || {};
    if (!item || !item.words || !item.words.length) return null;
    const k = (o.size || 10) / 10, lead = (o.lead || o.size * 1.3 || 13) * 25.4 / 72, sp = item.sp * k;
    const lines = [[]]; let cur = 0;
    item.words.forEach(function (wd) {
      const ww = wd.w * k;
      if (lines[lines.length - 1].length && cur + sp + ww > w) { lines.push([]); cur = 0; }
      cur += (lines[lines.length - 1].length ? sp : 0) + ww; lines[lines.length - 1].push(wd);
    });
    const g = pg(P), pc = PolyCurve.create(), asc = (o.size || 10) * 25.4 / 72 * .78;
    let widest = 0;
    lines.forEach(function (ln, li) {
      const lw = ln.reduce(function (a, wd, i) { return a + wd.w * k + (i ? sp : 0); }, 0);
      widest = Math.max(widest, lw);
      let pen = o.align === 'right' ? x + w - lw : o.align === 'centre' ? x + (w - lw) / 2 : x;
      const base = top + asc + li * lead;
      ln.forEach(function (wd) {
        const t = wd.d.match(/[MCLZ]|-?[\d.]+/g) || []; let i = 0, cb = null; const n = function () { return +t[i++]; };
        const X = function (v) { return MM(g.ox + pen + v * k); }, Y = function (v) { return MM(base + v * k); };
        while (i < t.length) {
          const c = t[i++];
          if (c === 'M') { if (cb) pc.addCurve(cb.createCurve()); cb = CurveBuilder.create(); cb.beginXY(X(n()), Y(n())); }
          else if (c === 'L') cb.lineToXY(X(n()), Y(n()));
          else if (c === 'C') cb.addBezierXY(X(n()), Y(n()), X(n()), Y(n()), X(n()), Y(n()));
          else if (c === 'Z') cb.close();
        }
        if (cb) pc.addCurve(cb.createCurve());
        pen += wd.w * k + sp;
      });
    });
    const d = PolyCurveNodeDefinition.createDefault(); d.setCurves(pc);
    const node = add(P, d, o.tag);
    paint(node, col(colour, o.alpha), null);
    return { node, w: widest, h: (lines.length - 1) * lead + (o.size || 10) * 25.4 / 72 * 1.05, lines: lines.length };
  }

  // A panel in the section's language, drawn from the numbers the model set
  // (core visual-language.ts Panel). Returns the box type can be set in.
  function panel(P, x, y, w, h, sty, pal, o) {
    o = o || {};
    // An issue designed before the open values: its named shape, read as numbers.
    if (sty.shape) sty = { fill: sty.fill, stroke: sty.shadow === 'outline' ? sty.shadowColour : null, weight: 1.6,
      radius: sty.shape === 'round' ? 3.5 : sty.shape === 'pill' ? 9 : 0, cut: sty.shape === 'cut' ? 8 : 0,
      shadow: sty.shadow === 'offset' ? { dx: 2.4, dy: 2.4, colour: sty.shadowColour } : null,
      rotate: sty.shape === 'tilted' ? -1.6 : 0 };
    const fill = sty.fill ? pal[sty.fill] : null, stroke = sty.stroke ? pal[sty.stroke] : null;
    const r = Math.min(sty.radius || 0, h / 2, w / 2), cut = Math.min(sty.cut || 0, h / 2, w / 2);
    const corners = r ? { corners: { tl: r, tr: r, bl: r, br: r } } : {};
    const draw = function (dx, dy, opts) {
      if (cut) return polyline(P, [[x + dx, y + dy], [x + dx + w - cut, y + dy], [x + dx + w, y + dy + cut], [x + dx + w, y + dy + h], [x + dx, y + dy + h]], opts);
      return rect(P, x + dx, y + dy, w, h, Object.assign({}, opts, corners, { rot: sty.rotate || 0 }));
    };
    if (sty.shadow && pal[sty.shadow.colour]) draw(sty.shadow.dx || 0, sty.shadow.dy || 0, { tag: o.tag, fill: pal[sty.shadow.colour] });
    draw(0, 0, Object.assign({ tag: o.tag, fill: fill }, stroke ? { stroke: stroke, weight: sty.weight || .75 } : {}));
    const pad = Math.max(4.5, r * .6);
    // Type on a stroke-only panel sits on whatever is under it: the paper, said as such.
    return { x: x + pad, y: y + 4.5, w: w - pad * 2, h: h - 9, fill: fill || pal.paper };
  }

  globalThis.TK = {
    blockGrid, fitText, drawn, rule, shapes, panel, GENERATORS, MISSING, bn, brandShape,
    linkNote, webMap,
    doc, DPI, MM, PT, SPREADS, ROOT, IMG, TEXT, C, F, FACE, ACT, actOf, tint, col, font,
    pg, live, gx, gw, bl, lines, BASE, LINES, Y0, Y1, NCOL, COLW, GUT,
    W_FULL, W_TWOTHIRD, W_HALF, W_THIRD,
    useSpread, add, toBack, paint, rot,
    shp, rect, circle, ring, dot, hr, vr, line,
    curveNode, smooth, blob, polyline, beam, gradFill, gradMulti, tripleRule, wave,
    text, label, img, cutout, texture, held, plateFit, pattern, ph, brackets, buildStory, overflows, kill, tags,
    guides, guideV, guideH, masterSpread, masterInstance, masterToBack, masterAbove,
    Shape, ShapeType, Rectangle, Transform, Selection, FillDescriptor, BlendMode, File
  };
})();
console.log('TK lens rev1 ready');

