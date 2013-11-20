var assert = require("assert");
var latexer = require('../');
var path = require('path');

// ensure that we don't crash on any of our sample inputs
describe("Basic crash test", function() {
	['tao.zip', 'hurricanes.zip', 'us.zip'].forEach(function(bundle) {
		describe(bundle, function() {
			it('should compile to PDF', function(done) {
				this.timeout(0);
				var filename = path.join(__dirname, '..', 'samples', bundle);
				return latexer.convert({
					bundle: filename,
					output: filename + '.pdf',
					size: 'letter',
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
