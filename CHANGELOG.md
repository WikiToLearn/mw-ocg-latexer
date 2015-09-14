# mw-ocg-latexer x.x.x (not yet released)
* Support CPU limiting of helper binaries.
* Use {{DISPLAYTITLE}} when appropriate.
* Switch from es6-shim to core-js.
* Improve text rendering for Nepali languages and Bhojpuri.

# mw-ocg-latexer 0.3.0 (2014-11-04)
* Improved language support: Persian, Indic languages (bug 28206, bug
  68922), CJK (including Simplified and Traditional Chinese scripts,
  and additional language aliases for Korean), Macedonian, Aramaic,
  Bosnian, Tibetan, Lao, and Khmer.  Ensure we switch to latin font
  where necessary.
* Use `texvcjs` package to validate/translate math markup.
* Allow rendering from unzipped bundle.
* Add `-T` option to CLI to specify a temporary directory.
* Render attribution pages.
* New log and status reporting framework; better error reporting.
* Improve metabook option handling (paper size setting, toc auto
  mode) (bug 68836).
* Clean up after running the tests (bug 71341).
* Bug fixes:
    * Fix super/subscript issue.
    * Don't crash if the collection title looks like a URL.
    * Properly escape HTML anchors and id attributes (bug 68854).
    * Don't crash if chapter has no items.
    * Don't crash on `;#`.
    * Don't crash if <div> begins a figure caption.
    * Don't crash if we encounter uncontained <li>.
    * Don't crash if section/chapter title contains a URL.
    * Don't crash if images are inside <DT> tags.
    * Fix TeX escaping of [].
    * Fix "There's no line here to end." crasher (<br> after <dd>).
    * Be careful about square brackets inside \item[...].
    * Don't crash when the page title is RTL.
    * Don't hang if unzip produces console output.
    * Prevent 100% CPU hang on certain input text.
* Image improvements:
    * Use `jpegtran` to purge EXIF data from jpegs.
    * Use proper page of any PDF figure.
    * Convert TIFF images to PNG (bug 70866).
    * Handle animated GIFs; remove `easyimage` dependency (bug 70865).
    * Don't crash if PNG has bogus resolution information.
    * Support inline images.
    * Support djvu images, but disable full extraction by default.
    * Disable PDF page splitting by default.
* Rendering improvements:
    * Ensure we don't break after the - in a negative number.
    * Wrap long DTs.
    * Render emphasis nodes
    * Always use bidi, even if the wiki is "in theory" only LTR.
    * Equations should be flush left and not indented (bug 68838).
    * Allow page breaks between empty sections.
    * Use narrower margins.
    * Fix non-curly quotes (`extquotedbl` in output).
    * Allow lists nested 9 levels deep (bug 71896).
    * PDF can't handle UTF-8 URLs (bug 71547).
* Update dependencies.

# mw-ocg-latexer 0.2.2 (2014-01-21)
* Non-Latin rendering support.  Improvements to Arabic, Urdu, Devanagari,
  Malayalam, Hebrew, Chinese, Korean, and Japanese.  We use the
  `node-icu-bidi` package to properly implement the Unicode Bidirectional
  Algorithm.
* Also accent position improvements in Vietnamese.
* Add `--syslog` CLI option.

# mw-ocg-latexer 0.2.0 (2013-12-04)
* First mostly-functional release.
