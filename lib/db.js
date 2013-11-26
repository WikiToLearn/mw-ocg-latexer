// helpers to create key/value mappings in sqlite db

var sqlite3 = require('sqlite3');
var when = require('when');
var nodefn = require("when/node/function");

var P = require('./p');

var Db = module.exports = function(filename, options) {
	/* jshint bitwise: false */
	options = options || {};
	// use promises!
	var deferred = when.defer();
	var mode = options.readonly ? sqlite3.OPEN_READONLY :
		( sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE );
	var db = new sqlite3.Database(
		filename, mode, nodefn.createCallback(deferred)
	);
	// this.db is a promise for the database, once tables have been created
	this.db = deferred.promise.then(function() {
		if (!options.readonly) {
			return P.call(
				db.run, db,
				"CREATE TABLE IF NOT EXISTS " +
				"kv_table (key TEXT PRIMARY KEY, val TEXT);"
			);
		}
	}).then(function() { return db; });
};

// Returns a promise for the number of keys (used to compute status percentages)
Db.prototype.count = function() {
	return this.db.then(function(db) {
		return P.call(
			db.get, db,
			"SELECT count() AS count FROM kv_table;"
		);
	}).then(function(row) {
		return row.count;
	});
};

// Returns a promise for the value.
Db.prototype.get = function(key, nojson) {
	return this.db.then(function(db) {
		return P.call(
			db.get, db,
			"SELECT val FROM kv_table WHERE key = ?;",
			'' + key
		);
	}).then(function(row) {
		var val = row.val;
		return nojson ? val : JSON.parse(val);
	});
};

// Returns a promise which will be resolved (with the number of keys)
// when the iteration is complete
Db.prototype.forEach = function(f, nojson) {
	var each = function(err, row) {
		var val = nojson ? row.val : JSON.parse(row.val);
		f(row.key, val);
	};
	return this.db.then(function(db) {
		return P.call(db.each, db, "SELECT * FROM kv_table;", each);
	});
};

// Returns a promise to write a value.
Db.prototype.put = function(key, value) {
	if (typeof(value) !== 'string') { value = JSON.stringify(value); }
	return this.db.then(function(db) {
		return P.call(
			db.run, db,
			"INSERT OR REPLACE INTO kv_table (key, val) VALUES (?,?);",
			'' + key, value
		);
	});
};

// Returns a promise to close and finalize the database.
Db.prototype.close = function() {
	return this.db.then(function(db) {
		return P.call(db.close, db);
	});
};
