/**
 * New module.
 */

Promise.prototype.thenTestDone = function (done) {
    this.then(
        function () {
            done()
        }, function (error) {
            done(error);
        });
};
