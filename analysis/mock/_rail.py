import re, glob, io, os

NAV = [
    ("label", "Working"),
    ("02-home.html",  "i-home",     "Home",          "3"),
    ("27-chat.html",  "i-chat",     "Chat",          None),
    ("03-books.html", "i-book",     "Books",         "5"),
    ("08-audit.html", "i-pulse",    "Audit",         "6"),
    ("10-issue-brief.html","i-magazine","Magazine",  "1"),
    ("36-analytics.html","i-grid",  "Analytics",     None),
    ("label", "System"),
    ("37-genres.html","i-layers",   "Genres",        None),
    ("30-providers.html","i-plug",  "Model config",  None),
    ("41-project.html","i-sliders", "Project",       None),
    ("33-daemon.html","i-cpu",      "Daemon",        "on"),
    ("34-logs.html",  "i-list",     "Logs",          None),
    ("label", "Tools"),
    ("39-translation.html","i-type","Translation",   None),
    ("38-style.html", "i-drop",     "Style",         None),
    ("40-import.html","i-file",     "Import",        None),
    ("35-radar.html", "i-search",   "Radar",         None),
    ("22-doctor.html","i-heart",    "Doctor",        None),
    ("32-mcp.html",   "i-skill",    "MCP",           None),
    ("21-setup.html", "i-sliders",  "Setup",         None),
    ("label", "Drawn, not shipped"),
    ("15-images.html","i-image",    "Images",        "spec"),
    ("17-library.html","i-layers",  "Library",       "spec"),
    ("18-worlds.html","i-globe",    "Worlds",        "spec"),
]

# screens that live under another rail item rather than owning one
OWNER = {
 "04-book.html":"03-books.html", "05-truth.html":"03-books.html",
 "06-chapter.html":"03-books.html", "07-review.html":"03-books.html",
 "09-run.html":"02-home.html", "29-create.html":"27-chat.html",
 "28-new.html":"27-chat.html", "47-film-author.html":"27-chat.html",
 "11-issue-sections.html":"10-issue-brief.html",
 "12-issue-pages.html":"10-issue-brief.html",
 "13-issue-page.html":"10-issue-brief.html",
 "14-issue-build.html":"10-issue-brief.html",
 "16-tweak.html":"15-images.html", "19-composer.html":"18-worlds.html",
 "20-taste.html":"18-worlds.html", "31-provider.html":"30-providers.html",
 "42-book-settings.html":"03-books.html",
 "43-play.html":"03-books.html", "44-graph.html":"03-books.html",
 "45-film-studio.html":"03-books.html", "46-flow.html":"03-books.html",
}

def rail_html(current):
    cur = OWNER.get(current, current)
    o = io.StringIO()
    w = o.write
    w('    <div class="rail">\n')
    w('      <div class="wordmark" data-go="index.html"><svg width="24" height="24"><use href="#i-quire"/></svg><b>Quire</b></div>\n')
    w('      <button class="railnew" data-go="28-new.html"><svg width="16" height="16"><use href="#i-plus"/></svg><span>Start something</span></button>\n')
    w('      <div class="rail-scroll">\n')
    for item in NAV:
        if item[0] == "label":
            w(f'        <div class="rail-label"><span>{item[1]}</span></div>\n')
            continue
        href, ico, label, tail = item
        spec = " speculative" if tail == "spec" else ""
        aria = ' aria-current="page"' if href == cur else ''
        t = ''
        if tail and tail != "spec":
            t = f'<em class="tail" style="font-style:normal">{tail}</em>'
        w(f'        <button class="nav{spec}"{aria} data-go="{href}"><svg width="17" height="17"><use href="#{ico}"/></svg><span>{label}</span>{t}</button>\n')
    w('      </div>\n')
    w('      <button class="railrun" data-go="09-run.html">\n')
    w('        <svg class="ring ring-sm" viewBox="0 0 44 44"><circle class="t" cx="22" cy="22" r="19"/><circle class="v" cx="22" cy="22" r="19" style="stroke-dashoffset:45"/></svg>\n')
    w('        <span class="grow"><span class="what">Auditing chapter 9</span><span class="where">The Lamp Room · 62%</span></span>\n')
    w('      </button>\n')
    w('      <p class="attrib dim" style="margin-top:10px;font-size:10px;line-height:1.35">Workbench forked from <b style="font-weight:600">InkOS Studio</b>, AGPL-3.0.</p>\n')
    w('    </div>\n')
    return o.getvalue()

if __name__ == "__main__":
    pat = re.compile(r'^ *<div class="rail">.*?^ *</div>\n', re.S | re.M)
    n = 0
    for f in sorted(glob.glob("*.html")):
        if f == "index.html": continue
        src = open(f, encoding="utf-8").read()
        if '<div class="rail">' not in src: continue
        new = pat.sub(lambda m: rail_html(f), src, count=1)
        if new != src:
            open(f, "w", encoding="utf-8").write(new)
            n += 1
    print("rails rewritten:", n)
