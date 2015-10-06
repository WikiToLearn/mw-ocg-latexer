See
http://mirror.math.ku.edu/tex-archive/macros/latex/contrib/fontspec/fontspec.pdf
for details on font selection with xelatex.

This directory contains the following fonts:
* Charis: http://scripts.sil.org/CharisSILfont
* TaameyFrankCLM: http://culmus.sourceforge.net/taamim/
* Rachana: http://savannah.nongnu.org/projects/smc

Charis is a good Latin/Cyrillic font, but we would still need high quality
CJK (etc) fonts.

TaameyFrank is a recommended Hebrew font, but it has poor ISO-8859-1
coverage (greek letters in particular) so we're using Linux Libertine
for Hebrew at the moment.

Rachana is our Malayalam font.  It is in fonts-smc on newer Debian/Ubuntu
releases, and in ttf-malayalam-fonts on older releases.

The Lohit fonts are from https://fedorahosted.org/lohit/.  We're using
the 2014-02-20 release.  They cover 11 Indian languages (21, if you count
the various languages using Devanagari script separately).
