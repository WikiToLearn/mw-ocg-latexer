// Helpers for promises.
var nodefn = require('when/node/function');
var spawn = require('child_process').spawn;
var when = require('when');

var P = module.exports = {};

// My own version of nodefn.call with an explicit 'this', used for methods
P.call = function(fn, self) {
	var args = Array.prototype.slice.call(arguments, 2);
	return nodefn.apply(fn.bind(self), args);
};

// Returns a promise for completion after spawning `program`
P.spawn = function(program, args, options) {
	var deferred = when.defer();
	spawn(program, args || [], options || {}).
		on('exit', function(exitCode) {
			if (exitCode === 0) {
				deferred.resolve();
			} else {
				deferred.reject(new Error(
					program+' '+args.join(' ')+' exited with code '+exitCode
				));
			}
		}).on('error', function(err) {
			deferred.reject(err);
		});
	return deferred.promise;
};

// Returns a promise for completion after iterating through the given
// array in parallel.  The function should return a promise for each element.
// This is like map but we throw away the results.
// If the optional `p` parameter is provided, wait for that to resolve
// before starting to process the array contents.
P.forEachPar = function(a, f, p) {
	return (p || when.resolve()).then(function() {
		return a;
	}).then(function(aResolved) {
		return when.all(aResolved.map(f));
	});
};

// Returns a promise for completion after iterating through the given
// array in sequence.  The function should return a promise for each element.
// If the optional `p` parameter is provided, wait for that to resolve
// before starting to process the array contents.
P.forEachSeq = function(a, f, p) {
	p = p || when.resolve();
	return when.reduce(a, function(curResult, value, index, total) {
		/* jshint unused: vars */
		return f.call(null, value, index, null);
	}, p);
};
