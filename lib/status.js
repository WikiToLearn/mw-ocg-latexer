var percentComplete = 0;
var currentStage = 0.0;
var stagesInv = 1.0;
var stageLen = 0;

module.exports.setNumStages = function(num) {
	stagesInv = 1.0 / num;
};

module.exports.createStage = function(len) {
	percentComplete = currentStage * stagesInv;
	currentStage += 1;
	if (len) {
		stageLen = 1.0 / len;
	} else {
		stageLen = 0;
	}
};

module.exports.report = function(message, file) {
	percentComplete += 100.0 * (stagesInv * stageLen);
	if (process.send) {
		process.send(JSON.stringify({status: message, file: file, percent: percentComplete}));
	}
};