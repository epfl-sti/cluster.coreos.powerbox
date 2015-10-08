var Q = require("q");
Q.longStackSupport = true;

Promise.prototype.thenTestDone = Q.makePromise.prototype.thenTestDone = function (done) {
    this.then(
        function () {
            done()
        }, function (error) {
            done(error);
        });
};

/**
 * A promise for when an event happens.
 *
 * @param {EventEmitter} emitter
 * @param {String} eventName
 * @returns {Promise}
 */
exports.whenEvent = function(emitter, eventName) {
    var when = Q.defer();
    var onEvent, onError;
    onEvent = function (payload) {
        emitter.removeListener("error", onError);
        when.resolve(payload);
    };
    onError = function (error) {
        emitter.removeListener(eventName, onEvent);
        when.reject(error);
    };
    emitter.once(eventName, onEvent);
    emitter.once("error", onError);
    return when.promise;
};

/* This is just a giant mess. See:
 * [node issue #830](https://github.com/nodejs/node/issues/830)
 * https://github.com/petkaantonov/bluebird/blob/master/API.md#error-management-configuration
 *
 * In node issue 830, emphasis is on the following:
 *  "it's possible to report an unhandled rejection that
 *   actually is handled at a later point if the catch handler is attached
 *   at a very late time"
 * except that AFAICT, our code never does that. Therefore, unhandledRejection's
 * are fatal to us (in tests at least)
 */
process.on("unhandledRejection", function (error, promise) {
    var type = (promise instanceof Q.makePromise) ? "Q": "native";
    console.log("Unhandled rejection of a " + type + " promise");
    throw error;
});
