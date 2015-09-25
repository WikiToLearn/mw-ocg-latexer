# mw-ocg-latexer
[![NPM][NPM1]][NPM2]

[![Build Status][1]][2] [![dependency status][3]][4] [![dev dependency status][5]][6]

Converts mediawiki collection bundles (as generated by [mw-ocg-bundler]) to
beautiful PDFs (via [XeLaTeX]).

## Installation

Node version 0.8 and 0.10 are tested to work.

Install the node package dependencies.
```
npm install
```
You will need to have a C compiler installed in order to build the
`sqlite3` and `icu-bidi` packages (ie, `apt-get install g++`).

Install other system dependencies.
```
apt-get install texlive-xetex texlive-latex-recommended \
                texlive-latex-extra texlive-generic-extra \
                texlive-fonts-recommended texlive-fonts-extra \
                fonts-hosny-amiri fonts-farsiweb fonts-nafees \
                fonts-arphic-uming fonts-arphic-ukai fonts-droid fonts-baekmuk \
                texlive-lang-all latex-xcolor \
                poppler-utils imagemagick librsvg2-bin libjpeg-progs \
                djvulibre-bin unzip
```

Note that up-to-date LaTeX `hyperref` and `fontspec` packages are
required.  If your LaTeX installation is old, you can find recent
versions of some of the necessary packages in `texdeps/`, but it's
best to use an up-to-date TeXlive distribution.

If you prefer, the `inkscape` package can be installed to do SVG->PDF
conversion in place of `rsvg-convert` (from the `librsvg2-bin` package).

In older versions of Ubuntu, the Nazli font was provided by the
`ttf-farsiweb` package instead of `fonts-farsiweb`.

In Ubuntu 12.04, the `lmodern` package must also be installed manually.

## Generating bundles

You may wish to install the [mw-ocg-bundler] npm package to create bundles
from wikipedia articles.  The below text assumes that you have done
so; ignore the `mw-ocg-bundler` references if you have bundles from
some other source.

## Running

To generate a PDF named `out.pdf` from the `en.wikipedia.org` article
"United States":
```
$SOMEPATH/bin/mw-ocg-bundler -v -o us.zip -h en.wikipedia.org "United States"
bin/mw-ocg-latexer -o out.pdf us.zip
```

In the above command `$SOMEPATH` is the place you installed
`mw-ocg-bundler`; if you've used the directory structure recommended
by `mw-ocg-service` this will be `../mw-ocg-bundler`.

For debugging, preserving the XeTeX output is often useful:
```
bin/mw-ocg-latexer -o out.tex us.zip
TEXINPUTS=tex/: xelatex out.tex
```

For other options, see:
```
bin/mw-ocg-latexer --help
```

## Related Projects

* [MediaWiki to LaTeX](http://sourceforge.net/projects/wb2pdf/)
  ([wiki](https://de.wikibooks.org/wiki/Benutzer:Dirk_Huenniger/wb2pdf))
* [icu-bidi](https://github.com/cscott/node-icu-bidi)
  Used by `mw-ocg-latexer` to implement the
  [Unicode Bidirectional Algorithm](http://www.unicode.org/unicode/reports/tr9/)
* [BiDiTeX](http://biditex.sourceforge.net/)
  Another alternative for BiDi support, although written for eTeX.

## License

GPLv2

(c) 2013 by C. Scott Ananian

[mw-ocg-bundler]: https://github.com/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-bundler
[XeLaTeX]: https://en.wikipedia.org/wiki/XeTeX

[NPM1]: https://nodei.co/npm/mw-ocg-latexer.png
[NPM2]: https://nodei.co/npm/mw-ocg-latexer/

[1]: https://travis-ci.org/cscott/mw-ocg-latexer.svg
[2]: https://travis-ci.org/cscott/mw-ocg-latexer
[3]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-latex_renderer.svg
[4]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-latex_renderer
[5]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-latex_renderer/dev-status.svg
[6]: https://david-dm.org/wikimedia/mediawiki-extensions-Collection-OfflineContentGenerator-latex_renderer#info=devDependencies
