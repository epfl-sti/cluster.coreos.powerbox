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
