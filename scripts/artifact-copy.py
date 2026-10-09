"""Turn dist-single/index.html into a body fragment for the private preview host,
which supplies its own doctype/head/body. Only strips the outer wrapper, using
fixed positions, because the bundled JS contains literal '<body>' strings."""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
head_start = s.index("<head>") + len("<head>")
tail = "</head>\n  <body>\n"
head_end = s.rindex(tail)
head = s[head_start:head_end]
body = s[head_end + len(tail):s.rindex("</body>")]
head = re.sub(r'\s*<meta charset[^>]*>', "", head, count=1)
head = re.sub(r'\s*<meta name="viewport"[^>]*>', "", head, count=1)
title = re.search(r"<title>.*?</title>", head).group(0)
head = head.replace(title, "", 1)
out = title + "\n" + head + "\n" + body
assert '<div id="root"></div>' in body
open(dst, "w").write(out)
print("ok", len(out))
