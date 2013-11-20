var json = require('../package.json');

var domino = require('domino');
var fs = require('fs');
var gammalatex = require('gammalatex');
var infozip = require('infozip');
var nodefn = require('when/node/function');
var path = require('path');
var stream = require('stream');
var tmp = require('tmp');
var url = require('url');
var when = require('when');
tmp.setGracefulCleanup();

var Db = require('./db');

// my own version of nodefn.call with an explicit 'this', used for methods
var pcall = function(fn, self) {
	var args = Array.prototype.slice.call(arguments, 2);
	return nodefn.apply(fn.bind(self), args);
};

var STD_HEADER = [
	"%!TEX TS-program = xelatex",
	"%!TEX encoding = UTF-8 Unicode",
	"",
	"\\documentclass[10pt,twocolumn,twoside]{article}",
	"\\pagestyle{headings}",
	"\\usepackage{fontspec, graphicx}",
	"\\usepackage[usenames]{color}",
	"\\definecolor{linkcolor}{rgb}{.27,0,0}",
	"\\definecolor{citecolor}{rgb}{0,0,.27}",
	"\\usepackage[colorlinks,breaklinks,allcolors=linkcolor,linkcolor=citecolor]{hyperref}",
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

var texEscape = function(str) {
	// protect special characters
	str = str.replace(/[#$&~_^%{}\\]/g, function(c) { return '\\' + c; });
	// compress multiple newlines (and use unix-style newlines exclusively)
	str = str.replace(/\r\n?/g, '\n').replace(/\n\n+/g, '\n');
	// trim leading and trailing newlines for consistent output.
	str = str.replace(/^\n+/, '').replace(/\n$/, '');
	// non-breaking space
	str = str.replace(/\xA0/g, '~');
	// smart quotes
	str = str.replace(/(^|\s|\()["](\w)/g, function(match, before, after) {
		return before + '\u201C' + after;
	}).replace(/(\w|[.,])["](\s|[.,\u2014\)]|$)/g, function(match, before, after) {
		return before + "\u201D" + after;
	}).replace(/(s')|(\w's)/, function(match) {
		return match.replace(/'/, '\u2019');
	});
	return str;
};

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
	// bit of a hack: hide infobox / navbox / rellink / dablink
	if (['infobox', 'navbox', 'rellink', 'dablink', 'metadata'].some(function(c) {
		return node.classList.contains(c);
	})) {
		return true;
	}
	return false;
};

var Visitor = function(document, options) {
	this.document = document;
	this.options = options;
	this.output = [];
	this.templates = Object.create(null);
	this.base = options.base || '';
};

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
	this.output.push('\\begin{itemize}');
	this.visitChildren(node);
	this.output.push('\\end{itemize}');
};

Visitor.prototype.visitOL = function(node) {
	this.output.push('\\begin{enumerate}');
	this.visitChildren(node);
	this.output.push('\\end{enumerate}');
};

Visitor.prototype.visitLI = function(node) {
	this.output.push('\\item %');
	this.visitChildren(node);
};

Visitor.prototype.visitDL = function(node) {
	this.output.push('\\begin{description}');
	this.visitChildren(node);
	this.output.push('\\end{description}');
};

Visitor.prototype.visitDT = function(node) {
	return this.collect(node, function(contents) {
		this.output.push('\\item[' + contents + '] %');
	});
};

Visitor.prototype.visitDD = function(node) {
	this.visitChildren(node);
};

Visitor.prototype.visitLI = function(node) {
	this.output.push('\\item %');
	this.visitChildren(node);
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
	filename = (this.options.imagemap || {})[resource];
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

// return a promise for the latex output (after the bundle has been
// unpacked and processed)
var unpackBundle = function(options) {
	var metabook, builddir;
	// first create a temporary directory
	return pcall(tmp.dir, tmp, {
		prefix: json.name,
		unsafeCleanup: !options.debug
	}).then(function(_builddir) {
		builddir = _builddir;
		// now unpack the zip archive
		options.log('Unpacking bundle in', builddir);
		var ZipInfo = new infozip(options.bundle);
		return pcall(ZipInfo.extractTo, ZipInfo, builddir, [], {});
	}).then(function() {
		// now read in the main metabook.json file
		return pcall(fs.readFile, fs, path.join(builddir, 'metabook.json'))
			.then(function(data) {
				metabook = JSON.parse(data);
			});
	}).then(function() {
		// XXX process images?
		return { metabook: metabook, builddir: builddir };
	});
};

var generateLatex = function(metabook, builddir, options) {
	var output = fs.createWriteStream(path.join(builddir, 'output.tex'), {
		encoding: 'utf8'
	});
	var head = STD_HEADER;
	if (options.toc) {
		head = head.replace(/\]\{article\}/, ",titlepage$&");
	}
	var p = pcall(output.write, output, head);

	// XXX HACK ONLY VISIT THE FIRST ITEM
	var item = metabook.items[0];
	var revid = item.revision;
	var pdb = new Db(path.join(builddir, 'parsoid.db'), { readonly: true });
	var document;
	p = p.then(function() {
		return pdb.get(revid, 'nojson');
	}).then(function(data) {
		document = domino.createDocument(data);
	});
	p = p.then(function() {
		var visitor = new Visitor(document, { toc: options.toc });
		visitor.visit(document.body);
		var result = visitor.output.join('\n');
		return pcall(output.write, output, result);
	});

	p = p.then(function() {
		return pcall(output.end, output, STD_FOOTER);
	});
	return p;
};

var compileLatex = function(builddir, options) {
	options.log('Compiling to PDF with xelatex');
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

	var deferred = when.defer();
	var writeStream;
	if (options.output) {
		writeStream = fs.createWriteStream(options.output);
	} else {
		// trivially wrap process.stdout so we don't get an error when
		// pipe() tries to close it (stdout can't be closed)
		writeStream = new stream.Writable();
		writeStream._write = function(chunk, encoding, callback) {
			return process.stdout.write(chunk, encoding, callback);
		};
	}
	writeStream.on('finish', function() { deferred.resolve(); });

	if (options.debug) {
		options.log('Writing LaTeX');
		writeStream.end(latexOutput, 'utf8');
	} else {
		pcall(gammalatex.parse, gammalatex, latexOutput).
			then(function(args) {
				var readStream = args[0];
				options.log('Saving PDF');
				readStream.pipe(writeStream);
			}).done();
	}
	return deferred.promise;
};

var convert = function(options) {
	var metabook, builddir;
	return when.resolve().then(function() {
		// unpack the bundle
		return unpackBundle(options);
	}).then(function(args) {
		metabook = args.metabook;
		builddir = args.builddir;
		// generate the latex
		return generateLatex(metabook, builddir, options);
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
	version: json.version,
	convert: convert
};
