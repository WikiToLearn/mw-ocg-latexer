#!/usr/bin/env node

var PARALLEL_FETCH_LIMIT = 5; // how many images to fetch in parallel

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
	.option('-t, --toc',
			'Print table of contents')
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

var async = require('async');
var domino = require('domino');
var easyimage = require('easyimage');
var fs = require('fs');
var gammalatex = require('gammalatex');
var path = require('path');
var request = require('request');
var tmp = require('tmp');
var url = require('url');
var util = require('util');
tmp.setGracefulCleanup();

var title = program.args[0];

function log() {
	// en/disable log messages here
	if (program.debug) {
		console.error.apply(console, arguments);
	}
}

var getBaseHref = function(document) {
	var base = document.querySelector('head > base[href]');
	if (!base ) return '';
	return base.getAttribute('href').replace(/^\/\//, 'https://');
};

// Utilities to fetch images and create a map
var fetchImages = function(document, callback) {
	tmp.dir({
		prefix: 'parsoid-latex-',
		unsafeCleanup: !program.debug
	}, function(err, tmpdir) {
		if (err) throw err;
		var base = getBaseHref(document);
		var imgs = document.querySelectorAll([
			'figure img[resource]',
			'*[typeof="mw:Image"] img[resource]',
			'*[typeof="mw:Image/Thumb"] img[resource]'
		].join(','));
		var tasks = Object.create(null);
		Array.prototype.forEach.call(imgs, function(img) {
			var resURL = url.resolve(base, img.getAttribute('resource'));
			tasks[resURL] = function(callback) {
				// evil workaround for .svgs
				if (/[.]svg$/i.test(resURL)) {
					resURL = url.resolve(base, img.getAttribute('src')).
						replace(/\/\d+(px-[^\/]+)$/, '/600$1'); // use hi res
				}
				log('Fetching image', resURL);
				var m = /([^\/:]+)([.]\w+)$/.exec(resURL);
				tmp.tmpName({
					prefix: m ? m[1] : undefined,
					postfix: m ? m[2] : undefined,
					dir: tmpdir
				}, function(err, name) {
					if (err) throw err;
					var realURL = // link to actual image
						resURL.replace(/\/File:/, '/Special:Redirect/file/');
					request({ url: realURL, encoding: null }).
						on('end', function() {
							// workaround for .gifs (convert format)
							if (/[.]gif$/i.test(resURL)) {
								return easyimage.convert({
									src: name, dst: name+'.png'
								}, function(err, image) {
									if (err) {
										console.error('Error converting GIF',
													  resURL);
									}
									callback(null, err ? null : name + '.png');
								});
							}
							// map URL to the temporary file name w/ contents
							return callback(null, name);
						}).
						on('response', function(resp) {
							if (resp.statusCode !== 200) {
								this.emit('error');
							}
						}).
						on('error', function() {
							this.abort();
							console.error('Error fetching image', resURL);
							// non-fatal, map this url to null
							return callback(null, null);
						}).pipe( fs.createWriteStream(name) );
				});
			};
		});
		async.parallelLimit(
			tasks, PARALLEL_FETCH_LIMIT, function(err, results) {
				if (err) throw err;
				callback(results);
			});
	});
};

// Fetch parsoid source for this page.
var fetchParsoid = function(title, callback) {
	log('Fetching from Parsoid');
	var apiURL = url.resolve(program.api, program.prefix + '/' + title);
	request({url:apiURL, encoding:'utf8'}, function(error, response, body) {
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
	// fetch all image resources
	log('Fetching images...');
	fetchImages(dom, function(imagemap) {
		// ok, generate LaTeX!
		log('Converting to LaTeX');
		var latexOutput = parsoidlatex.convert(dom, {
			base: getBaseHref(dom),
			toc: !!program.toc,
			imagemap: imagemap
		});
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
		gammalatex.addRerunIndicator("Package hyperref Warning: Rerun");
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
});
