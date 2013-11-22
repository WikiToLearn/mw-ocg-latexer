require('es6-shim');

var json = require('../package.json');

var domino = require('domino');
var easyimage = require('easyimage');
var fs = require('fs');
var gammalatex = require('gammalatex');
var guard = require('when/guard');
var path = require('path');
var status = require('./status');
var stream = require('stream');
var tmp = require('tmp');
var url = require('url');
var when = require('when');
tmp.setGracefulCleanup();

// node 0.8 compatibility
if (!stream.Writable) {
	stream = require('readable-stream');
}

var Db = require('./db');
var DomUtil = require('./domutil');
var P = require('./p');

var STD_HEADER = [
	"%!TEX TS-program = xelatex",
	"%!TEX encoding = UTF-8 Unicode",
	"",
	"\\documentclass[10pt,twocolumn,twoside]{article}",
	"\\pagestyle{headings}",
	"\\usepackage{fontspec, graphicx}",
	"\\usepackage{amsmath,amsthm,amstext,amssymb}",
	"\\usepackage[usenames]{xcolor}",
	"\\definecolor{linkcolor}{rgb}{.27,0,0}",
	"\\definecolor{citecolor}{rgb}{0,0,.27}",
	"\\usepackage[colorlinks,breaklinks,allcolors=linkcolor,linkcolor=citecolor]{hyperref}",
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
	// Set up Gentium latin fonts
	// XXX add non-latin (CJK, etc) fonts
	"\\setmainfont[",
	//"Ligatures = {Common,TeX},",
	"Path = " + path.join(__dirname, "..", "fonts") + "/ ,",
	"BoldFont = GenBasB.ttf ,",
	"ItalicFont = GenI102.ttf ,",
	"BoldItalicFont = GenBasBI.ttf ]",
	"{GenR102.ttf}",
	"\\date{}\\author{}",
].join("\n");

var STD_FOOTER = [
].join("\n");

// Convert plain text (with HTML whitespace semantics) to an appropriately
// escaped string for TeX to process.
var texEscape = function(str) {
	// protect TeX special characters
	str = str.replace(/[#$&~_^%{}\\]/g, function(c) { return '\\' + c; });
	// compress multiple newlines (and use unix-style newlines exclusively)
	str = str.replace(/\r\n?/g, '\n').replace(/\n\n+/g, '\n');
	// trim leading and trailing newlines for consistent output.
	str = str.replace(/^\n+/, '').replace(/\n$/, '');
	// non-breaking space
	str = str.replace(/\xA0/g, '~');
	// smart quotes
	// XXX smart quotes should probably be disabled in some locales
	str = str.replace(/(^|\s|\()["](\w)/g, function(match, before, after) {
		return before + '\u201C' + after;
	}).replace(/(\w|[.,])["](\s|[.,\u2014\)]|$)/g, function(match, before, after) {
		return before + "\u201D" + after;
	}).replace(/(s')|(\w's)/, function(match) {
		return match.replace(/'/, '\u2019');
	});
	return str;
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
	if (['infobox', 'navbox', 'rellink', 'dablink', 'metadata'].some(function(c) {
		return node.classList.contains(c);
	})) {
		return true;
	}
	return false;
};

/* Document node visitor class.  Collects LaTeX output as it traverses the
 * document tree. */
var Visitor = function(document, options) {
	this.document = document;
	this.options = options;
	this.output = [];
	this.templates = Object.create(null);
	this.base = options.base || '';
};

// Helper function -- collect all text from the children of `node` as
// HTML non-block/TeX non-paragraph content.  Invoke `f` with the result,
// suitable for inclusion in a TeX non-paragraph context.
Visitor.prototype.collect = function(node, f) {
	var o = this.output;
	this.output = [];
	this.visitChildren(node);
	// combine lines, compress paragraphs
	var text = this.output.join('\n').
		replace(/(^|\n)%[^\n]*(\n|$)/g, '$1'). // remove comments
		replace(/%\n\s*/g, ''). // remove escaped newlines
		replace(/%$/, '').
		replace(/^\{\}/, ''). // remove escape for start of line whitespace
		replace(/\n\n+/g, '\n'); // remove paragraphs
	this.output = o;
	return f.call(this, text);
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
		var text = texEscape(node.data);
		// protect leading space; escape the trailing newline
		text = text.replace(/^\s+/, '{} ') + '%';
		this.output.push(text);
		break;

	//case node.PROCESSING_INSTRUCTION_NODE:
	//case node.DOCUMENT_TYPE_NODE:
	//case node.COMMENT_NODE:
	default:
		// convert into latex comment (for easier debugging)
		this.output.push(texEscape(node.data).replace(/^/gm, '%'));
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
	var ivo = this.document.querySelector('link[rel="dc:isVersionOf"]');
	if (ivo && ivo.hasAttribute('href')) {
		title = ivo.getAttribute('href').replace(/^.*\//, '');
	}
	// titles use _ instead of ' '
	title = title.replace(/_/g, ' ');
	this.output.push('\\hypersetup{pdftitle={' + texEscape(title) + '}}');
	this.output.push('\\title{\\Huge ' + texEscape(title) + '}');
	if (!this.options.parindent) {
		this.output.push('\\setlength{\\parindent}{0pt}');
		this.output.push('\\setlength{\\parskip}{5pt}');
	}
	this.output.push("\\begin{document}\\maketitle");
	if (this.options.toc) {
		this.output.push("\\pagenumbering{roman}");
		this.output.push("\\tableofcontents\\newpage");
		this.output.push("\\pagenumbering{arabic}");
	}
	this.visitChildren(node);
	this.output.push("~\\end{document}");
};

Visitor.prototype.visitA = function(node) {
	var href = node.getAttribute('href');
	if (href && !node.querySelector('img')) {
		if (/^#/.test(href)) {
			href = href.substring(1);
			return this.collect(node, function(contents) {
				this.output.push('\\hyperlink{' + href + '}' +
								 '{' + contents + '}');
			});
		} else {
			href = url.resolve(this.base, href);
			href = href.replace(/[%\\]/g, '\\$&'); // escape TeX specials
			return this.collect(node, function(contents) {
				this.output.push('\\href{' + href + '}{' + contents + '}%');
			});
		}
	}
	this.visitChildren(node);
};

Visitor.prototype.visitP = function(node) {
	this.output.push("");
	var o = this.output;
	this.output = []; // make sure we don't emit a linebreak immediately
	this.visitChildren(node);
	this.output = o.concat(this.output);
	this.output.push("");
};

Visitor.prototype.visitSUB = function(node) {
	return this.collect(node, function(contents) {
		if (/^[0-9]+$/.test(contents)) {
			this.output.push('$_' + node.childNodes[0].data + '$%');
		} else {
			this.output.push('\\textsubscript{' + contents + '}%');
		}
	});
};

Visitor.prototype.visitSUP = function(node) {
	return this.collect(node, function(contents) {
		if (/^[0-9]+$/.test(contents)) {
			this.output.push('$^' + node.childNodes[0].data + '$%');
		} else {
			this.output.push('\\textsuperscript{' + contents + '}%');
		}
	});
};

Visitor.prototype.visitB = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\textbf{' + contents + '}%');
	});
};

Visitor.prototype.visitI = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\textit{' + contents + '}%');
	});
};

Visitor.prototype.visitCENTER = function(node) {
	this.output.push('\\begin{center}');
	this.visitChildren(node);
	this.output.push('\\end{center}');
};

Visitor.prototype.visitBR = function(node) {
	/* jshint unused: vars */
	if (this.output.length === 0) { return; } // xxx no line to end
	this.output.push('\\\\');
};

Visitor.prototype.visitH1 = function(node) { // not actually used by parsoid
	return this.collect(node, function(contents) {
		this.output.push('\\chapter{' + contents + '}');
	});
};

Visitor.prototype.visitH2 = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\section{' + contents + '}');
	});
};

Visitor.prototype.visitH3 = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\subsection{' + contents + '}');
	});
};

Visitor.prototype.visitH4 = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\subsubsection{' + contents + '}');
	});
};

Visitor.prototype.visitH5 = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\paragraph{' + contents + '}');
	});
};

Visitor.prototype.visitH6 = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\subparagraph{' + contents + '}');
	});
};

Visitor.prototype['visitREL=dc:references'] = function(node) {
	return this.visitSUP(node);
};

Visitor.prototype.visitUL = function(node) {
	if (!DomUtil.first_child(node)) { return; /* no items */ }
	this.output.push('\\begin{itemize}');
	this.visitChildren(node);
	this.output.push('\\end{itemize}');
};

Visitor.prototype.visitOL = function(node) {
	if (!DomUtil.first_child(node)) { return; /* no items */ }
	this.output.push('\\begin{enumerate}');
	this.visitChildren(node);
	this.output.push('\\end{enumerate}');
};

Visitor.prototype.visitLI = function(node) {
	this.output.push('\\item %');
	this.visitChildren(node);
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
	var envName = sawDT ? 'description' :
		this.options.parindent ? 'quotation' : 'quote';
	var wasBlockQuote = this.inBlockQuote;
	this.inBlockQuote = !sawDT;
	this.output.push('\\begin{'+envName+'}');
	// ensure that there's an item before any contents
	if (sawDT &&
		!(child.nodeType === node.ELEMENT_NODE && child.nodeName === 'DT')) {
		this.output.push('\\item');
	}
	this.visitChildren(node);
	this.output.push('\\end{'+envName+'}');
	this.inBlockQuote = wasBlockQuote;
};

Visitor.prototype.visitDT = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\item[' + contents + '] %');
	});
};

Visitor.prototype.visitDD = function(node) {
	if (this.inBlockQuote) {
		return this.visitP(node);
	}
	// verify that previous line was the DT, otherwise add blank DT
	var prev = DomUtil.node_before(node);
	if (!(prev === null || prev.nodeName === 'DT')) {
		this.output.push('\\item');
	}
	this.visitChildren(node);
};

Visitor.prototype.visitLI = function(node) {
	this.output.push('\\item %');
	this.visitChildren(node);
};

Visitor.prototype.visitBLOCKQUOTE = function(node) {
	this.output.push('\\begin{quotation}');
	this.visitChildren(node);
	this.output.push('\\end{quotation}');
};

Visitor.prototype['visitREL=mw:referencedBy'] = function(node) {
	// hide this span
	/* jshint unused: vars */
};

Visitor.prototype['visitTYPEOF=mw:Extension/references'] = function(node) {
	this.output.push('\\begin{enumerate}\\small');
	for (var i = 0, n = node.childNodes.length; i < n; i++) {
		var ref = node.childNodes[i];
		var name = texEscape('[' + (i+1) + ']');
		if (ref.id) {
			name = '\\hypertarget{' + ref.id + '}{' + name + '}';
		}
		this.output.push('\\item[' + name + ']');
		this.visitChildren(ref);
	}
	this.output.push('\\end{enumerate}');
};

// tables
Visitor.prototype.visitTABLE = function(node) {
	if (node.getAttribute('about') in this.templates) {
		return;
	}
	// xxx hide all tables for now
};

// images!
Visitor.prototype.visitFIGURE = function(node, extraCaption) {
	var img = node.querySelector('img[resource]'),
		caption = node.querySelector('figcaption') || extraCaption,
		resource, filename;
	if (!img) { return; /* bail */ }
	resource = url.resolve(this.base, img.getAttribute('resource'));
	filename = this.options.imagemap.get(resource);
	if (!filename) {
		// couldn't download this image.
		console.error('Skipping', resource);
		return;
	}
	if (/[.](svg|gif|ogg|ogv)$/i.test(filename)) { return; } // skip some fmts
	if (this.inFloat) { return; } // xxx work around issues with inline images
	this.inFloat = true;
	this.output.push('\\begin{figure}[tbh]');
	this.output.push('\\begin{center}');
	filename = filename.replace(/[%\\_]/g, '\\$&'); // escape TeX specials
	this.output.push('\\includegraphics[width=0.95\\columnwidth]{'+filename+'}');
	this.output.push('\\end{center}');
	if (caption) {
		// we're not using \caption because we don't need figure numbering
		// also, \caption fights with \begin{center} ... \end{center}
		//this.output.push('\\caption{%');
		this.output.push('\\small\\it');
		this.visitChildren(caption);
		//this.output.push('}');
	}
	this.output.push('\\end{figure}');
	this.inFloat = false;
};

Visitor.prototype['visitTYPEOF=mw:Extension/math'] = function(node, display) {
	// xxx: sanitize this string the same way the math extension does

	var math = JSON.parse(node.getAttribute('data-mw')).body.extsrc;
	var m = /^(\s*\\begin\s*\{\s*(?:eqnarray|equation|align|gather|falign|multiline|alignat))[*]?(\s*\}[\s\S]*\\end\s*\{[^\}*]+)[*]?(\}\s*)$/.exec(math);
	if (m) {
		// math expression contains its own environment
		// ensure we're using the * form so we don't get equation numbers
		this.output.push(m[1]+'*'+m[2]+'*'+m[3]);
		return;
	}
	var delimit = display ? '$$' : '$';
	var eol = display ? '' : '%';
	this.output.push(delimit + math + delimit + eol);
};

Visitor.prototype['visitTYPEOF=mw:Image'] =
Visitor.prototype['visitTYPEOF=mw:Image/Thumb'] = function(node) {
	return this.visitFIGURE(node);
};

// hack to support double/triple image template
Visitor.prototype.visitMultipleImage = function(node) {
	var about = node.getAttribute('about');
	this.templates[about] = true;
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
	// xxx enforce line breaks before/after?
	return this.visitChildren(node);
};

// ---------------------------------------------------------------------
// Bundle, image, and file processing

// return a promise for the builddir and control file contents
// (after the bundle has been unpacked)
var unpackBundle = function(options) {
	var metabook, builddir;

	status.createStage(0);

	// first create a temporary directory
	return P.call(tmp.dir, tmp, {
		prefix: json.name,
		unsafeCleanup: !(options.debug || options.latex)
	}).then(function(_builddir) {
		status.report('Reading data bundle for document construction');

		builddir = _builddir;
		// make bundle and latex subdirs
		return when.join(
			P.call(fs.mkdir, fs, path.join(builddir, 'bundle')),
			P.call(fs.mkdir, fs, path.join(builddir, 'latex'))
		);
	}).then(function() {
		// now unpack the zip archive
		var bundledir = path.join(builddir, 'bundle');
		options.log('Unpacking bundle in', bundledir);
		return P.spawn('unzip', [ path.resolve( options.bundle ) ], {
			cwd: bundledir
		});
	}).then(function() {
		// now read in the main metabook.json file
		return P.call(
			fs.readFile, fs, path.join(builddir, 'bundle', 'metabook.json')
		).then(function(data) {
			metabook = JSON.parse(data);
		});
	}).then(function() {
		return { metabook: metabook, builddir: builddir };
	});
};

// return a promise to have renamed a file.  uses 'guard' to ensure that
// renames aren't executed in parallel (and thus we can ensure that
// filenames are unique without tying ourself in knots).  Returns the
// new name (which might differ from the basename given)
var renameFile = guard(guard.n(1), function(dir, oldname, newbase) {
	var deferred = when.defer(); // stores the safe uniq-ified name
	P.call(fs.exists, fs, path.join(dir, newbase)).then(function(exists) {
		if (!exists) {
			return deferred.resolve(path.join(dir, newbase));
		}
		// use the tmp module to come up with a unique alternative
		return P.call(tmp.tmpName, tmp, {
			dir: dir,
			prefix: '',
			postfix: newbase
		}).then(function(name) {
			deferred.resolve(name);
		});
	}).done();
	return deferred.promise.then(function(uniqname) {
		// rename the file, then return the new filename (relative to dir)
		return P.call(fs.rename, fs, path.join(dir, oldname), uniqname).
			then(function() { return path.relative(dir, uniqname); });
	});
});

// Convert gif to png using imagemagick.
// Takes a {imagedir,filename}, returns a promise for an
// {imagedir,filename} with the converted filename.
var convertGif = guard(guard.n(5), function(info) {
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
var convertSvg = guard(guard.n(5), function(info) {
	return P.call(tmp.tmpName, tmp, {
		dir: info.imagedir,
		// note that xelatex/graphicx gets confused if it finds .svg in the
		// filename.  so make sure that doesn't happen.
		prefix: info.filename.replace(/[.]svg/ig, ''),
		postfix: '.pdf'
	}).then(function(name) {
		return P.spawn('rsvg-convert', [
			'-f', 'pdf', '-o', name, path.join(info.imagedir, info.filename)
		], { cwd: info.imagedir }).otherwise(function() {
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


// return a promise for a map from file resource URLs to on-disk filenames
// (after image processing / renaming has been done)
var processImages = function(metabook, builddir, options) {
	options.log('Processing images');
	var imagedir = path.join(builddir, 'bundle', 'images');
	var imagemap = new Map();
	var imagedb = new Db(
		path.join(builddir, 'bundle', 'imageinfo.db'), { readonly: true }
	);
	var p = when.resolve();

	status.createStage(imagedb.length);
	return imagedb.forEach(function(key, val) {
		status.report('Processing media files for inclusion', val.filename);
		if (!/^https?:\/\//.test(key)) {
			// compatibility with pediapress format
			key = val.resource;
		}
		var filename = val.filename;
		if (!filename) { return; }
		var pp = when.resolve({ imagedir: imagedir, filename: filename });
		// convert gifs to pngs
		if (val.mime === 'image/gif') {
			pp = pp.then(convertGif);
		}
		// convert svgs to pdfs
		if (val.mime.startsWith('image/svg')) {
			pp = pp.then(convertSvg);
		}
		// rename file if it is not TeX safe.
		pp = pp.then(function(info) {
			var safe = info.filename.replace(/[^A-Za-z0-9.:]+/g, '-');
			return (safe === info.filename) ? safe :
				renameFile(imagedir, info.filename, safe);
		}).then(function(newname) {
			imagemap.set(key, path.join(imagedir, newname));
		});
		p = when.join(p, pp); // serialize completion
	}).then(function() {
		// do the queued image renames/conversions/etc.
		return p;
	}).then(function() {
		// return the promised imagemap
		return { imagemap: imagemap };
	});
};

// Return an empty promise after the output.tex file has been written.
var generateLatex = function(metabook, builddir, imagemap, options) {
	var output = fs.createWriteStream(path.join(builddir, 'output.tex'), {
		encoding: 'utf8'
	});
	var head = STD_HEADER;
	if (options.onecolumn) {
		head = head.replace(/twocolumn/, 'onecolumn');
	}
	if (options.toc) {
		head = head.replace(/\]\{article\}/, ",titlepage$&");
	}
	var p = P.call(output.write, output, head);

	status.createStage(1 /* XXX This should be the total number of nodes we're going to visit */);

	// XXX HACK ONLY VISIT THE FIRST ITEM
	var item = metabook;
	while (item.type !== 'article') {
		item = item.items[0];
	}
	var revid = item.revision;
	var pdb = new Db(
		path.join(builddir, 'bundle', 'parsoid.db'), { readonly: true }
	);
	var document, base = '';
	p = p.then(function() {
		return pdb.get(revid, 'nojson');
	}).then(function(data) {
		document = domino.createDocument(data);
		var baseElem = document.querySelector('head > base[href]');
		if (baseElem) {
			base = baseElem.getAttribute('href').replace(/^\/\//, 'https://');
		}
	});
	p = p.then(function() {
		var visitor = new Visitor(document, {
			base: base,
			toc: options.toc,
			imagemap: imagemap,
			parindent: false
		});
		status.report('Traversing page DOM', item.title); /* XXX Call this for every node */
		visitor.visit(document.body);
		var result = visitor.output.join('\n');
		return P.call(output.write, output, result);
	});

	p = p.then(function() {
		return P.call(output.end, output, STD_FOOTER);
	});
	return p;
};

// Return an empty promise after the latex has been either written or
// compiled to a PDF.
var compileLatex = function(builddir, options) {
	options.log('Compiling to PDF with xelatex');
	status.createStage(0);
	status.report('Compiling to PDF with xelatex');

	gammalatex.setCompileCommand({
		command: "xelatex",
		options: [
			"-interaction=nonstopmode",
			"-halt-on-error",
			'-papersize=' + options.size
		]
	});
	gammalatex.addRerunIndicator("No file output.toc.");
	gammalatex.addRerunIndicator("Package hyperref Warning: Rerun");
	var latexOutput = '\\input{' + path.join(builddir, 'output.tex') + '}\n';

	var deferred = when.defer(); // this will resolve when writeStream is closed
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
		options.log('Writing LaTeX');
		writeStream.end(latexOutput, 'utf8');
	} else {
		P.call(gammalatex.parse, gammalatex, latexOutput).
			then(function(args) {
				var readStream = args[0];
				options.log('Saving PDF');
				readStream.pipe(writeStream);
			}).done();
	}
	return deferred.promise;
};

// Return a promise for an exit status (0 for success) after the bundle
// specified in the options has been converted.
var convert = function(options) {
	var metabook, builddir, imagemap;
	return when.resolve().then(function() {
		// unpack the bundle
		return unpackBundle(options);
	}).then(function(args) {
		metabook = args.metabook;
		builddir = args.builddir;
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
		options.log('Done.');
		return 0; // success!
	}, function(err) {
		// xxx clean up?
		if (options.debug) {
			throw err;
		}
		console.error('Error:', err);
		return 1;
	});
};

module.exports = {
	version: json.version, // version # for this code
	convert: convert
};
