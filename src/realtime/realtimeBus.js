const { EventEmitter } = require('events');

const realtimeBus = new EventEmitter();
realtimeBus.setMaxListeners(100);

module.exports = realtimeBus;
