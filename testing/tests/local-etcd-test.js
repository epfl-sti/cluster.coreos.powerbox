"use strict";
var assert = require("assert"),
    debug = require("debug")("local-etcd-test"),
    LocalEtcd = require('../local-etcd').LocalEtcd;

require("../testlib");

describe("Testing ../local-etcd.js", function () {
    this.timeout(60*1000);
    it("is reachable immediately", function (done) {
        debug("Starting test");
        var etcd_server = new LocalEtcd();
        return etcd_server.start().then(function () {
            return new Promise(function (resolve, reject) {
                var client = etcd_server.getClient();
                client.set("key", "value", {}, function () {
                    client.get("key", function (unknown, v) {
                        assert.equal(v.node.value, "value");
                        resolve();
                    })
                });
            });
        }).thenTestDone(done);
    });
    it("is writable");

    after(function (done) {
        LocalEtcd.killAll().thenTestDone(done);
    });
});