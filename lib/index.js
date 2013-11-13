var json = require('../package.json');
var path = require('path');

var STD_HEADER = [
	"%!TEX TS-program = xelatex",
	"%!TEX encoding = UTF-8 Unicode",
	"",
	"\\documentclass[10pt,twocolumn,twoside]{article}",
	"\\usepackage{fontspec, graphicx}",
	"\\usepackage[usenames]{color}",
	"\\setmainfont[",
	"Ligatures = {Common,TeX},",
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
	// smart quotes
	str = str.replace(/(^|\s)["](\w)/g, function(match, before, after) {
		return before + '``' + after;
	}).replace(/(\w)["](\s|$)/g, function(match, before, after) {
		return before + "''" + after;
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
	// bit of a hack: hide infobox / navbox
	if (node.classList.contains('infobox') ||
		node.classList.contains('navbox')) {
		return true;
	}
	return false;
};

var Visitor = function(document) {
	this.document = document;
	this.output = [];
};

Visitor.prototype.collect = function(node, f) {
	var o = this.output;
	this.output = [];
	this.visitChildren(node);
	// combine lines, compress paragraphs
	var text = this.output.join('\n').
		replace(/%\n\s*/g, '').
		replace(/^\{\}/, '').
		replace(/%$/, '').
		replace(/\n\n+/g, '\n');
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
	this.output.push('\\title{' + texEscape(title) + '}');
	this.output.push("\\begin{document}\\maketitle");
	this.output.push("\\tableofcontents");
	this.visitChildren(node);
	this.output.push("~\\end{document}");
};

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


function convert(document) {
	var visitor = new Visitor(document);
	visitor.output.push(STD_HEADER);
	visitor.visit(document.body);
	visitor.output.push(STD_FOOTER);

	return visitor.output.join('\n');
}

module.exports = {
	version: json.version,
	convert: convert
};
