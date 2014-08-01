/* Progress reporting using the node IPC mechanism. */
"use strict";

var StatusReporter = module.exports = function(numStages, extraLog) {
	this.extraLog = extraLog;
	this.percentComplete = 0;
	this.currentStage = 0.0;
	this.stagesInv = 1.0;
	this.stageLen = 0;
	this.message = '';
	this.file = undefined;
	if (numStages) {
		this._setNumStages(numStages);
	}
};

/** Send one report with current status (internal function). */
StatusReporter.prototype._send = function() {
	var msg = {
		type: 'status',
		message: this.message,
		file: this.file,
		percent: this.percentComplete
	};
	if (this.extraLog) {
		this.extraLog(msg);
	}
	if (process.send) {
		process.send(msg);
	}
};

/** Update current status with message/file, and send it. */
StatusReporter.prototype._report = function(message, file) {
	if (message || message==='') {
		this.message = message;
		this.file = file;
	} else if (file) {
		// update only the current file
		this.file = file;
	}
	this._send();
};

/** Initialize StatusReporter with given # of stages. */
StatusReporter.prototype._setNumStages = function(num) {
	this.stagesInv = 1.0 / num;
};

/** Start a new stage, which will be `opt_len` steps long. */
StatusReporter.prototype.createStage = function(opt_len, opt_message, opt_file) {
	this.percentComplete = 100.0 * this.currentStage * this.stagesInv;
	this.currentStage += 1;
	if (opt_len) {
		this.stageLen = 1.0 / opt_len;
	} else {
		this.stageLen = 0;
	}
	this._report(opt_message || '', opt_file);
};

/** Advance the stage by N steps. */
StatusReporter.prototype.reportN = function(n, opt_message, opt_file) {
	this._report(opt_message, opt_file);
	this.percentComplete += 100.0 * (this.stagesInv * this.stageLen * n);
};

/** Advance the stage by 1. */
StatusReporter.prototype.report = function(opt_message, opt_file) {
	this.reportN(1, opt_message, opt_file);
};
