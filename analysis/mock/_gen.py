# -*- coding: utf-8 -*-
"""Emit a mockup screen with the canonical chrome around a body."""
import sys, io
from _rail import rail_html

SHELL = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Quire Vermilion</title>
<link rel="stylesheet" href="vermilion.css">
<link rel="stylesheet" href="mock.css">
<script src="mock.js" defer></script>
</head>
<body class="mock">
<!--
{contract}
-->

<header class="mock-bar">
  <div class="id"><span class="n">{num}</span><b>{title}</b><span>{sub}</span></div>
  <nav>
    <div class="seg" data-seg>
      <button data-theme-btn="light" aria-pressed="false">Light</button>
      <button data-theme-btn="" aria-pressed="true">System</button>
      <button data-theme-btn="dark" aria-pressed="false">Dark</button>
    </div>
    <a href="{prev}">&larr; Prev</a><a href="index.html">All screens</a><a href="{next}">Next &rarr;</a>
  </nav>
</header>

<div class="mock-stage">
  <div class="screen">
    <div class="titlebar">
      <svg width="15" height="15" style="color:var(--vermilion)"><use href="#i-quire"/></svg>
      <span>Quire</span><span class="dim mono" style="font-size:11px">shim &middot; 127.0.0.1:8788</span>
      <div class="wincontrols">
        <button aria-label="Minimise"><svg width="14" height="14"><use href="#i-winMin"/></svg></button>
        <button aria-label="Maximise"><svg width="12" height="12"><use href="#i-winMax"/></svg></button>
        <button class="close" aria-label="Close"><svg width="13" height="13"><use href="#i-winClose"/></svg></button>
      </div>
    </div>

{rail}
    <div class="main">
      <div class="topbar">
{topbar}      </div>

      <div class="stage">
{body}      </div>
    </div>
  </div>
</div>
</body>
</html>
"""

def emit(fname, num, title, sub, prev, nxt, contract, topbar, body):
    html = SHELL.format(
        title=title, sub=sub, num=num, prev=prev, next=nxt,
        contract=contract.strip("\n"), rail=rail_html(fname),
        topbar=topbar, body=body)
    open(fname, "w", encoding="utf-8").write(html)
    print("wrote", fname)
