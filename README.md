# Parsoid-LaTeX

A simple PDF converter for wikitext, using Parsoid and `pdflatex`.

## Installation

I'm using node 0.10.  Probably any recent node will work; I haven't tested
others.

Install the node package dependencies.
```
cd latex
npm install
```

Install other system dependencies.
```
apt-get install texlive-xetex imagemagick
```

## Running

To generate a PDF named `out.pdf` from the `en` wikipedia article "United States":
```
bin/parsoid-latex.js -o out.pdf --prefix en "United States"
```

For debugging, preserving the XeTeX output is often useful:
```
bin/parsoid-latex.js -o out.tex --prefix en "United States" && xelatex out.tex
```

For other options, see:
```
bin/parsoid-latex.js --help
```

## License

GPLv2

(c) 2013 by C. Scott Ananian
