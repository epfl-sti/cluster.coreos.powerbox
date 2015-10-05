"use strict";
var debug = require("debug")("local-etcd-test"),
    LocalEtcd = require('../local-etcd').LocalEtcd;

Promise.prototype.thenTestDone = function (done) {
    this.then(
        function () {
            done()
        }, function (error) {
            done(error);
        });
};

describe.only("Testing ../local-etcd.js", function () {
    this.timeout(30*1000);
    it("is reachable immediately", function (done) {
        debug("Starting test");
        var etcd_server = new LocalEtcd();
        return etcd_server.start().then(function () {
            return new Promise(function (resolve, reject) {
                var client = etcd_server.getClient();
                client.set("key", "value", {}, function () {
                    client.get("key", function (v) {
                        assert.equal(v, "value");
                        debug("Assertion reached");
                        resolve();
                    })
                });
            });
        }).then(function () {
            return etcd_server.stop();
        }).thenTestDone(done);
    });
    it("is writable");
});