var json = require('../package.json');
var path = require('path');

var STD_HEADER = [
	"%!TEX TS-program = xelatex",
	"%!TEX encoding = UTF-8 Unicode",
	"",
	"\\documentclass[11pt]{article}",
	"\\usepackage{fontspec, graphicx}",
	"\\usepackage[usenames]{color}",
	"\\setmainfont[",
	"Path = " + path.join(__dirname, "..", "fonts") + "/ ,",
	"BoldFont = GenBasB.ttf ,",
	"ItalicFont = GenI102.ttf ,",
	"BoldItalicFont = GenBasBI.ttf ]",
	"{GenR102.ttf}",
	"",
	"\\begin{document}"
].join("\n");

var STD_FOOTER = [
	"\\end{document}"
].join("\n");


function convert(dom) {
	var string = [
		STD_HEADER,
		"This is a test!",
		STD_FOOTER
	].join("\n");

	console.log(string);

	return string;
}

module.exports = {
	version: json.version,
	convert: convert
};
