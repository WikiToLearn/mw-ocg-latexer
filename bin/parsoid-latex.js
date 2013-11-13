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
	.option('-s, --size <letter|a4>',
			'Set paper size', 'letter')
	.option('-d, --debug',
			'Output LaTeX source instead of PDF')
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
var path = require('path');
var request = require('request');
var url = require('url');
var util = require('util');

var title = program.args[0];

function log() {
	// en/disable log messages here
	//console.error.apply(console, arguments);
}

// Fetch parsoid source for this page.
var fetchParsoid = function(title, callback) {
	log('Fetching from Parsoid');
	var apiURL = url.resolve(program.api, program.prefix + '/' + title);
	request(apiURL, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			console.error("Error fetching Parsoid source:", apiURL);
			process.exit(1);
		}
		callback(body);
	});
};

// look-aside cache of Parsoid source, for quicker debugging
try {
	var cachePath = path.join(__dirname, '..', 'cache', program.prefix, title);
	var cached = fs.readFileSync(cachePath, 'utf8');
	fetchParsoid = function(_, callback) { callback(cached); };
} catch (e) {
	/* no cached version; ignore error */
}

fetchParsoid(title, function(body) {
	// parse to DOM
	log('Converting to DOM');
	var dom = domino.createDocument(body);
	// ok, generate LaTeX!
	log('Converting to LaTeX');
	var latexOutput = parsoidlatex.convert(dom);
	// compile to PDF!
	if (program.debug) {
		if (program.output) {
			fs.writeFileSync(program.output, latexOutput);
		} else {
			console.log(latexOutput);
		}
		process.exit(0);
	}
	log('Compiling to PDF with xelatex');
	gammalatex.setCompileCommand({
		command: "xelatex",
		options: [
			"-interaction=nonstopmode",
			"-halt-on-error",
			'-papersize=' + program.size
		]
	});
	gammalatex.addRerunIndicator("No file output.toc.");
	gammalatex.parse(latexOutput, function(err, readStream) {
		log('Saving PDF');
		if (err) throw err;
		var writeStream = process.stdout;
		if (program.output) {
			writeStream = fs.createWriteStream(program.output);
		}
		readStream.pipe(writeStream);
		return;
	});
});
