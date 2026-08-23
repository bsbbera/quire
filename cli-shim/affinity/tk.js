// InkDesk — Affinity build toolkit.
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
  // Section boundaries come from the issue's own flatplan, not a fixed
  // three-act map — an issue may have two sections or nine, and the section is
  // what decides a page's colour world and folio tint.
  const SECTIONS = CFG.sections || [];
  const WHEEL = [C.actLight, C.actStuff, C.actFeel, C.pG, C.clay, C.slate, C.olive];
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
    const cx = MM(g.ox + x) + tw / 2, cy = MM(y) + th / 2;
    doc.applyTransform(
      Transform.createTranslate(cx, cy)
        .multiply(Transform.createScale(s, s))
        .multiply(Transform.createTranslate(-(b.x + iw / 2), -(b.y + ih / 2))), n);
    if (o.opacity !== undefined) doc.executeCommand(
      DocumentCommand.createSetOpacity(o.opacity, Selection.create(doc, n)));
    if (o.blend) doc.executeCommand(
      DocumentCommand.createSetBlendMode(o.blend, Selection.create(doc, n)));
    return n;
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
    label(P, lx, Math.max(y + 5, 8), x + w - lx - 6, 'ILLUSTRATION Â· ' + slug,
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
    label(P, x + w - 62, y + h - 10, 56, Math.round(w) + ' Ã— ' + Math.round(h) + ' MM',
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

  globalThis.TK = {
    doc, DPI, MM, PT, SPREADS, ROOT, IMG, TEXT, C, F, FACE, ACT, actOf, tint, col, font,
    pg, live, gx, gw, bl, lines, BASE, LINES, Y0, Y1, NCOL, COLW, GUT,
    W_FULL, W_TWOTHIRD, W_HALF, W_THIRD,
    useSpread, add, toBack, paint, rot,
    shp, rect, circle, ring, dot, hr, vr, line,
    curveNode, smooth, blob, polyline, beam, gradFill, gradMulti, tripleRule, wave,
    text, label, img, ph, brackets, buildStory, overflows, kill, tags,
    guides, guideV, guideH, masterSpread, masterInstance, masterToBack, masterAbove,
    Shape, ShapeType, Rectangle, Transform, Selection, FillDescriptor, BlendMode, File
  };
})();
console.log('TK lens rev1 ready');

