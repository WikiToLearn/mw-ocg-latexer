/* global describe, it */
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
			if (st.isFile() && (st.mode & 0111) !== 0) {
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
	['tao.zip', 'hurricanes.zip', 'us.zip'].forEach(function(bundle) {
		describe(bundle, function() {
			var dest = hasXeLaTeX ? 'PDF' : 'tex';
			it('should compile to '+dest, function(done) {
				this.timeout(0);
				var filename = path.join(__dirname, '..', 'samples', bundle);
				return latexer.convert({
					bundle: filename,
					output: filename + '.pdf',
					size: 'letter',
					debug: !hasXeLaTeX,
					log: function() { /* suppress logging */ }
				}).then(function(statusCode) {
					assert.equal(statusCode, 0);
				}).ensure(function() {
					try {
						fs.unlinkSync(filename + '.pdf');
					} catch (e) { }
				}).done(
					function() { done(); },
					function(err) { done(err); }
				);
			});
		});
	});
});
