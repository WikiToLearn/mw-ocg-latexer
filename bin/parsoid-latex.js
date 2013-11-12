#!/usr/bin/env node

var program = require('commander');
var parsoidlatex = require('../');

program
	.version(parsoidlatex.version)
	.usage('[options] <title>')
	.option('-o, --output <filename>',
			'Save PDF to the given <filename>', null)
	.option('-p, --prefix <prefix>',
			'Which wiki prefix to use to resolve the title', 'en')
	.option('-a, --api <url>',
			'Parsoid API root', 'http://parsoid.wmflabs.org');

program.parse(process.argv);

if (program.args.length === 0) {
	console.error('A page title is required.');
	return 1;
}
if (program.args.length > 1) {
	console.error('Too many arguments.');
	return 1;
}

var domino = require('domino');
var fs = require('fs');
var gammalatex = require('gammalatex');
var request = require('request');
var url = require('url');
var util = require('util');

var title = program.args[0];
// Fetch parsoid source for this page.
var apiURL = url.resolve(program.api, program.prefix + '/' + title);

function log() {
	// en/disable log messages here
	//console.error.apply(console, arguments);
}


log('Fetching from Parsoid');
request(apiURL, function(error, response, body) {
	if (error || response.statusCode !== 200) {
		console.error("Error fetching Parsoid source:", apiURL);
		return 1;
	}
	// parse to DOM
	log('Converting to DOM');
	var dom = domino.createDocument(body);
	// ok, generate LaTeX!
	log('Converting to LaTeX');
	var latexOutput = parsoidlatex.convert(dom);
	// compile to PDF!
	log('Compiling to PDF with xelatex');
	gammalatex.setCompileCommand({
		command: "xelatex",
		options: ["-interaction=nonstopmode", "-halt-on-error"]
	});
	gammalatex.parse(latexOutput, function(err, readStream) {
		log('Saving PDF');
		if (err) throw err;
		var writeStream = process.stdout;
		if (program.output) {
			writeStream = fs.createWriteStream(program.output);
		}
		readStream.pipe(writeStream);
		return 0;
	});
});
