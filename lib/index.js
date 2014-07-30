// Convert bundles to PDFs via LaTeX.
// ---------------------------------------------------------------------
"use strict";
require('es6-shim');
require('prfun');

var json = require('../package.json');

var domino = require('domino');
var easyimage = require('easyimage');
var fs = require('fs');
var gammalatex = require('gammalatex');
var path = require('path');
var stream = require('stream');
var texvcjs = require('texvcjs');
var tmp = require('tmp');
var ubidi = require('icu-bidi');
var url = require('url');
tmp.setGracefulCleanup();

// node 0.8 compatibility
if (!stream.Writable) {
	stream = require('readable-stream');
}

var Db = require('./db');
var DomUtil = require('./domutil');
var P = require('./p');
var Polyglossia = require('./polyglossia');
var StatusReporter = require('./status');

// use these when there's no B/I/BI for a font.
var FAKESTYLES = 'AutoFakeBold=1.5,AutoFakeSlant=0.2';

// fonts for specific scripts
var SCRIPT_FONTS = {
	'default': { name: 'FreeSerif' },
	'Arabic': { name: 'Amiri' }, // from fonts-hosny-amiri
	'Devanagari': { name: 'Nakula', opts: FAKESTYLES }, // from fonts-nakula
	'Hebrew': { name: 'Linux Libertine O' },
	'Latin': { name: 'Linux Libertine O' },
	'Malayalam': { name: 'Rachana', opts: FAKESTYLES } // from fonts-smc
};

// fonts for specific languages
var LANGUAGE_FONTS = {
	// this is just to tweak the accent position
	'vietnamese': { name: 'Linux Libertine O', opts: 'Language=Vietnamese' },
	// from fonts-nafees
	'urdu': { name: 'Nafees', opts: FAKESTYLES },
	// from ttf-farsiweb
	'farsi': { name: 'Nazli' },
	// from fonts-arphic-uming, fonts-arphic-ukai, fonts-droid
	'chinese': { cjk:true, name: 'AR PL UMing CN', opts: 'BoldFont=Droid Sans Fallback,ItalicFont=AR PL UKai CN,Language=Chinese Simplified,CJKShape=Simplified' },
	// from texlive-lang-cjk, fonts-droid
	'japanese': { cjk:true, name: 'IPAexMincho', opts: 'BoldFont=Droid Sans Fallback,AutoFakeSlant=0.2' },
	// from fonts-baekmuk
	'korean': { cjk:true, name: 'Baekmuk Batang', opts: 'BoldFont=Baekmuk Headline,AutoFakeSlant=0.2' }
};

var STD_HEADER = [
	"%!TEX TS-program = xelatex",
	"%!TEX encoding = UTF-8 Unicode",
	"",
	"\\documentclass[10pt,twocolumn,twoside,fleqn]{article}",
	"\\pagestyle{headings}",
	"\\usepackage{fontspec, xunicode, polyglossia, graphicx, xltxtra}",
	"\\usepackage{amsmath,amsthm,amstext,amssymb}",
	"\\usepackage[usenames]{xcolor}",
	"\\definecolor{linkcolor}{rgb}{.27,0,0}",
	"\\definecolor{citecolor}{rgb}{0,0,.27}",
	"\\usepackage[unicode,colorlinks,breaklinks,allcolors=linkcolor,linkcolor=citecolor]{hyperref}",
	"\\urlstyle{same}",
	// This is a documented workaround for including SVGs with RGB colors and/or
	// transparency; see:
	// http://tex.stackexchange.com/questions/29523/inkscape-pdf-includegraphics-xelatex-changed-colors
	// but we're using rsvg-convert now, so maybe we don't need it anymore?
	// commented it out, bring it back if we have colorspace issues.
/*
	"\\usepackage{eso-pic}",
	"\\AddToShipoutPicture{%",
	"\\makeatletter%",
	"\\special{pdf: put @thispage <</Group << /S /Transparency /I true /CS /DeviceRGB>> >>}%",
	"\\makeatother%",
	"}",
*/
/*
	// Set up Taamey Frank CLM Hebrew font
	"\\newfontfamily\\hebrewfont[",
	"Script = Hebrew,",
	"Path = " + path.join(__dirname, "..", "fonts", "TaameyFrankCLM-0.110", "TTF") + "/ ,",
	"Extension = .ttf ,",
	"UprightFont    = *-Medium ,",
	"BoldFont       = *-Bold ,",
	"ItalicFont     = *-MediumOblique ,",
	"BoldItalicFont = *-BoldOblique ,",
	"]{TaameyFrankCLM}",
*/
/*
	// Set up Charis font
	"\\newfontfamily\\charisfont[",
	"Path = " + path.join(__dirname, "..", "fonts", "CharisSIL-4.114") + "/ ,",
	"Extension = .ttf ,",
	"UprightFont    = *-R ,",
	"BoldFont       = *-B ,",
	"ItalicFont     = *-I ,",
	"BoldItalicFont = *-BI ,",
	"]",
	"{CharisSIL}",
*/

	// Set the default font
	"\\setmainfont[" + (SCRIPT_FONTS['default'].options||'') + "]{" + SCRIPT_FONTS['default'].name + "}",
	"\\newcommand{\\LTRfont}{}",
	"\\newcommand{\\textsmall}[1]{{\\small #1}}",
	// smaller size, one column for attributions
	"\\newcommand{\\attributions}{" +
		"\\renewcommand{\\textsmall}[1]{{\\scriptsize ##1}}" +
		"\\footnotesize\\onecolumn" +
	"}",

	"\\date{}\\author{}"
].join("\n");

var STD_FOOTER = [
	"\\end{document}"
].join("\n");

// John Gruber's "Improved Liberal, Accurate Regex Pattern for Matching URLs"
var URL_REGEXP = /\b((?:[a-z][\w\-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/i;

// Convert plain text (with HTML whitespace semantics) to an appropriately
// escaped string for TeX to process.
var texEscape = function(str, nourls) {
	if (!nourls) {
		// pull out URLs and flag them specially
		return str.split(URL_REGEXP).map(function(s) {
			return texEscape(s, "nourls");
		}).map(function(s, i) {
			/* jshint bitwise: false */
			return (s && (i&1)) ? ('\\nolinkurl{' + s + '}') : s;
		}).join('');
	}
	// protect TeX special characters
	str = str.replace(/[#$&_%{}\\]/g, function(c) { return '\\' + c; });
	// twiddle and carat are special
	str = str.replace(/~/g, '\\char"007F{}').replace(/\^/g, '\\char"005E{}');
	// compress multiple newlines (and use unix-style newlines exclusively)
	str = str.replace(/\r\n?/g, '\n').replace(/\n\n+/g, '\n');
	// trim leading and trailing newlines for consistent output.
	str = str.replace(/^\n+/, '').replace(/\n$/, '');
	// non-breaking space
	str = str.replace(/\xA0/g, '~');
	// smart quotes
	// XXX smart quotes should probably be disabled in some locales
	//     because having curly quotes in zh or fr is not exactly appropriate
	str = str.replace(/(^|\s|\()["](\w)/g, function(match, before, after) {
		return before + '\u201C' + after;
	}).replace(/(\w|[.,])["](\s|[.,\u2014\)]|$)/g, function(match, before, after) {
		return before + "\u201D" + after;
	}).replace(/(s')|(\w's)/, function(match) {
		return match.replace(/'/, '\u2019');
	});
	// differentiate minus sign from hyphen
	//str = str.replace(/(^|\W)(-[0-9.]+)/g, '$1$$$2$$');
	str = str.replace(/(^|\W)-([0-9.]+)/g, '$1$$-$$$2');
	return str;
};

// like Node.querySelector, but only looks at direct descendants of node.
var childSelector = function(node, selector) {
	for (var i = 0, n = node.children.length; i < n; i++) {
		if (node.children[i].matches(selector)) {
			return node.children[i];
		}
	}
	return null;
};
// like Node.querySelectorAll, but only looks at direct descendants of node.
/* exported childSelectorAll */ // shut up, jshint
var childSelectorAll = function(node, selector) {
	return Array.prototype.filter.call(node.children, function(e) {
		return e.matches(selector);
	});
};

// ---------------------------------------------------------------------

/**
 * The `Formatter` class tracks the details of LaTeX syntax, in particular
 * what LaTeX calls 'paragraph mode', 'math mode', and 'LR mode'.  It ensures
 * that we don't try to make a line break if we haven't started a paragraph,
 * and that we don't try to break a line or paragraph if we're in LR mode
 * (basically, that we're inside the {} of a command argument).
 * It *also* implements the Unicode Bidirectional Algorithm (using the
 * node-icu-bidi package) to explicitly tag LTR and RTL runs, and contains
 * a few workarounds to prevent XeTeX's "almost the Unicode bidi algorithm"
 * implementation from screwing with things. (See
 * http://tug.org/pipermail/xetex/2013-December/024964.html and
 * http://tug.org/pipermail/xetex/2014-January/025086.html for more detail.)
 *
 * In the future this class might also need to handle font switching based
 * on code blocks, since the fonts used for many languages do not have
 * great coverage.  I tried using the ucharclasses package for this, but
 * it fought with polyglossia and slowed down LaTeX processing by a factor
 * of 6x.
 */
var Formatter = function(stream, options) {
	this.stream = stream;
	this.options = options;
	this.buffer = [];
	this.decorations = [];
	this.stack = []; // active inline decorations
	this.pos = 0;
	this.newEnv = this.newLine = this.newPara = this.startPara = true;
	// allow list-type environments to prevent a default-direction change,
	// since that will cause the list labels to shift sides (ie, item
	// bullets or citation numbers will switch from the left-hand side to
	// the right-hand side mid-list)
	this.inList = 0;
	// this is the 'active' direction (that is, the default direction
	// in the xelatex context).  We reset this at paragraph boundaries
	// to match the paragraphDir.
	this.contextDir = options.dir || 'ltr';
	// this is the 'desired' direction, ie the paragraph direction we
	// should use when we compute the next set of runs.
	this.paragraphDir = this.contextDir;
};
/**
 * Used to finish up output; writes all buffered text to a stream and
 * returns a promise which will be resolved when the write is complete.
 */
Formatter.prototype.flush = function() {
	return new Promise(function(resolve, reject) {
		this.envBreak();
		console.assert(this.stack.length === 0); // all inline styles closed
		this.stream.write('', 'utf8', function(err) {
			return err ? reject(err) : resolve();
		});
	}.bind(this));
};
// Internal: Write the given string directly to the output.
Formatter.prototype._writeRaw = function(text) {
	this.stream.write(text, 'utf8');
};
// This is the main workhorse of this class. It takes the queued strings
// (in `this.buffer`) and decorations (in `this.decorations`), runs the
// Unicode BiDi algorithm, and emits runs of TeX-escaped LTR/RTL text, with
// the raw LaTeX commands ('decorations') interspersed appropriately.
Formatter.prototype._writeRuns = function() {
	var text = this.buffer.join('');
	if (text.length === 0 && this.decorations.length === 0) {
		return; // nothing to do
	}
	this._addDecoration({ type: 'end' }); // sentinel
	// compute directionality runs in this text.
	var p = new ubidi.Paragraph(text, {
		paraLevel: (this.paragraphDir==='ltr') ? ubidi.DEFAULT_LTR : ubidi.DEFAULT_RTL
	});
	// helper: emit a decoration start/end with appropriate delimiters.
	var emitDecoration = function(d, opts) {
		/* jshint bitwise: false */ // xor operator is okay.
		switch (d.type) {
		case 'start-inline':
		case 'end-inline':
			var isStart = /^start-/.test(d.type) ^ (!!opts.invert);
			if (isStart) {
				if (opts.updateStack) {
					this.stack.push(d);
				}
				this._writeRaw(d.value);
				this._writeRaw(d.delimiter || '{');
			} else {
				if (opts.updateStack) {
					console.assert(this.stack.length, this.decorations);
					console.assert(this.stack[this.stack.length-1].value === d.value);
					this.stack.pop();
				}
				this._writeRaw(d.delimiter || '}');
			}
			break;
		case 'start-block':
		case 'end-block':
		case 'raw':
			this._writeRaw(d.value); break;
		default:
			console.assert(false);
		}
	}.bind(this);

	var pos, j, d,  dirChange;
	for (pos=j=0; pos < text.length; ) {
		var run = p.getLogicalRun(pos);
		// set the proper run direction
		dirChange = false;
		if (run.dir !== this.contextDir) {
			if (this.startPara && !this.inList) {
				// a good place to change the context dir
				this._writeRaw('\\set' + run.dir.toUpperCase() + '\n');
				this.contextDir = run.dir;
			} else {
				// start an inline dir change
				this._writeRaw(run.dir === 'rtl' ? '\\RLE{' : '\\LRE{');
				dirChange = true;
				// This is a bit of a hack.  rtl->ltr transitions are typically
				// due to the interpolation of latin text.  We want to turn
				// off script-specific layout features when this happens
				// (see http://tug.org/pipermail/xetex/2014-January/025086.html)
				if (run.dir==='ltr') { this._writeRaw('\\LTRfont '); }
			}
		}
		this.startPara = false;
		// open any decorations on stack
		this.stack.forEach(function(d){ emitDecoration(d, { invert: false });});
		var runEnd = run.logicalLimit;
		// advance runEnd to snarf up LTR digits in an RTL context
		if (run.dir==='rtl' && this.contextDir==='rtl') {
			while (runEnd < text.length) {
				var nextRun = p.getLogicalRun(runEnd);
				if (nextRun.dir === 'rtl' ||
					/^[0-9,.]+$/.test(text.slice(runEnd, nextRun.logicalLimit))){
					runEnd = nextRun.logicalLimit;
				} else { break; }
			}
		}
		for (;; j++) {
			d = this.decorations[j];
			if (!(d.pos < runEnd ||
				  d.pos === runEnd && /^end-/.test(d.type))) {
				break;
			}
			// write text up to this decoration
			this._writeRaw(texEscape(text.slice(pos, d.pos)));
			pos = d.pos;
			emitDecoration(d, { updateStack: true });
		}
		// emit any trailing text
		this._writeRaw(texEscape(text.slice(pos, runEnd)));
		pos = runEnd;
		// close any decorations on the stack
		this.stack.forEach(function(d) { emitDecoration(d, { invert: true }); });
		if (dirChange) {
			this._writeRaw('}');
		}
	}
	// emit decorations at end (not including sentinel)
	if (j < (this.decorations.length-1)) {
		// open any decorations on stack
		this.stack.forEach(function(d){ emitDecoration(d, { invert: false });});
		// emit trailing decorations
		for (; j < (this.decorations.length-1); j++) {
			d = this.decorations[j];
			emitDecoration(d, { updateStack: true });
		}
		// close any decorations on the stack
		this.stack.forEach(function(d) { emitDecoration(d, { invert: true }); });
	}
	// done; clear all the buffers
	this.buffer.length = this.decorations.length = this.pos = 0;
};
/** Tell the formatter this should be treated as a "start of line" (also
 * "start of environment" and "start of paragraph") context.
 * Used to reset formatter state after we've added some LaTeX decorations
 * that don't emit text.
 */
Formatter.prototype.resetSOL = function() {
	this.newEnv = this.newLine = this.newPara = true;
};
/** Flush the formatter buffers and indicate that this is a good place to
 *  change the text directionality, if necessary. */
Formatter.prototype.dirBreak = function() {
	this._writeRuns();
};
/** Add an "environment break": make this a good place to start/end an
 *  environment. */
Formatter.prototype.envBreak = function() {
	if (this.newEnv) { return; }
	this.dirBreak();
	this._writeRaw('\n');
	this.newEnv = true;
};
/** Add a paragraph break. */
Formatter.prototype.paragraphBreak = function() {
	if (this.newPara) { return; }
	this.envBreak();
	this._writeRaw('\n');
	this.newPara = this.newLine = true;
	// this is a good place to change the xetex default bidi context dir
	this.dirBreak(); this.startPara = true;
};
/** Add a hard line break (only allowed within a paragraph). */
Formatter.prototype.lineBreak = function() {
	if (this.newLine) { return; }
	this.envBreak();
	this._writeRaw('\\\\\n');
	this.newLine = true;
};
// Internal: bookkeeping for decorations.
Formatter.prototype._addDecoration = function(d) {
	d.pos = this.pos;
	this.decorations.push(d);
	this.newEnv = this.newLine = this.newPara = false;
};
/** Add the given literal text to the output. */
Formatter.prototype.write = function(text) {
	if (this.newEnv || this.newLine || this.newPara) {
		text = text.replace(/^\s+/, ''); // kill leading space after nl
		if (!text.length) { return; }
		this.newEnv = this.newLine = this.newPara = false;
	}
	text = text.replace(/\s+/g, ' '); // remove newlines
	this.buffer.push(text);
	this.pos += text.length;
};
/**
 * Add some decorated text.  If `text` is omitted, this is a raw or block
 * decoration.  Otherwise, we will add a new inline decoration around the
 * given text.  `text` can be a function in that case, which is expected
 * to compute the text to be added.
 */
Formatter.prototype.writeDecorated = function(decoration, text) {
	if (text === undefined) {
		if (typeof(decoration)==='string') {
			decoration = {
				type: 'raw',
				value: decoration
			};
		}
		this._addDecoration(decoration);
		return;
	}
	this._addDecoration({
		type: 'start-inline',
		value: decoration
	});
	if (typeof(text)==='function') { text = text(); }
	if (typeof(text)==='string') { this.write(text); }
	this._addDecoration({
		type: 'end-inline',
		value: decoration
	});
};
// helpers for environments.
Formatter.prototype.begin = function(env, opts) {
	this.envBreak();
	this._addDecoration({
		type: 'start-block',
		value: '\\begin{' + env + '}' + (opts ? ('[' + opts + ']') : '')
	});
	this.envBreak();
	this.resetSOL();
};
Formatter.prototype.end = function(env) {
	this.envBreak();
	this._addDecoration({
		type: 'end-block',
		value: '\\end{' + env + '}'
	});
	this.envBreak();
	this.newLine = this.newPara = true;
};
// helpers for directionality
Formatter.prototype.switchDir = function(dir, opts) {
	this.dirBreak(); // flush runs
	if (opts && opts.implicit) {
		this.contextDir = dir;
		return;
	}
	this.paragraphDir = dir;
};
// helper to reset LTR font in new rtl context
var updateLTRfont = function(format, poly) {
	if (poly.dir==='rtl' && SCRIPT_FONTS[poly.script]) {
		format.writeDecorated(
			'\\renewcommand{\\LTRfont}' +
				'{\\LTR'+poly.script.toLowerCase()+'font}'
		);
		format.envBreak();
		format.resetSOL();
	}
};

// ---------------------------------------------------------------------

// Predicate to determine whether the given element will be a
// paragraph context in LaTeX.
var isParagraph = function(node) {
	return (/^(BLOCKQUOTE|BODY|CENTER|DIV|DL|FIGURE|H[1-6]|OL|P|TABLE|UL)$/).test(node.nodeName); // xxx others?
};

// Special predicate for some image templates used on enwiki
// XXX restrict to enwiki content?
var isMultipleImageTemplate = function(node) {
	if (node.getAttribute('typeof') === 'mw:Transclusion') {
		try {
			var data = JSON.parse(node.getAttribute('data-mw'));
			var href = data.parts[0].template.target.href;
			if (href === './Template:Triple_image' ||
				href === './Template:Double_image') {
				return true;
			}
		} catch (e) { /* ignore */ }
	}
	return false;
};

// Predicate to distinguish 'nonprintable' content.
var isHidden = function(node) {
	if (isMultipleImageTemplate(node)) {
		return false;
	}
	if (node.classList.contains('noprint')) {
		return true;
	}
	if (/(^|;)\s*display\s*:\s*none\s*(;|$)/i.test
		(node.getAttribute('style') || '')) {
		return true;
	}
	// bit of a hack: hide infobox / navbox / rellink / dablink / metadata
	// XXX restrict to enwiki or localize?
	if (['infobox', 'navbox', 'rellink', 'dablink', 'toplink', 'metadata'].some(function(c) {
		return node.classList.contains(c);
	})) {
		return true;
	}
	return false;
};

// ---------------------------------------------------------------------

/**
 * The `Visitor` class encapsulates most of the logic of HTML->LaTeX
 * translation.  It traverses the wikitext DOM tree and generates LaTeX
 * output as it goes.  It tracks inherited language and directionality
 * information as it descends.
 */
var Visitor = function(document, format, options) {
	this.document = document;
	this.format = format;
	this.options = options;
	this.output = [];
	this.templates = new Set();
	this.base = options.base || '';
	this.currentLanguage = this.tocLanguage = options.lang || 'en';
	this.currentDirectionality = options.dir || 'ltr';
	this.usedLanguages = new Set();
	this.listInfo = {};
};

// Helper function -- wrap the contents of the children of the node
// with the given inline (non-paragraph) decoration
Visitor.prototype.wrap = function(decoration, node) {
	return this.format.writeDecorated(decoration, function() {
		return this.visitChildren(node);
	}.bind(this));
};

// Generic node visitor.  Dispatches to specialized visitors based on
// element typeof/rel attributes or tag name.
Visitor.prototype.visit = function(node) {
	var name = node.nodeName, type = node.nodeType;
	switch(type) {
	case node.ELEMENT_NODE:
		if (isHidden(node)) {
			return;
		}
		// handle LANG attributes (which override everything else)
		var lang = node.getAttribute('lang') || this.currentLanguage;
		// in addition to eliminating no-ops, this condition allows us
		// to recursively invoke visit() inside the LANG handler.
		if (lang !== this.currentLanguage) {
			this.usedLanguages.add(lang);
			return this['visitLANG='].apply(this, arguments);
		}
		// directionality should be set by language handling.  if it isn't...
		var dir = node.getAttribute('dir') || this.currentDirectionality;
		if (dir==='auto') { dir = this.currentDirectionality; /* hack */ }
		if (dir !== this.currentDirectionality) {
			return this['visitDIR='].apply(this, arguments);
		}
		// xxx look at lang and dir from css styling xxx
		// use typeof property if possible
		if (node.hasAttribute('typeof')) {
			var typeo = node.getAttribute('typeof');
			if (this['visitTYPEOF=' + typeo]) {
				return this['visitTYPEOF=' + typeo].apply(this, arguments);
			}
		}
		// use rel property if possible
		if (node.hasAttribute('rel')) {
			var rel = node.getAttribute('rel');
			if (this['visitREL=' + rel]) {
				return this['visitREL=' + rel].apply(this, arguments);
			}
		}
		// use tag name
		if (this['visit' + name]) {
			return this['visit' + name].apply(this, arguments);
		}
		//console.error('UNKNOWN TAG', name);
		return this.visitChildren.apply(this, arguments);

	case node.TEXT_NODE:
	case node.CDATA_SECTION_NODE:
		this.format.write(node.data.replace(/\s+/g, ' '));
		break;

	//case node.PROCESSING_INSTRUCTION_NODE:
	//case node.DOCUMENT_TYPE_NODE:
	//case node.COMMENT_NODE:
	default:
		// swallow it up
		break;
	}
};

// Generic helper to recurse into the children of the given node.
Visitor.prototype.visitChildren = function(node) {
	for (var i = 0, n = node.childNodes.length; i < n; i++) {
		this.visit(node.childNodes[i]);
	}
};

Visitor.prototype.visitBODY = function(node) {
	var title = this.document.title;
	// use dc:isVersionOf if present
	var ivo = this.document.querySelector('link[rel="dc:isVersionOf"][href]');
	if (ivo) {
		title = ivo.getAttribute('href').replace(/^.*\//, '');
	}
	// titles use _ instead of ' '
	title = title.replace(/_/g, ' ');
	this.visitChildren(node);
};

Visitor.prototype.visitA = function(node) {
	var href = node.getAttribute('href');
	if (href && !this.inHeading && !node.querySelector('img')) {
		if (/^#/.test(href)) {
			href = href.substring(1);
			return this.wrap('\\hyperlink{' + href + '}', node);
		} else {
			href = url.resolve(this.base, href);
			href = href.replace(/[#%\\]/g, '\\$&'); // escape TeX specials
			return this.wrap('\\href{' + href + '}', node);
		}
	}
	this.visitChildren(node);
};

Visitor.prototype.visitP = function(node) {
	this.format.paragraphBreak();
	this.visitChildren(node);
	this.format.paragraphBreak();
};

var tag2cmd = {
	'B': '\\textbf',
	'I': '\\emph',
	'EM': '\\emph',
	'SUB': '\\textsubscript',
	'SUP': '\\textsuperscript*', // "real" superscript doesn't render []
	'SMALL': '\\textsmall'
};
var visitINLINE =
Visitor.prototype.visitSMALL =
Visitor.prototype.visitB =
Visitor.prototype.visitI =
Visitor.prototype.visitEM =function(node, name) {
	return this.wrap(tag2cmd[name || node.nodeName], node);
};

Visitor.prototype.visitSUP =
Visitor.prototype.visitSUB = function(node, name) {
	name = name || node.nodeName;
	if (node.childNodes.length === 1 &&
		node.childNodes[0].nodeType === node.TEXT_NODE &&
		/^[0-9]+$/.test(node.childNodes[0].data)) {
		var c = (name === 'SUP') ? '^' : '_';
		return this.format.writeDecorated(
			'$' + c + '{' + node.childNodes[0].data + '}$'
		);
	}
	return visitINLINE.call(this, node, name);
};

var tag2env = {
	'CENTER': 'center',
	'BLOCKQUOTE': 'quotation',
	'UL': 'itemize',
	'OL': 'enumerate'
};
var visitENV =
Visitor.prototype.visitBLOCKQUOTE =
Visitor.prototype.visitCENTER = function(node) {
	var envname = tag2env[node.nodeName];
	var isList = /OL|UL/.test(node.nodeName);
	this.format.begin(envname);
	if (isList) {
		this.format.inList++; // keep list direction consistent
	}
	this.visitChildren(node);
	this.format.end(envname);
	if (isList) {
		this.format.inList--;
	}
};

Visitor.prototype.visitBR = function(node) {
	/* jshint unused: vars */
	this.format.lineBreak();
};

Visitor.prototype.visitWBR = function(node) {
	/* jshint unused: vars */
	this.format.write('\u200B'); // ZERO WIDTH SPACE
};

// Levels of LaTeX sectioning hierarchy.
// Used when translating <h1>, <h2>, etc.
var LATEX_LEVELS = [
	'chapter', 'section', 'subsection', 'subsubsection', 'paragraph',
	// bottom out the hierarchy at subparagraph
	'subparagraph', 'subparagraph', 'subparagraph', 'subparagraph'
];

// H1s are "at the same level as the page title".
// Don't allow them in single item collections, as the article class doesn't
// allow \chapters
Visitor.prototype.visitHn = function(node, n) {
	if (this.options.isAttribution) {
		if (this.options.hasChapters) { n -= 1; }
	} else if (!this.options.hasChapters) { n -= 1; }
	if (this.options.singleItem && n === 0) {
		/* the article class doesn't allow chapters */
		return;
	}
	if (this.inHeading) {
		/* nested headings? no, sir! */
		return;
	}
	var level = LATEX_LEVELS[n];
	this.format.paragraphBreak();

	var tocPoly = Polyglossia.lookup(this.tocLanguage);
	var curPoly = Polyglossia.lookup(this.currentLanguage);
	var oldContextDir= this.format.contextDir;
	if (this.currentLanguage !== this.tocLanguage) {
		this.format.begin(tocPoly.env, tocPoly.options);
		updateLTRfont(this.format, tocPoly);
		this.format.switchDir(tocPoly.dir, {implicit:true});
	}
	// reset the language/directionality
	var setLangThenVisitChildren = function(node) {
		this.format.dirBreak();
		if (this.currentLanguage !== this.tocLanguage) {
			// reset language and directionality
			this.format.writeDecorated(
				'\\text' + curPoly.lang +
					((curPoly.options && !this.inHeading) ?
					 ('[' + curPoly.options + ']') : ''),
				function() {
					this.format.switchDir(curPoly.dir, {implicit:true});
					this.format.switchDir(this.currentDirectionality);
					this.format.resetSOL();
					this.visitChildren(node);
					this.format.dirBreak();
				}.bind(this)
			);
		} else {
			this.format.resetSOL();
			this.visitChildren(node);
			this.format.dirBreak();
		}
	}.bind(this);
	// evaluate the "index" heading
	this.format.inList++; // don't change context dir before section!
	this.inHeading = true; // we can't use anything with [] args
	this.format.writeDecorated('\\' + level + '[');
	setLangThenVisitChildren(node);
	this.format.writeDecorated(']{');
	this.inHeading = false;
	setLangThenVisitChildren(node);
	this.format.writeDecorated('}');
	this.format.dirBreak();
	this.format.inList--;
	if (this.currentLanguage !== this.tocLanguage) {
		this.format.end(tocPoly.env);
		this.format.switchDir(oldContextDir, {implicit:true});
		this.format.switchDir(this.currentDirectionality);
	}
	this.format.paragraphBreak();
};

Visitor.prototype.visitH1 = function(node) { return this.visitHn(node, 1); };
Visitor.prototype.visitH2 = function(node) { return this.visitHn(node, 2); };
Visitor.prototype.visitH3 = function(node) { return this.visitHn(node, 3); };
Visitor.prototype.visitH4 = function(node) { return this.visitHn(node, 4); };
Visitor.prototype.visitH5 = function(node) { return this.visitHn(node, 5); };
Visitor.prototype.visitH6 = function(node) { return this.visitHn(node, 6); };

Visitor.prototype['visitREL=dc:references'] = function(node) {
	return this.visitSUP(node, 'SUP');
};

Visitor.prototype.visitUL =
Visitor.prototype.visitOL = function(node) {
	if (!DomUtil.first_child(node)) { return; /* no items */ }
	var wasListInfo = this.listInfo;
	this.listInfo = {
		type: node.nodeName
	};
	visitENV.call(this, node);
	this.listInfo = wasListInfo;
};

Visitor.prototype.visitDL = function(node) {
	var child = DomUtil.first_child(node); // first non-ws child node
	// LaTeX requires that a description have at least one item.
	if (child === null) { return; /* no items */ }

	// recognize DL/DD used for quotations/indentation
	// node.querySelector('dl:scope > dt') !== null
	// special case DL used to indent math
	// node.querySelector('dl:scope > dd:only-child > *[typeof=...]:only-child')
	// (but domino/zest doesn't support :scope yet)
	var dd = node.firstElementChild, sawDT = false, allMath = true;
	for ( ; dd && !sawDT; dd = dd.nextElementSibling) {
		sawDT = (dd.nodeName === 'DT');
		var math = dd.firstElementChild;
		if (!(math && !math.nextElementSibling &&
			  math.getAttribute('typeof') === 'mw:Extension/math')) {
			allMath = false;
		}
	}
	if (allMath && !sawDT) {
		var v = this['visitTYPEOF=mw:Extension/math'].bind(this);
		for (dd = node.firstElementChild; dd; dd = dd.nextElementSibling) {
			v(dd.firstElementChild, "display");
		}
		return;
	}

	// ok, generate description or quotation environment
	var wasListInfo = this.listInfo;
	this.listInfo = {
		type: sawDT ? node.nodeName : 'BLOCKQUOTE'
	};
	var envName = sawDT ? 'description' :
		this.options.parindent ? 'quotation' : 'quote';
	this.format.begin(envName);
	if (envName === 'description') {
		this.format.inList++; // keep list direction consistent
	}
	// ensure that there's an item before any contents
	if (sawDT &&
		!(child.nodeType === node.ELEMENT_NODE && child.nodeName === 'DT')) {
		this.format.writeDecorated('\\item{}');
		this.format.dirBreak(); // keep the \item out of the \LRE, etc.
		this.format.resetSOL();
		this.listInfo.sawDT = true;
	}
	this.visitChildren(node);
	this.format.end(envName);
	if (envName === 'description') {
		this.format.inList--;
	}
	this.listInfo = wasListInfo;
};

Visitor.prototype.visitDT = function(node) {
	var longDT = node.textContent.length > 60; // hackity hackity
	this.listInfo.sawDT = false;
	this.format.envBreak();
	this.format.writeDecorated('\\item[');
	if (longDT) {
		this.format.writeDecorated('\\parbox{\\columnwidth}{');
	}
	this.format.dirBreak(); // keep the \item out of the \LRE, etc.
	this.format.resetSOL();
	this.visitChildren(node);
	this.format.dirBreak();
	if (longDT) {
		this.format.writeDecorated('}');
	}
	this.format.writeDecorated(']');
	this.format.dirBreak();
	this.listInfo.sawDT = true;
};

Visitor.prototype.visitDD = function(node) {
	if (this.listInfo.type === 'BLOCKQUOTE') {
		return this.visitP(node);
	}
	// verify that previous line was the DT, otherwise add blank DT
	var prev = DomUtil.node_before(node);
	if (!(prev === null || prev.nodeName === 'DT')) {
		this.format.envBreak();
		this.format.writeDecorated('\\item{}');
		this.format.dirBreak(); // keep the \item out of the \LRE, etc.
		this.format.resetSOL();
	}
	this.visitChildren(node);
};

Visitor.prototype.visitLI = function(node) {
	this.format.envBreak();
	this.format.writeDecorated('\\item{}');
	this.format.dirBreak(); // keep the \item out of the \LRE, etc.
	this.format.resetSOL();
	this.visitChildren(node);
};

Visitor.prototype['visitREL=mw:referencedBy'] = function(node) {
	// hide this span
	/* jshint unused: vars */
};

Visitor.prototype['visitTYPEOF=mw:Extension/references'] = function(node) {
	if (!node.childNodes.length) { return; /* no items */ }
	this.format.begin('enumerate');
	this.format.inList++; // keep list direction consistent
	this.format.writeDecorated('\\small\n');
	for (var i = 0, n = node.childNodes.length; i < n; i++) {
		var ref = node.childNodes[i];
		var name = texEscape('[' + (i+1) + ']');
		if (ref.id) {
			name = '\\hypertarget{' + ref.id + '}{' + name + '}';
		}
		this.format.envBreak();
		this.format.writeDecorated('\\item[' + name + ']{}');
		this.format.dirBreak(); // keep the \item out of the \LRE, etc.
		this.format.resetSOL();
		this.visitChildren(ref);
	}
	this.format.end('enumerate');
	this.format.inList--;
};

// tables
Visitor.prototype.visitTABLE = function(node) {
	if (this.templates.has(node.getAttribute('about'))) {
		return; // already handled
	}
	// xxx hide all tables for now
};

// images!
Visitor.prototype.visitFIGURE = function(node, extraCaption) {
	var img = node.querySelector('img[resource]'),
		caption = childSelector(node, 'figcaption') || extraCaption,
		resource, filename;
	if (!img) { return; /* bail */ }
	resource = url.resolve(this.base, img.getAttribute('resource'));
	filename = this.options.imagemap.get(resource);
	if (!filename) {
		// couldn't download or convert this image.
		console.error('Skipping', resource, '(download/convert)');
		return;
	}
	if (/[.](svg|gif|ogg|ogv)$/i.test(filename)) { // skip some fmts
		console.error('Skipping', resource, '(format)');
		return;
	}
	if (this.inFloat) { // xxx work around issues with inline images
		console.error('Skipping', resource, '(float)');
		return;
	}
	// find page number for PDFs (this is a parsoid workaround)
	if (/[.]pdf$/i.test(resource)) {
		var page = '1';
		try {
			var data = JSON.parse(node.getAttribute('data-parsoid'));
			data.optList.forEach(function(opt) {
				if (opt.ck!=='page') { return; }
				var m = /=(\d+)$/.exec(opt.ak);
				if (m) {
					page = m[1];
				}
			});
		} catch (e) { /* ignore */ }
		filename = path.join(filename, page + '.pdf');
		// XXX check to see if page exists, otherwise use page 1?
	}
	this.inFloat = true;
	// floats seem to revert to collectionLanguage
	this.format.begin('figure', 'tbh!');
	this.format.begin('center');
	filename = filename.replace(/[%\\_]/g, '\\$&'); // escape TeX specials
	this.format.writeDecorated('\\includegraphics[width=0.95\\columnwidth]{'+filename+'}');
	this.format.end('center');
	if (caption) {
		// we're not using \caption because we don't need figure numbering
		// also, \caption fights with \begin{center} ... \end{center}
		//this.output.push('\\caption{%');
		var curPoly = Polyglossia.lookup(this.currentLanguage);
		var oldContextDir = this.format.contextDir;
		if (this.currentLanguage !== this.tocLanguage) {
			this.format.begin(curPoly.env, curPoly.options);
			updateLTRfont(this.format, curPoly);
			this.format.switchDir(curPoly.dir, {implicit:true});
		}
		this.format.writeDecorated('\\small\\itshape\n');

		this.visitChildren(caption);
		if (this.currentLanguage !== this.tocLanguage) {
			this.format.end(curPoly.env);
			this.format.switchDir(oldContextDir, {implicit:true});
		}
		//this.output.push('}');
	}
	this.format.end('figure');
	this.inFloat = false;
};

Visitor.prototype['visitTYPEOF=mw:Extension/math'] = function(node, display) {
	this.format.envBreak();
	var math = JSON.parse(node.getAttribute('data-mw')).body.extsrc;
	// validate/translate using texvc
	var mr = texvcjs.check(math);
	if (mr.status !== '+') {
		//console.warn("Broken math markup:", math, mr.details||'');
		return; // broken math markup, suppress it
	}
	if (mr.cancel_required || mr.euro_required || mr.teubner_required) {
		//console.warn("Math markup requires additional packages");
		return;
	}
	if (display) {
		this.format.begin('equation*'); // suppress equation numbers
	} else {
		this.format.writeDecorated('$');
	}
	this.format.writeDecorated(mr.output);
	if (display) {
		this.format.end('equation*');
	} else {
		this.format.writeDecorated('$');
		this.format.envBreak();
	}
};

Visitor.prototype['visitLANG='] = function(node) {
	var r;
	var savedLanguage = this.currentLanguage;
	var savedDirectionality = this.currentDirectionality;
	var lang = node.getAttribute('lang');
	var poly = Polyglossia.lookup(lang);
	this.currentLanguage = lang;
	// doesn't change the currentDirectionality, in an HTML sense.
	// however, the language-switch command does change *xelatex*'s
	// current directionality context (so we switchDir below)
	// is this a block or a span context?
	if (this.inHeading) {
		// can't use \text... commands inside the section label.
		r = this.visit(node);
	} else if (isParagraph(node)) {
		this.format.begin(poly.env, poly.options);
		updateLTRfont(this.format, poly);
		this.format.switchDir(poly.dir, {implicit:true});
		r = this.visit(node);
		this.format.end(poly.env);
		this.format.switchDir(savedDirectionality, {implicit:true});
	} else {
		var cmd = '\\text'+poly.lang+'['+poly.options+']';
		r = this.format.writeDecorated(cmd, function() {
			this.format.switchDir(poly.dir, {implicit:true});
			var rr = this.visit(node);
			return rr;
		}.bind(this));
		this.format.switchDir(savedDirectionality, {implicit:true});
	}
	this.currentLanguage = savedLanguage;
	return r;
};

Visitor.prototype['visitDIR='] = function(node) {
	var r;
	var savedDirectionality = this.currentDirectionality;
	var dir = node.getAttribute('dir');
	//console.warn("Using non-standard DIR", this.currentLanguage, this.currentDirectionality, '->', dir);
	this.currentDirectionality = dir;
	if (this.inHeading) {
		// can't use \LR or \RL commands inside the section label.
		r = this.visit(node);
	} else {
		this.format.switchDir(dir);
		r = this.visit(node);
		this.format.switchDir(savedDirectionality);
	}
	this.currentDirectionality = savedDirectionality;
	return r;
};

Visitor.prototype['visitTYPEOF=mw:Image'] =
Visitor.prototype['visitTYPEOF=mw:Image/Thumb'] = function(node) {
	var img = node.querySelector('img[resource]');
	var h = +img.getAttribute('height') || 0;
	var w = +img.getAttribute('width') || 0;
	if ((h !== 0 || w !== 0) && (h<=16 && w<=16)) {
		// skip small (inline) icons
		// xxx render them inline?
		return;
	}
	return this.visitFIGURE(node);
};

// hack to support double/triple image template
Visitor.prototype.visitMultipleImage = function(node) {
	var about = node.getAttribute('about');
	this.templates.add(about);
	node = node.parentElement; // hop up one level so we can see siblings
	var sel = 'table[about="' + about + '"] tr ';
	var images = node.querySelectorAll(sel + '> td > *[typeof="mw:Image"]');
	var captions = node.querySelectorAll(sel + '+ tr > td > *[class="thumbcaption"]');
	for (var i=0, n=images.length; i < n ; i++) {
		this.visitFIGURE(images[i], captions[i]);
	}
};


// hack to support triple image template
Visitor.prototype.visitDIV = function(node) {
	if (isMultipleImageTemplate(node)) {
		return this.visitMultipleImage(node);
	}
	this.format.lineBreak();
	var r = this.visitChildren(node);
	this.format.lineBreak();
	return r;
};

// ---------------------------------------------------------------------
// Bundle, image, and file processing
//
// This code is largely asynchronous.  It chains promises together
// to manage the concurrency without callback hell.  It uses the
// ES6 Promise api, from the npm `es6-shim` and `prfun` packages.
// The `prfun` package has a nice implementation of guards, which is
// an easy way to limit the maximum parallelism of a task to ensure
// we don't spam the host with hundreds of tasks at once.
// We also use `P`, a set of helpers for promises that make it easier
// to work with methods which accept node-style callbacks.

// Helper: hard link a directory, recursively.
var cprl = function(from, to) {
	return P.call(fs.mkdir, fs, to).then(function() {
		return P.call(fs.readdir, fs, from);
	}).map(function(file) {
		var pathfrom = path.join(from, file);
		var pathto   = path.join(to,   file);
		return P.call(fs.lstat, fs, pathfrom).then(function(stats) {
			if (stats.isFile()) {
				return P.call(fs.link, fs, pathfrom, pathto);
			}
			if (stats.isDirectory()) {
				return cprl(pathfrom, pathto);
			}
			// ignore other file types (symlink, block device, etc)
		});
	});
};

// Step 1a: unpack a bundle, and return a promise for the builddir
// and control file contents.
var unpackBundle = function(options) {
	var builddir, status = options.status;

	status.createStage(0, 'Unpacking content bundle');

	// first create a temporary directory
	return P.call(tmp.dir, tmp, {
		prefix: json.name,
		dir: options.tmpdir,
		unsafeCleanup: !(options.debug || options.latex)
	}).then(function(_builddir) {
		builddir = _builddir;
		// make bundle and latex subdirs
		return Promise.join(
			P.call(fs.mkdir, fs, path.join(builddir, 'bundle')),
			P.call(fs.mkdir, fs, path.join(builddir, 'latex'))
		);
	}).then(function() {
		// now unpack the zip archive
		var bundledir = path.join(builddir, 'bundle');
		return P.spawn('unzip', [ path.resolve( options.bundle ) ], {
			cwd: bundledir
		});
	}).then(function() {
		return builddir;
	});
};

// Step 1b: we were given a bundle directory.  Create a tmpdir and then
// hard link the bundle directory into it.  Be sure your TMPDIR is
// on the same filesystem as the provided bundle directory if you
// want this to be fast.
var hardlinkBundle = function(options) {
	var builddir, status = options.status;

	status.createStage(0, 'Creating work space');
	// first create a temporary directory
	return P.call(tmp.dir, tmp, {
		prefix: json.name,
		dir: options.tmpdir,
		unsafeCleanup: !(options.debug || options.latex)
	}).then(function(_builddir) {
		builddir = _builddir;
		// make latex subdir
		return Promise.join(
			// make latex subdir
			P.call(fs.mkdir, fs, path.join(builddir, 'latex')),
			// hardlink bundledir into 'bundle'
			cprl(path.resolve( options.bundle ), path.join(builddir, 'bundle')).
				catch(function(e) {
					// slightly helpful diagnostics
					if (e.code === 'EXDEV') {
						throw new Error(
							"TMPDIR must be on same filesystem as bundle dir"
						);
					}
					throw e;
				})
		);
	}).then(function() {
		return builddir;
	});
};

// Helper: rename a file.  If the desired filename already exists, then
// pick a new unique name (based on `newbase`).  Uses `guard` to
// ensure that renames aren't executed in parallel, and thus we can
// ensure that filenames are unique without tying ourself in knots.
// Returns a promise for the new name (which might differ from both
// `oldname` and `newbase`).
var renameFile = Promise.guard(1, function(dir, oldname, newbase) {
	var exists = function(path, cb) {
		// fs.exists doesn't take the usual 'err' as 1st argument.  fix that.
		this.exists(path, function(exists) { cb(null, exists); });
	};
	return P.call(exists, fs, path.join(dir, newbase)).then(function(exists) {
		if (!exists) {
			return path.join(dir, newbase);
		}
		// use the tmp module to come up with a unique alternative name
		return P.call(tmp.tmpName, tmp, {
			dir: dir,
			prefix: '',
			postfix: newbase
		});
	}).then(function(uniqname) {
		// rename the file, then return the new filename (relative to dir)
		return P.call(fs.rename, fs, path.join(dir, oldname), uniqname).
			then(function() { return path.relative(dir, uniqname); });
	});
});

// Convert gif to png using imagemagick.
// Takes a {imagedir,filename}, returns a promise for an
// {imagedir,filename} with the converted filename.
var convertGif = Promise.guard(5, function(info) {
	return P.call(tmp.tmpName, tmp, {
		dir: info.imagedir,
		prefix: info.filename.replace(/[.]gif/gi, ''),
		postfix: '.png'
	}).then(function(name) {
		return P.call(easyimage.convert, easyimage, {
			src: path.join(info.imagedir, info.filename),
			dst: name
		}).then(function() {
			info.filename = path.relative(info.imagedir, name);
			return info;
		});
	});
});

// Convert svg to pdf using rsvg-convert or inkscape.
// Takes a {imagedir,filename}, returns a promise for an
// {imagedir,filename} with the converted filename.
var convertSvg = Promise.guard(5, function(info) {
	return P.call(tmp.tmpName, tmp, {
		dir: info.imagedir,
		// note that xelatex/graphicx gets confused if it finds .svg in the
		// filename.  so make sure that doesn't happen.
		prefix: info.filename.replace(/[.]svg/ig, ''),
		postfix: '.pdf'
	}).then(function(name) {
		return P.spawn('rsvg-convert', [
			'-f', 'pdf', '-o', name, path.join(info.imagedir, info.filename)
		], { cwd: info.imagedir }).catch(function() {
			// use inkscape if rsvg-convert isn't available
			return P.spawn('inkscape', [
				'-f', path.join(info.imagedir, info.filename),
				'-A', name
			], { cwd: info.imagedir });
		}).then(function() {
			info.filename = path.relative(info.imagedir, name);
			return info;
		});
	});
});

// Remove JFIF resolution information from JPGs; bogus resolution information
// can cause LaTeX to abort with a "dimension too large" error if the
// computed "actual size" of the image is enormous (regardless of the fact
// that we're going to scale it to fit anyway).
// Takes a {imagedir,filename}, returns a promise for an
// {imagedir,filename} with the converted filename.
var convertJpg = Promise.guard(5, function(info) {
	var p = info.options.skipJpegtran ? Promise.resolve(info) :
		renameFile(info.imagedir, info.filename, 'X' + info.filename).
		then(function(tmpname) {
			// use jpegtran to strip exif info
			return P.spawn('jpegtran', [
				'-optimize', '-copy', 'none',
				'-outfile', path.join(info.imagedir, info.filename),
				path.join(info.imagedir, tmpname)
			]);
		});
	return p.then(function() {
		return P.spawn('mogrify', [
			'-density', '600',
			path.join(info.imagedir, info.filename)
		]);
	}).then(function() {
		// no change in filename (overwrite in place)
		return info;
	});
});

// extract all the pages of the PDF as separate files
var separatePdf = Promise.guard(5, function(info) {
	var tmpname;
	return renameFile(info.imagedir, info.filename, 'X' + info.filename).
		then(function(_tmpname) {
			tmpname = path.join(info.imagedir, _tmpname);
		}).then(function() {
			// make old filename into a directory
			return P.call(fs.mkdir, fs,
				path.join(info.imagedir, info.filename));
		}).then(function() {
			return P.spawn('pdfseparate', [
				tmpname,
				path.join(info.imagedir, info.filename, '%d.pdf')
			]);
		}).then(function() {
			return P.call(fs.unlink, fs, tmpname);
		}).then(function() {
			// no change in filename
			return info;
		});
});

// Step 2: process and rename images.
// Return a promise for a map from file resource URLs to on-disk filenames
// (after image processing / renaming has been done).
var processImages = function(metabook, builddir, options) {
	var status = options.status;
	var imagedir = path.join(builddir, 'bundle', 'images');
	var imagemap = new Map();
	var imagedb = new Db(
		path.join(builddir, 'bundle', 'imageinfo.db'), { readonly: true }
	);
	var p = imagedb.count().then(function(n) {
		status.createStage(n, 'Processing media files');
	});
	return imagedb.forEach(function(key, val) {
		var filename = val.filename;
		p = p.then(function() {
			// status reporting is serialized
			status.report(null, filename || '');
		});
		if (!filename) { return; }
		if (!/^https?:\/\//.test(key)) {
			// compatibility with pediapress format
			key = val.resource;
		}
		// conversion/rename happens in parallel (new promise 'pp')
		var pp = Promise.resolve({
			imagedir: imagedir, filename: filename, options: options
		});
		// rename file if it is not TeX safe.
		pp = pp.then(function(info) {
			var safe = info.filename.replace(/[^A-Za-z0-9.:]+/g, '-');
			// only one '.' allowed
			safe = safe.split(/(?=[.][^.]+$)/);
			safe = safe[0].replace(/[.]/g, '-') + (safe[1] || '');
			// truncate to 64 characters (keep end w/ extension)
			safe = safe.slice(-64);
			// rename the file if necessary
			return (safe === info.filename) ? info :
				renameFile(imagedir, info.filename, safe).
				then(function(newname) {
					info.filename = newname;
					return info;
				});
		});
		// convert gifs to pngs
		if (val.mime === 'image/gif') {
			pp = pp.then(convertGif);
		}
		// convert svgs to pdfs
		if (val.mime.startsWith('image/svg')) {
			pp = pp.then(convertSvg);
		}
		// strip EXIF resolution information from jpgs
		if (val.mime === 'image/jpeg') {
			pp = pp.then(convertJpg);
		}
		// separate pages of a PDF
		if (val.mime === 'application/pdf') {
			pp = pp.then(separatePdf);
		}
		// record the final filename
		pp = pp.then(function(info) {
			imagemap.set(key, info.filename);
		}, function(err) {
			console.error(
				"Could not convert image '%s': %s (%s)",
				val.filename, val.short, err
			);
		});
		p = Promise.join(p, pp); // serialize completion
	}).then(function() {
		// wait for the queued image renames/conversions/etc.
		return p;
	}).then(function() {
		// return the promised imagemap
		return { imagemap: imagemap };
	});
};

// Helper: count total # of items in tree (used for status reporting)
var countItems = function(item) {
	return (item.items || []).reduce(function(sum, item) {
		return sum + countItems(item);
	}, 1);
};

// Step 3: generate a LaTeX file for each article, and another top-level
// one (`output.tex`) to tie everything together.
// Return a promise which will be resolved (with no value) after all the
// files have been written.
var generateLatex = function(metabook, builddir, imagemap, options) {
	var status = options.status;
	// add one to the item count to accomodate attribution 'chapter'
	status.createStage(countItems(metabook)+1, 'Processing collection');
	status.report(null, metabook.title);

	var output = fs.createWriteStream(path.join(builddir, 'output.tex'), {
		encoding: 'utf8'
	});
	var head = STD_HEADER, columns = 2;
	if (options.onecolumn || metabook.columns === 1) {
		head = head.replace(/twocolumn/, 'onecolumn');
		columns = 1;
	}
	var toc = metabook.items.length > 1;
	if (metabook.toc === true || metabook.toc === false) {
		toc = metabook.toc; // override if toc is set in the metabook spec
	}
	if (options.toc === true || options.toc === false) {
		toc = options.toc; // command-line override
	}
	if (toc) {
		head = head.replace(/\]\{article\}/, ",titlepage$&");
	}
	if (!options.parindent) {
		head += '\n\\setlength{\\parindent}{0pt}\\setlength{\\parskip}{5pt}';
	}
	// book or article?
	var hasChapters =
		metabook.items.some(function(it) { return it.type === 'chapter'; });
	var singleItem = (!hasChapters) && metabook.items.length <= 1;
	if (!singleItem) {
		head = head.replace(/\]\{article\}/, ']{report}');
	}
	// default language (for chapter headings, page numbers, etc)
	// CLI --lang option overrides
	var collectionLanguage = options.lang || metabook.lang || 'en';
	var usedLanguages = new Set();
	usedLanguages.add(collectionLanguage);
	head += '\n\\input{'+path.join(builddir, 'languages.tex')+'}';
	// emit title, subtitle, etc.
	var title = metabook.title;
	if (!title && metabook.items.length === 1) {
		title = metabook.items[0].title;
	}
	head += '\n\\hypersetup{pdftitle={' + texEscape(title) + '}}';
	head += '\n\\title{{\\Huge ' + texEscape(title) + '}';
	if (metabook.subtitle) {
		head += ' \\\\ ' + texEscape(metabook.subtitle);
	}
	head += '}';
	// image file path
	head += '\n\\graphicspath{{' + path.join(builddir, 'bundle', 'images') + '/}}';
	// start the doc!
	head += '\n\\begin{document}\\maketitle';
	if (toc) {
		head += '\n\\pagenumbering{roman}\\tableofcontents\\newpage';
		head += '\n\\pagenumbering{arabic}';
	}
	if (metabook.summary) {
		head += '\n\\begin{abstract}\n' + texEscape(metabook.summary);
		head += '\n\\end{abstract}';
	}
	head += '\n';
	output.write(head);

	// Now recurse through the item tree generating .tex files for each
	// article.
	var pdb = new Db(
		path.join(builddir, 'bundle', 'parsoid.db'), { readonly: true }
	);
	var sidb = new Db(
		path.join(builddir, 'bundle', 'siteinfo.db'), { readonly: true }
	);
	var write = {};
	write.article = function(item) {
		var isAttribution = (item.type === 'attribution');
		console.assert(item.type === 'article' || isAttribution);
		status.report('Processing', item.type, item.title);
		var revid = item.revision;
		var document, base = '', articleLanguage;
		var key = (item.wiki ? (item.wiki+'|') : '') + revid;
		var outfile = path.join(
			builddir, 'latex',
			isAttribution ? 'attribution.tex' :
				(item.wiki + '-' + revid + '.tex')
		);
		output.write('\\input{' + outfile + '}\n');
		var pContents = isAttribution ?
			P.call(fs.readFile, fs, item.filename, { encoding: 'utf8' }) :
			pdb.get(key, 'nojson');
		return pContents.then(function(data) {
			document = domino.createDocument(data);
			var baseElem = document.querySelector('head > base[href]');
			if (baseElem) {
				base = baseElem.getAttribute('href').
					replace(/^\/\//, 'https://');
			}
		}).then(function() {
			// get the siteinfo for the article's wiki
			return sidb.get(metabook.wikis[item.wiki].baseurl);
		}).then(function(siteinfo) {
			articleLanguage = siteinfo.general.lang || collectionLanguage;
		}).then(function() {
			var collectionDir = Polyglossia.lookup(collectionLanguage).dir;
			var format = new Formatter(
				fs.createWriteStream(outfile, { encoding: 'utf8' }), {
				dir: collectionDir
			});
			var visitor = new Visitor(document, format, {
				base: base,
				imagemap: imagemap,
				singleItem: singleItem,
				hasChapters: hasChapters,
				lang: collectionLanguage,
				dir: collectionDir,
				isAttribution: isAttribution
			});
			if (!isAttribution) {
				var h1 = document.createElement('h1');
				var span = document.createElement('span');
				h1.appendChild(span);
				span.textContent = item.title;
				span.lang = articleLanguage;
				visitor.visit(h1); // emit document title!
			}
			document.body.lang = document.body.lang || articleLanguage;
			document.body.dir = document.body.dir ||
				Polyglossia.lookup(document.body.lang).dir;
			visitor.visit(document.body);
			visitor.usedLanguages.forEach(function(l){ usedLanguages.add(l); });
			format.paragraphBreak();
			return format.flush().then(function() {
				return P.call(format.stream.end, format.stream, '');
			});
		});
	};
	write.chapter = function(item) {
		console.assert(item.type === 'chapter');
		status.report('Processing chapter', item.title);
		if ('columns' in item && columns !== item.columns) {
			columns = item.columns;
			output.write(columns === 1 ? '\\onecolumn\n' : '\\twocolumn\n');
		}
		output.write('\\chapter{' + texEscape(item.title) + '}\n');
		return P.forEachSeq(item.items, write.article);
	};

	return P.forEachSeq(metabook.items, function(item) {
		if (write[item.type]) {
			return write[item.type](item);
		} else {
			console.warn("Unknown item type '%s', ignoring", item.type);
		}
	}).then(function() {
		var filename = path.join(builddir, 'bundle', 'attribution.html');
		if (!fs.existsSync(filename)) {
			status.report('Processing attribution (skipped)');
			return;
		}
		// write attribution 'chapter'
		output.write('\\attributions\n');
		return write.article({
			type: 'attribution',
			filename: filename,
			title: '',
			// XXX should use options.lang to choose an appropriate wiki
			wiki: 0
		});
	}).then(function() {
		return P.call(output.end, output, STD_FOOTER);
	}).then(function() {
		// write languages file, w/ font information
		var s = '';
		usedLanguages.forEach(function(l) {
			if (l === collectionLanguage) { return; }
			s += Polyglossia.lookup(l).lang + ',';
		});
		if (s) {
			s = '\\setotherlanguages{'+s.replace(/,$/,'')+'}\n';
		}
		var poly = Polyglossia.lookup(collectionLanguage);
		s = '\\setdefaultlanguage[' + poly.options + ']{' + poly.lang + '}\n' +
			s;
		// always add bidi package, since there may be RTL text snippets
		// even in a theoretically LTR document.
		s += '\\usepackage{bidi}\n';
		// set language fonts
		var scripts = new Set(), rtl = new Set();
		usedLanguages.forEach(function(l) {
			var p = Polyglossia.lookup(l);
			scripts.add(p.script);
			if (p.dir==='rtl') { rtl.add(p.script); }
			var font = LANGUAGE_FONTS[p.lang];
			if (!font || !font.name) { return; }
			var options = font.opts ? (',' + font.opts) : '';
			if (font.cjk) {
				// use xeCJK to manage CJK font switching
				s += '\\setCJKfamilyfont{'+p.lang+'}' +
					'[Script=' + p.script + options + ']{' + font.name + '}\n';
				s += '\\newcommand{\\' + p.lang + 'font' + '}' +
					'{\\CJKfamily{' + p.lang + '}}\n';
			} else {
				// polyglossia font management
				s += '\\newfontfamily\\' + p.lang + 'font' +
					'[Script=' + p.script + options + ']{' + font.name + '}\n';
			}
		});
		// set script fonts.
		scripts.forEach(function(script) {
			var font = SCRIPT_FONTS[script];
			if (!font || !font.name) { return; }
			var options = font.opts ? (',' + font.opts) : '';
			s += '\\newfontfamily\\' + script.toLowerCase() + 'font' +
				'[Script=' + script + options + ']{' + font.name + '}\n';
			// for rtl scripts, add a version which turns off fancy script
			// features, which we will use for embedded ltr regions
			// see http://tug.org/pipermail/xetex/2014-January/025113.html
			if (!rtl.has(script)) { return; }
			s += '\\newfontfamily\\LTR' + script.toLowerCase() + 'font' +
				'{' + font.name + '}\n';
		});
		// initialize the LTRfont for the main collection language
		updateLTRfont({
			// hackity hack: this is a trivial Formatter
			writeDecorated: function(ss) { s += ss; },
			envBreak: function() {},
			resetSOL: function() {}
		}, poly);
		// write that file!
		var filename = path.join(builddir, 'languages.tex');
		return P.call(fs.writeFile, fs, filename, s, 'utf8');
	});
};

// Step 4: write LaTeX stub and/or compile to a PDF.
// Return a promise which will be resolved with no value when complete.
var compileLatex = function(builddir, options) {
	var status = options.status;
	status.createStage(0, 'Compiling PDF');

	gammalatex.setCompileCommand({
		command: "xelatex",
		options: [
			"-interaction=nonstopmode",
			"-halt-on-error",
			'-papersize=' + options.size
		],
		texpath: path.join(__dirname, '..', 'tex') + ':',
		tmpdir: builddir
	});
	gammalatex.addRerunIndicator("No file output.toc.");
	gammalatex.addRerunIndicator("Package hyperref Warning: Rerun");
	var latexOutput = '\\input{' + path.join(builddir, 'output.tex') + '}\n';

	var deferred = Promise.defer(); // this will resolve when writeStream is closed
	var writeStream;
	if (options.output) {
		writeStream = fs.createWriteStream(options.output);
	} else {
		// trivially wrap process.stdout so we don't get an error when
		// pipe() tries to close it (stdout can't be closed w/o throwing)
		writeStream = new stream.Writable({ decodeStrings: true });
		writeStream._write = function(chunk, encoding, callback) {
			return process.stdout.write(chunk, callback);
		};
	}
	writeStream.on('finish', function() { deferred.resolve(); });
	writeStream.on('close', function() { deferred.resolve(); });

	if (options.latex) {
		writeStream.end(latexOutput, 'utf8');
		return deferred.promise;
	} else {
		return P.call(gammalatex.parse, gammalatex, latexOutput).
			then(function(readStream) {
				readStream.pipe(writeStream);
				return deferred.promise;
			});
	}
};

// ---------------------------------------------------------------------

/**
 * Main entry point.
 *
 * Convert a bundle to LaTeX and/or a PDF, respecting the given `options`.
 *
 * Return a promise for an exit status (0 for success) after the bundle
 * specified in the options has been converted.
 */
var convert = function(options) {
	var status = options.status = new StatusReporter(4, function(msg) {
		if (options.log) {
			var file = msg.file ? (': ' + msg.file) : '';
			options.log('['+msg.percent.toFixed()+'%]', msg.status + file);
		}
	});
	var metabook, builddir, imagemap;
	return Promise.resolve().then(function() {
		// were we given a zip file or a directory?
		return P.call(fs.stat, fs, options.bundle);
	}).then(function(stat) {
		if (stat.isDirectory()) {
			// create a workspace and hard link the provided directory
			return hardlinkBundle(options);
		} else {
			// unpack the bundle
			return unpackBundle(options);
		}
	}).then(function(_builddir) {
		builddir = _builddir;
		// read the main metabook.json file
		return P.call(
			fs.readFile, fs,
			path.join(builddir, 'bundle', 'metabook.json'),
			{ encoding: 'utf8' }
		).then(function(data) {
			metabook = JSON.parse(data);
		});
	}).then(function() {
		// process images
		return processImages(metabook, builddir, options);
	}).then(function(args) {
		imagemap = args.imagemap;
	}).then(function() {
		// generate the latex
		return generateLatex(metabook, builddir, imagemap, options);
	}).then(function() {
		// compile it to PDF
		return compileLatex(builddir, options);
	}).then(function() {
		status.createStage(0, 'Done');
		return 0; // success!
	}, function(err) {
		// xxx clean up?
		if (options.debug) {
			throw err;
		}
		// xxx send this error to parent process, if there is one?
		console.error('Error:', err);
		return 1;
	});
};

module.exports = {
	name: json.name, // package name
	version: json.version, // version # for this package
	convert: convert
};
