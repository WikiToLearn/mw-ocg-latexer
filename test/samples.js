/* global describe, it */
'use strict';
require('core-js/shim');
var Promise = require('prfun');

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var latexer = require('../');

// Determine if xelatex/jpegtran/etc is installed.
var checkExecutable = function(execfile) {
	var has = false;
	process.env.PATH.split(path.delimiter).forEach(function(p) {
		/* jshint bitwise: false */
		try {
			var st = fs.statSync(path.join(p, execfile));
			if (st.isFile() && (st.mode & parseInt('111', 8)) !== 0) {
				/* It's an executable file. */
				has = true;
			}
		} catch (e) { /* Nope, no executable of that name found here. */ }
	});
	if (!has) {
		console.error(
			'** Skipping some tests because', execfile, 'not found on path. **'
		);
	}
	return has;
};

// Ensure that we don't crash on any of our sample inputs.
describe('Basic crash test', function() {
	var hasXeLaTeX = checkExecutable('xelatex');
	var hasJpegtran = checkExecutable('jpegtran');
	['tao.zip', 'hurricanes.zip', 'malayalam.zip', 'multiwiki.zip', 'papier.zip', 'titlecrash.zip', 'us.zip', 'jabug.zip', 'bug68854.zip', '1988.zip', 'set.zip', 'bug71185.zip', 'url-in-toc.zip', 'allah.zip', 'tibetan.zip', 'lao.zip', 'khmer.zip','pashto.zip','nepali.zip','newari.zip','maithili.zip','firstaid.zip'].forEach(function(bundle) {
		describe(bundle, function() {
			var dest = hasXeLaTeX ? 'pdf' : 'tex';
			it('should compile to ' + dest, function() {
				this.timeout(0);
				var filename = path.join(__dirname, '..', 'samples', bundle);
				return latexer.convert({
					bundle: filename,
					output: filename + '.' + dest,
					size: 'letter',
					latex: !hasXeLaTeX,
					skipJpegtran: !hasJpegtran,
					log: function() { /* Suppress logging. */ },
				}).then(function(_) {
					// Should resolve with no value.
					assert.equal(_, undefined);
				}).finally(function() {
					try {
						fs.unlinkSync(filename + '.' + dest);
					} catch (e) { }
				});
			});
		});
	});
});
