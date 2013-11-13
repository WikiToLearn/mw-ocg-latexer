var json = require('../package.json');
var path = require('path');
var url = require('url');

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

var isHidden = function(node) {
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
	this.base = '';
	var base = document.querySelector('head > base');
	if (base && base.hasAttribute('href')) {
		this.base = base.getAttribute('href').replace(/^\/\//, 'https://');
	}
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
			var type = node.getAttribute('typeof');
			if (this['visitTYPEOF=' + type]) {
				return this['visitTYPEOF=' + type].apply(this, arguments);
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
		return this.visitChildren.apply(this, arguments);

	case node.TEXT_NODE:
	case node.CDATA_SECTION_NODE:
		var text = texEscape(node.data);
		// protect leading space; escape the trailing newline
		text = text.replace(/^\s+/, '{} ') + '%';
		this.output.push(text);
		break;

	case node.PROCESSING_INSTRUCTION_NODE:
	case node.DOCUMENT_TYPE_NODE:
	case node.COMMENT_NODE:
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
	this.output.push('\\title{' + texEscape(title) + '}');
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
			href = href.replace(/[%\\]/g, '\\$1'); // escape TeX specials
			return this.collect(node, function(contents) {
				this.output.push('\\href{' + href + '}{' + contents + '}%');
			});
		}
	}
	this.visitChildren(node);
}

Visitor.prototype.visitP = function(node) {
	this.output.push("");
	this.visitChildren(node);
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
};

Visitor.prototype['visitTYPEOF=mw:Extension/references'] = function(node) {
	this.output.push('\\begin{description}\\small');
	for (var i = 0, n = node.childNodes.length; i < n; i++) {
		var ref = node.childNodes[i];
		var name = texEscape('[' + (i+1) + ']');
		if (ref.id) {
			name = '\\hypertarget{' + ref.id + '}{' + name + '}';
		}
		this.output.push('\\item[' + name + ']');
		this.visitChildren(ref);
	}
	this.output.push('\\end{description}');
};

function convert(document, options) {
	var visitor = new Visitor(document, options);
	var head = STD_HEADER;
	if (options.toc) {
		head = head.replace(/\]\{article\}/, ",titlepage$&");
	}
	visitor.output.push(head);
	visitor.visit(document.body);
	visitor.output.push(STD_FOOTER);

	return visitor.output.join('\n');
}

module.exports = {
	version: json.version,
	convert: convert
};
