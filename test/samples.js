/* global describe, it */
"use strict";
require('es6-shim');
require('prfun');

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var latexer = require('../');

// determine if xelatex is installed
var checkXeLaTeX = function() {
	var has = false;
	process.env.PATH.split(path.delimiter).forEach(function(p) {
		/* jshint bitwise: false */
		try {
			var st = fs.statSync(path.join(p, 'xelatex'));
			if (st.isFile() && (st.mode & parseInt('111', 8)) !== 0) {
				/* it's an executable file */
				has = true;
			}
		} catch (e) { /* nope, xelatex not here */ }
	});
	return has;
};

// ensure that we don't crash on any of our sample inputs
describe("Basic crash test", function() {
	var hasXeLaTeX = checkXeLaTeX();
	['tao.zip', 'hurricanes.zip', 'malayalam.zip', 'multiwiki.zip', 'papier.zip', 'us.zip', 'jabug.zip'].forEach(function(bundle) {
		describe(bundle, function() {
			var dest = hasXeLaTeX ? 'pdf' : 'tex';
			it('should compile to '+dest, function() {
				this.timeout(0);
				var filename = path.join(__dirname, '..', 'samples', bundle);
				return latexer.convert({
					bundle: filename,
					output: filename + '.' + dest,
					size: 'letter',
					latex: !hasXeLaTeX,
					log: function() { /* suppress logging */ }
				}).then(function(statusCode) {
					assert.equal(statusCode, 0);
				}).finally(function() {
					try {
						fs.unlinkSync(filename + '.' + dest);
					} catch (e) { }
				});
			});
		});
	});
});
